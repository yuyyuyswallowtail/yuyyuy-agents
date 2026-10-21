import copy, json, os, sys, uuid

# usage: python3 apply-v2.py <export workflow gabungan .json> <output .json>
src, dst = sys.argv[1:3]
OWNER = "yuyyuyswallowtail"
BRANCH = "feat/boost-skills"

base = os.path.dirname(os.path.abspath(__file__))
engine = open(os.path.join(base, "engine.js")).read().rstrip()

wf = json.load(open(src))
wf = wf[0] if isinstance(wf, list) else wf
nodes = {n["name"]: n for n in wf["nodes"]}
for need in ("Sanitize", "Create GitHub Repo", "Config", "Router", "Absorb", "Done", "Exec"):
    assert need in nodes, f"node '{need}' tidak ada di workflow"

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
cfg_js = json.dumps(CFG, indent=2)
a = '"name": "yuyyuy-admin-web",'
b = '"root": "/workspace/yuyyuy-admin-web",'
assert a in cfg_js and b in cfg_js
cfg_js = cfg_js.replace(a, '"name": $(\'Sanitize\').first().json.name,')
cfg_js = cfg_js.replace(b, '"root": "/workspace/" + $(\'Sanitize\').first().json.name,')

TAIL = {
    "Config": "const cfg = " + cfg_js + ";\nreturn [{ json: initialState(cfg) }];",
    "Router": "const S = $input.first().json;\nreturn [{ json: route(S) }];",
    "Absorb": "const S = $('Router').first().json;\nconst raw = $input.first().json;\nreturn [{ json: absorb(S, raw) }];",
    "Done": "const S = $('Router').first().json;\nreturn [{ json: summary(S) }];",
}
for name, tail in TAIL.items():
    nodes[name]["parameters"]["jsCode"] = engine + "\n\n" + tail
for name in ("DeepSeek Planner", "Qwen Coder", "Ministral Memory"):
    if name in nodes:
        nodes[name]["parameters"].setdefault("options", {})["timeout"] = 5400000

C = wf["connections"]
if "Branch Exists?" not in nodes:
    cr = nodes["Create GitHub Repo"]
    ex = nodes["Exec"]
    okn = nodes.get("OK?")
    x, y = cr["position"]
    # credential SSH: ambil dari node SSH mana pun yang punya
    donors = [n for n in wf["nodes"] if n.get("type") == ex["type"] and n.get("credentials")]
    cred = copy.deepcopy(donors[0]["credentials"]) if donors else None
    check = {
        "parameters": {
            "authentication": "privateKey",
            "command": "={{ 'GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code --heads https://github.com/" + OWNER
                       + "/' + $('Sanitize').first().json.name + '.git " + BRANCH
                       + " >/dev/null 2>&1 && echo EXISTS || echo MISSING' }}",
            "cwd": ex["parameters"].get("cwd", "/home/builder"),
        },
        "id": str(uuid.uuid4()),
        "name": "Check Branch",
        "type": ex["type"],
        "typeVersion": ex["typeVersion"],
        "position": [x, y + 220],
        "onError": "continueRegularOutput",
    }
    if cred:
        check["credentials"] = cred
    else:
        print("PERINGATAN: tidak ada credential SSH di export; pilih credential manual di node Check Branch")
    gate = {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                "conditions": [{
                    "id": str(uuid.uuid4()),
                    "leftValue": "={{ ($json.stdout || '').trim() }}",
                    "rightValue": "EXISTS",
                    "operator": {"type": "string", "operation": "equals"},
                }],
                "combinator": "and",
            },
            "options": {},
        },
        "id": str(uuid.uuid4()),
        "name": "Branch Exists?",
        "type": "n8n-nodes-base.if",
        "typeVersion": okn["typeVersion"] if okn else 2.2,
        "position": [x + 240, y + 220],
    }
    wf["nodes"].extend([check, gate])
    old = C["Sanitize"]["main"][0]
    C["Sanitize"]["main"][0] = [{"node": "Check Branch", "type": "main", "index": 0}]
    C["Check Branch"] = {"main": [[{"node": "Branch Exists?", "type": "main", "index": 0}]]}
    C["Branch Exists?"] = {"main": [[{"node": "Config", "type": "main", "index": 0}], old]}

wf["name"] = "Laravel Setup + Agents v2 (skip if branch exists)"
for k in ("id", "versionId", "active", "createdAt", "updatedAt", "shared", "tags"):
    wf.pop(k, None)
wf["active"] = False
json.dump(wf, open(dst, "w"), indent=1)
print("OK", len(wf["nodes"]), "nodes ->", dst)
