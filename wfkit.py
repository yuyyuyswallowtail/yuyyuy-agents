"""Shared helpers for sync-engine.py and apply-v2.py: what the n8n workflow needs for the scrum flow."""
import copy, json, os

LLAMA = "Meta-Llama"
LLAMA_DIRECT = ":9996/"   # llama-server port (same style as DeepSeek :9999 and Qwen :9998)
LLAMA_PROXY = ":9897/"    # model-proxy port, applied by apply-proxy.py

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
    "qaMutation": False,    # run pest --mutate in the QA tools (needs Xdebug or PCOV)
}


def load_engine(base):
    """engine.js + scrum.js, the text embedded in the Config, Router, Absorb and Done Code nodes."""
    parts = [open(os.path.join(base, f)).read().rstrip() for f in ("engine.js", "scrum.js")]
    return "\n\n".join(parts)


def ensure_llama(wf):
    """Add the Meta-Llama HTTP node, a 'llama' output on the Route switch and its connection to Absorb (idempotent)."""
    nodes = {n["name"]: n for n in wf["nodes"]}
    for need in ("Qwen Coder", "Route", "Absorb"):
        assert need in nodes, f"node '{need}' not found in the workflow"
    if LLAMA not in nodes:
        donor = nodes["Qwen Coder"]
        n = copy.deepcopy(donor)
        n["id"], n["name"] = "meta-llama", LLAMA
        n["position"] = [donor["position"][0], max(x["position"][1] for x in wf["nodes"]) + 180]
        url = donor["parameters"]["url"]
        n["parameters"]["url"] = url.replace(":9898/", LLAMA_PROXY).replace(":9998/", LLAMA_DIRECT)
        assert LLAMA_PROXY in n["parameters"]["url"] or LLAMA_DIRECT in n["parameters"]["url"], f"unexpected Qwen url: {url}"
        n.pop("credentials", None)
        wf["nodes"].append(n)
    route = nodes["Route"]
    values = route["parameters"]["rules"]["values"]
    if not any(v.get("outputKey") == "llama" for v in values):
        rule = copy.deepcopy(next(v for v in values if v.get("outputKey") == "qwen"))
        rule["outputKey"] = "llama"
        rule["conditions"]["conditions"][0]["id"] = "llama"
        rule["conditions"]["conditions"][0]["rightValue"] = "llama"
        values.append(rule)
    C = wf["connections"]
    main = C["Route"]["main"]
    while len(main) < len(values):
        main.append([])
    idx = next(i for i, v in enumerate(values) if v.get("outputKey") == "llama")
    if not any(l["node"] == LLAMA for l in main[idx]):
        main[idx] = [{"node": LLAMA, "type": "main", "index": 0}]
    C[LLAMA] = {"main": [[{"node": "Absorb", "type": "main", "index": 0}]]}
    return wf
