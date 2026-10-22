#!/usr/bin/env python3
"""Proxy arbitration test: 3 heavy models must never be in flight at the same time.
Uses fake llama-servers on 127.0.0.1 and a stubbed ensure(); no systemd, no GPU."""
import http.client, importlib.util, json, os, random, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ["PROXY_BIND"] = "127.0.0.1"
os.environ["BACKEND_HOST"] = "127.0.0.1"
os.environ["AGENT_DB"] = os.path.join(tempfile.mkdtemp(), "agent.db")

spec = importlib.util.spec_from_file_location("mp", os.path.join(os.path.dirname(__file__), "..", "proxy", "model-proxy.py"))
mp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mp)

assert set(mp.MODELS) == {"deepseek", "qwen-coder", "meta-llama"}, mp.MODELS
assert mp.MODELS["deepseek"]["proxy"] == 9899 and mp.MODELS["deepseek"]["port"] == 9999
assert mp.MODELS["qwen-coder"]["proxy"] == 9898 and mp.MODELS["qwen-coder"]["port"] == 9998
assert mp.MODELS["meta-llama"]["proxy"] == 9897 and mp.MODELS["meta-llama"]["port"] == 9996

lock = threading.Lock()
live = {n: 0 for n in mp.MODELS}
violations, served, switches = [], {n: 0 for n in mp.MODELS}, []

def fake_ensure(name):
    if mp.state["active"] != name:
        switches.append((mp.state["active"], name))
        time.sleep(0.05)
    mp.state["active"] = name
mp.ensure = fake_ensure

def backend(model):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); self.rfile.read(n)
            with lock:
                live[model] += 1
                if any(live[o] > 0 for o in live if o != model):
                    violations.append((model, dict(live)))
                if mp.state["active"] != model:
                    violations.append(("not-active", model, mp.state["active"]))
            time.sleep(random.uniform(0.01, 0.04))
            body = json.dumps({"choices": [{"message": {"content": "ok " + model}, "finish_reason": "stop"}], "usage": {"completion_tokens": 3}}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            with lock:
                live[model] -= 1; served[model] += 1
    return H

class S(ThreadingHTTPServer):
    daemon_threads = True; allow_reuse_address = True

servers = []
for name, m in mp.MODELS.items():
    b = S(("127.0.0.1", m["port"]), backend(name)); threading.Thread(target=b.serve_forever, daemon=True).start(); servers.append(b)
    p = S(("127.0.0.1", m["proxy"]), mp.Handler); p.model = name; threading.Thread(target=p.serve_forever, daemon=True).start(); servers.append(p)

def call(name):
    c = http.client.HTTPConnection("127.0.0.1", mp.MODELS[name]["proxy"], timeout=60)
    c.request("POST", "/v1/chat/completions", body=json.dumps({"messages": []}), headers={"Content-Type": "application/json"})
    r = c.getresponse(); data = json.loads(r.read()); c.close()
    assert r.status == 200 and data["choices"][0]["message"]["content"] == "ok " + name, (name, r.status, data)

order = ["deepseek", "qwen-coder", "meta-llama"] * 12
random.seed(7); random.shuffle(order)
ts = [threading.Thread(target=call, args=(n,)) for n in order]
t0 = time.time()
[t.start() for t in ts]; [t.join() for t in ts]
print(f"36 mixed requests in {time.time()-t0:.1f}s; served={served}; model switches={len(switches)}")
assert sum(served.values()) == 36, served
assert not violations, violations[:3]
print("health:", end=" ")
c = http.client.HTTPConnection("127.0.0.1", mp.MODELS["deepseek"]["proxy"], timeout=5)
c.request("GET", "/health"); h = json.loads(c.getresponse().read()); print(sorted(h))
assert {"deepseek", "qwen-coder", "meta-llama", "status", "active"} <= set(h)
print("PROXY_OK: no two heavy models ever overlapped")
