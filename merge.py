import json, sys
laravel_file, agents_file, out_file = sys.argv[1:4]
L = json.load(open(laravel_file))
L = L[0] if isinstance(L, list) else L
A = json.load(open(agents_file))

lnames = {n["name"] for n in L["nodes"]}
for need in ("Sanitize", "Skills OK?", "Result"):
    assert need in lnames, f"node '{need}' tidak ada di workflow Laravel"
skip = {"Start"}
agent_nodes = [n for n in A["nodes"] if n["name"] not in skip]
clash = {n["name"] for n in agent_nodes} & lnames
assert not clash, f"nama node bentrok: {clash}"

maxy = max(n["position"][1] for n in L["nodes"])
for n in agent_nodes:
    n = json.loads(json.dumps(n))
    n["position"] = [n["position"][0], n["position"][1] + maxy + 300]
    n.pop("id", None)
    if n["name"] == "Config":
        js = n["parameters"]["jsCode"]
        a = '"name": "yuyyuy-admin-web",'
        b = '"root": "/workspace/yuyyuy-admin-web",'
        assert a in js and b in js, "pola Config tidak ditemukan"
        js = js.replace(a, '"name": $(\'Sanitize\').first().json.name,')
        js = js.replace(b, '"root": "/workspace/" + $(\'Sanitize\').first().json.name,')
        n["parameters"]["jsCode"] = js
    L["nodes"].append(n)

C = L["connections"]
for k, v in A["connections"].items():
    if k != "Start":
        C[k] = v
true_out = C["Skills OK?"]["main"][0]
assert any(l["node"] == "Result" for l in true_out), "output true Skills OK? tidak menuju Result"
C["Skills OK?"]["main"][0] = [{"node": "Config", "type": "main", "index": 0}]
C["Done"] = {"main": [[{"node": "Result", "type": "main", "index": 0}]]}

L["name"] = "Laravel Setup + Agents (backend > frontend > qa)"
for k in ("id", "versionId", "active", "createdAt", "updatedAt", "shared", "tags"):
    L.pop(k, None)
L["active"] = False
json.dump(L, open(out_file, "w"), indent=1)
print("OK", len(L["nodes"]), "nodes ->", out_file)
