import json, os

base = os.path.dirname(os.path.abspath(__file__))
engine = open(os.path.join(base, "engine.js")).read().rstrip()
wf_path = os.path.join(base, "yuyyuy-agents.workflow.json")
wf = json.load(open(wf_path))

CFG = {
    "name": "yuyyuy-admin-web",
    "root": "/workspace/yuyyuy-admin-web",
    "bin": "/workspace/_agents/bin",
    "prefix": "",
    "agents": ["backend", "frontend", "qa"],
    "only": [],
    "git": True,
    "qa": True,
    "maxRev": 2,
    "maxFix": 2,
    "maxIter": 4000,
}
TAIL = {
    "Config": "const cfg = " + json.dumps(CFG, indent=2) + ";\nreturn [{ json: initialState(cfg) }];",
    "Router": "const S = $input.first().json;\nreturn [{ json: route(S) }];",
    "Absorb": "const S = $('Router').first().json;\nconst raw = $input.first().json;\nreturn [{ json: absorb(S, raw) }];",
    "Done": "const S = $('Router').first().json;\nreturn [{ json: summary(S) }];",
}
for n in wf["nodes"]:
    if n["name"] in TAIL:
        n["parameters"]["jsCode"] = engine + "\n\n" + TAIL[n["name"]]
    if n["type"] == "n8n-nodes-base.httpRequest":
        n["parameters"].setdefault("options", {})["timeout"] = 5400000
json.dump(wf, open(wf_path, "w"), indent=1)
print("OK engine v2 ->", wf_path)
