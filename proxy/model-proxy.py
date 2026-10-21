#!/usr/bin/env python3
"""On-demand model switcher + proxy for llama.cpp.

Only one heavy model (deepseek or qwen-coder) runs at a time; the memory model
(ministral) is never touched. Requests to a proxy port start that model first
and stop the other heavy one.

  deepseek    proxy :9899 -> llama-server :9999
  qwen-coder  proxy :9898 -> llama-server :9998
"""
import http.client, json, os, re, signal, sqlite3, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BIND = os.environ.get("PROXY_BIND", "172.18.0.1")
BACKEND_HOST = os.environ.get("BACKEND_HOST", "172.18.0.1")
START_TIMEOUT = int(os.environ.get("START_TIMEOUT", "420"))
DB = os.environ.get("AGENT_DB", os.path.expanduser("~/n8n/workspace/_agents/memory/agent.db"))
MODELS = {
    "deepseek":   {"proxy": 9899, "port": 9999, "unit": "llama-deepseek.service"},
    "qwen-coder": {"proxy": 9898, "port": 9998, "unit": "llama-qwen-coder.service"},
}

cond = threading.Condition()
state = {"active": None, "switching": False, "inflight": {n: 0 for n in MODELS}}


def log(msg):
    print(time.strftime("%F %T"), msg, flush=True)


def health(port):
    try:
        c = http.client.HTTPConnection(BACKEND_HOST, port, timeout=3)
        c.request("GET", "/health")
        code = c.getresponse().status
        c.close()
        return code
    except Exception:
        return 0


def listening_pids(port):
    out = subprocess.run(["ss", "-ltnpH", f"sport = :{port}"], capture_output=True, text=True).stdout
    return [int(p) for p in re.findall(r"pid=(\d+)", out)]


def unit_active(unit):
    return subprocess.run(["systemctl", "--user", "is-active", "--quiet", unit]).returncode == 0


def stop_model(name):
    m = MODELS[name]
    subprocess.run(["systemctl", "--user", "stop", m["unit"]], capture_output=True)
    for sig, wait in ((signal.SIGTERM, 30), (signal.SIGKILL, 10)):
        pids = listening_pids(m["port"])
        if not pids:
            break
        for p in pids:
            try:
                os.kill(p, sig)
            except ProcessLookupError:
                pass
        end = time.time() + wait
        while time.time() < end and listening_pids(m["port"]):
            time.sleep(0.5)
    time.sleep(2)  # let the kernel reclaim memory before the next model loads


def ensure(name):
    me = MODELS[name]
    for other, o in MODELS.items():
        if other != name and (listening_pids(o["port"]) or unit_active(o["unit"])):
            log(f"stopping {other} to free memory for {name}")
            stop_model(other)
    if health(me["port"]) != 200:
        if not listening_pids(me["port"]):
            log(f"starting {name}")
            subprocess.run(["systemctl", "--user", "start", me["unit"]], capture_output=True)
        end = time.time() + START_TIMEOUT
        while time.time() < end:
            if health(me["port"]) == 200:
                break
            time.sleep(3)
        else:
            raise RuntimeError(f"{name} not healthy after {START_TIMEOUT}s")
    state["active"] = name


def acquire(name):
    other = [n for n in MODELS if n != name][0]
    with cond:
        while state["switching"] or state["inflight"][other] > 0:
            cond.wait(timeout=5)
        state["switching"] = True
    try:
        ensure(name)
    except Exception:
        with cond:
            state["switching"] = False
            cond.notify_all()
        raise
    with cond:
        state["switching"] = False
        state["inflight"][name] += 1
        cond.notify_all()


def release(name):
    with cond:
        state["inflight"][name] -= 1
        cond.notify_all()


def record(model, status, ms, prompt_chars, tokens, finish, head):
    try:
        db = sqlite3.connect(DB, timeout=30)
        db.execute("""CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL DEFAULT (datetime('now')),
            model TEXT, status INTEGER, ms INTEGER, prompt_chars INTEGER,
            completion_tokens INTEGER, finish_reason TEXT, head TEXT)""")
        db.execute("INSERT INTO interactions(model,status,ms,prompt_chars,completion_tokens,finish_reason,head) VALUES (?,?,?,?,?,?,?)",
                   (model, status, ms, prompt_chars, tokens, finish, head))
        db.commit()
        db.close()
    except Exception as e:
        log(f"interaction log failed: {e}")


class Handler(BaseHTTPRequestHandler):
    server_version = "model-proxy"

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            return self._json(200, {"status": "ok", "active": state["active"],
                                    "deepseek": health(9999), "qwen-coder": health(9998)})
        self._proxy()

    def do_POST(self):
        self._proxy()

    def _proxy(self):
        name = self.server.model
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        t0 = time.time()
        status, tokens, finish, head = 0, None, None, ""
        acquired, conn, kept = False, None, []
        try:
            resp = None
            for attempt in (1, 2):
                acquire(name)
                acquired = True
                try:
                    conn = http.client.HTTPConnection(BACKEND_HOST, MODELS[name]["port"], timeout=7200)
                    hdrs = {k: v for k, v in self.headers.items()
                            if k.lower() not in ("host", "connection", "content-length", "transfer-encoding")}
                    hdrs["Content-Length"] = str(len(body))
                    conn.request(self.command, self.path, body=body or None, headers=hdrs)
                    resp = conn.getresponse()
                    break
                except OSError:
                    release(name)
                    acquired = False
                    if attempt == 2:
                        raise
                    log(f"{name} unreachable, re-ensuring")
                    state["active"] = None
            status = resp.status
            self.send_response(status)
            for k, v in resp.getheaders():
                if k.lower() in ("transfer-encoding", "connection", "keep-alive"):
                    continue
                self.send_header(k, v)
            self.end_headers()
            size = 0
            while True:
                chunk = resp.read1(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
                if size < 400000:
                    kept.append(chunk)
                    size += len(chunk)
        except Exception as e:
            log(f"{name} request failed: {e}")
            if status == 0:
                try:
                    self._json(503, {"error": {"message": f"model proxy: {e}", "type": "proxy_error"}})
                    status = 503
                except Exception:
                    pass
        finally:
            if conn:
                conn.close()
            if acquired:
                release(name)
            try:
                if status == 200 and kept:
                    d = json.loads(b"".join(kept))
                    ch = d["choices"][0]
                    finish = ch.get("finish_reason")
                    tokens = (d.get("usage") or {}).get("completion_tokens")
                    head = ((ch.get("message") or {}).get("content") or "")[:300]
            except Exception:
                pass
            record(name, status, int((time.time() - t0) * 1000), len(body), tokens, finish, head)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    up = [n for n, m in MODELS.items() if health(m["port"]) == 200]
    state["active"] = up[0] if len(up) == 1 else None
    log(f"proxy starting; models up now: {up or 'none'}")
    servers = []
    for name, m in MODELS.items():
        s = Server((BIND, m["proxy"]), Handler)
        s.model = name
        threading.Thread(target=s.serve_forever, daemon=True).start()
        servers.append(s)
        log(f"{name}: proxy {BIND}:{m['proxy']} -> {BACKEND_HOST}:{m['port']}")
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))
    try:
        while True:
            time.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == "__main__":
    main()
