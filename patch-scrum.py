# usage: python3 patch-scrum.py <export workflow.json> <output.json>   (in-place patch of the embedded scrum code: TASKS rejection reasons, SC_TOK.fix 6000)
import json, sys
src, dst = sys.argv[1:3]
data = json.load(open(src)); wfs = data if isinstance(data, list) else [data]; wf = wfs[0]
PAIRS = [
 ("const SC_TOK = { plan: 6000, fix: 4000,", "const SC_TOK = { plan: 6000, fix: 6000,"),
 ("At most 5 tasks, at most 3 files per task.\\nRequired headings:\\n${scReqList(part)}",
  "At most 5 tasks, at most 3 files per task. Every entry in 'files' must be ONE concrete file path (example: ${S.cfg.root}/app/Models/User.php): never a directory, never braces {}, never wildcards.\\nRequired headings:\\n${scReqList(part)}"),
 ("      let arr = null; try { arr = JSON.parse(unfence(pick(secs, 'TASKS') || '')); } catch (e) { arr = null; }\n      const tasks = validateTasks(arr, root, part.role, part.slice);",
  "      const why = []; const tb = pick(secs, 'TASKS'); let arr = null;\n      if (tb == null) why.push('TASKS section is missing: add a <<<TASKS>>> header line followed by the JSON array');\n      else { try { arr = JSON.parse(unfence(tb)); } catch (e) { why.push('TASKS is not valid JSON (' + e.message + ')'); } }\n      const tasks = arr == null ? null : validateTasks(arr, root, part.role, part.slice, why);"),
 ("only in: ${LAYER_HELP[part.role]}`);\n      const claimed",
  "only in: ${LAYER_HELP[part.role]}` + (why.length ? `\\nWhy your previous TASKS was rejected:\\n- ${why.slice(0, 6).join('\\n- ')}` : ''));\n      const claimed"),
]
n = 0
for node in wf['nodes']:
    c = node.get('parameters', {}).get('jsCode')
    if not c or 'sc_plan_call' not in c: continue
    for old, new in PAIRS:
        if new in c: continue
        assert c.count(old) == 1, (node['name'], old[:50])
        c = c.replace(old, new)
    node['parameters']['jsCode'] = c; n += 1; print('patched', node['name'])
print('nodes patched:', n, '| total nodes:', len(wf['nodes']))
if n == 0: sys.exit(1)
json.dump(wfs, open(dst, 'w'))
