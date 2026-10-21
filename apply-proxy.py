import json, sys

# usage: python3 apply-proxy.py <in.json> <out.json>
src, dst = sys.argv[1:3]
wf = json.load(open(src))
wf = wf[0] if isinstance(wf, list) else wf
MAP = {"DeepSeek Planner": (":9999/", ":9899/"), "Qwen Coder": (":9998/", ":9898/")}
hit = []
for n in wf["nodes"]:
    if n["name"] in MAP:
        old, new = MAP[n["name"]]
        url = n["parameters"]["url"]
        assert old in url or new in url, f"url tak dikenal di {n['name']}: {url}"
        n["parameters"]["url"] = url.replace(old, new)
        hit.append(n["name"])
    if n["name"] == "Config":
        js = n["parameters"]["jsCode"]
        assert '"qa": true,' in js or '"qa": false,' in js, "cfg qa tidak ditemukan"
        n["parameters"]["jsCode"] = js.replace('"qa": true,', '"qa": false,')
        hit.append("Config(qa=false)")
json.dump(wf, open(dst, "w"), indent=1)
print("OK", hit, "->", dst)
