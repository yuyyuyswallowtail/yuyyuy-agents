"""Shared helpers for sync-engine.py and apply-v2.py: what the n8n workflow needs for the scrum flow."""
import copy, json, os

LLAMA = "Meta-Llama"
LLAMA_DIRECT = ":9996/"   # llama-server port (same style as DeepSeek :9999 and Qwen :9998)
LLAMA_PROXY = ":9897/"    # model-proxy port, applied by apply-proxy.py
GEMMA = "Gemma Vision"
GEMMA_DIRECT = ":9995/"   # gemma-3-4b-it with its mmproj (screenshot review)
GEMMA_PROXY = ":9896/"

# cfg.scrum is read by engine.js; set "enabled": False to run the legacy backend > frontend > qa flow
SCRUM_CFG = {
    "enabled": True,
    "maxIter": 12000,       # router steps per execution (the legacy cap of 4000 is too small for several sprints)
    "maxPlan": 3,           # PM gate iterations per sprint
    "maxRev": 2,            # revisions of one incomplete plan inside an iteration
    "maxProbe": 2,          # PROBE rounds per plan call
    "maxFinal": 2,          # fix rounds after a final rejection
    "maxSprints": 0,        # 0 = unlimited; N = stop after N sprints (keeps one n8n execution small)
    "onBlocked": "stop",    # stop | continue
    "qaMutation": "auto",   # pest --mutate: auto = only when Xdebug or PCOV is present; True/False forces it
    "qaE2e": "auto",        # Playwright E2E: auto = only when playwright.config.* and @playwright/test are installed
    "e2eBlocking": False,   # True: a failing E2E run forces the PM to reject
    "requireTests": True,   # backend/frontend plans must contain a test task
    "vision": "auto",       # gemma3 reviews E2E screenshots when they exist; False turns it off
}


def load_engine(base):
    """engine.js + scrum.js, the text embedded in the Config, Router, Absorb and Done Code nodes."""
    parts = [open(os.path.join(base, f)).read().rstrip() for f in ("engine.js", "scrum.js")]
    return "\n\n".join(parts)


def _ensure_model(wf, name, key, node_id, proxy, direct):
    """Add an HTTP node for one more llama.cpp model, a Route output for it and its connection to Absorb (idempotent)."""
    nodes = {n["name"]: n for n in wf["nodes"]}
    for need in ("Qwen Coder", "Route", "Absorb"):
        assert need in nodes, f"node '{need}' not found in the workflow"
    if name not in nodes:
        donor = nodes["Qwen Coder"]
        n = copy.deepcopy(donor)
        n["id"], n["name"] = node_id, name
        n["position"] = [donor["position"][0], max(x["position"][1] for x in wf["nodes"]) + 180]
        url = donor["parameters"]["url"]
        n["parameters"]["url"] = url.replace(":9898/", proxy).replace(":9998/", direct)
        assert proxy in n["parameters"]["url"] or direct in n["parameters"]["url"], f"unexpected Qwen url: {url}"
        n.pop("credentials", None)
        wf["nodes"].append(n)
    route = nodes["Route"]
    values = route["parameters"].get("rules", {}).get("values")
    assert values, "Route has no rules.values (unexpected Switch layout): send the Route node JSON"

    def cond_value(v):
        cs = (v.get("conditions") or {}).get("conditions") or []
        return cs[0].get("rightValue") if cs else None

    def is_rule(v, key):
        return v.get("outputKey") == key or cond_value(v) == key

    if not any(is_rule(v, key) for v in values):
        donor_rule = next((v for v in values if is_rule(v, "qwen")), values[0])
        rule = copy.deepcopy(donor_rule)
        rule["conditions"]["conditions"][0]["id"] = key
        rule["conditions"]["conditions"][0]["rightValue"] = key
        rule["renamedOutput"] = True
        rule["outputKey"] = key
        values.append(rule)
    C = wf["connections"]
    main = C["Route"]["main"]
    while len(main) < len(values):
        main.append([])
    idx = next(i for i, v in enumerate(values) if is_rule(v, key))
    if not any(l["node"] == name for l in main[idx]):
        main[idx] = [{"node": name, "type": "main", "index": 0}]
    C[name] = {"main": [[{"node": "Absorb", "type": "main", "index": 0}]]}
    return wf


def ensure_llama(wf):
    """Everything the scrum flow adds to the workflow: the Meta-Llama node and the Gemma Vision node (idempotent)."""
    _ensure_model(wf, LLAMA, "llama", "meta-llama", LLAMA_PROXY, LLAMA_DIRECT)
    return _ensure_model(wf, GEMMA, "gemma", "gemma-vision", GEMMA_PROXY, GEMMA_DIRECT)
