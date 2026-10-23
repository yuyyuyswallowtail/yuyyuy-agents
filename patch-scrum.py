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
 (["requireTests: true, vision: 'auto' }", "requireTests: true, vision: 'auto', softGate: false }"], "requireTests: true, vision: 'auto', softGate: false, autoTest: true }"),
 ("      sc.fb = {};\n      if (!approve) {\n        scRoleLines(fb)",
  "      sc.fb = {};\n      if (!approve && cfg.softGate && sc.iter >= cfg.maxPlan && !bad.length) { approve = true; S.warn.push(`gate: soft-approved at the last iteration (softGate); the PM still wanted: ${clip(fb, 200)}`); fb = 'soft-approved after ' + sc.iter + ' rejections. ' + fb; }\n      if (!approve) {\n        scRoleLines(fb)"),
 ("function scPlansText(S) {", "// the 8B planner keeps forgetting the test task: after the revisions are spent the engine derives one from the plan itself\nfunction scAutoTest(S, part, tasks) {\n  if (part.role !== 'backend' && part.role !== 'frontend') return null;\n  const root = S.cfg.root; const files = [].concat(...tasks.map((t) => t.files));\n  if (files.some((f) => /\\/tests\\/[^/]+\\/.*\\.php$/.test(f) || /\\/tests\\/.*\\.(spec|test)\\.[jt]s$/.test(f))) return null;\n  const claimed = scClaimed(S, part);\n  for (const f of files) {\n    const rel = f.slice(root.length + 1); let m; let test = null;\n    if (part.role === 'backend' && (m = rel.match(/^app\\/(Models|Enums|DTOs|Repositories|Services|Validators|Policies|Support|Jobs|Http\\/(?:Controllers|Requests|Middleware|Resources))\\/(?:.+\\/)?([A-Za-z0-9_]+)\\.php$/)) && !/(Interface|Contract)$/.test(m[2])) test = `tests/Unit/${m[1]}/${m[2]}Test.php`;\n    if (part.role === 'frontend' && (m = rel.match(/^app\\/Livewire\\/(?:.+\\/)?([A-Za-z0-9_]+)\\.php$/))) test = `tests/Feature/Livewire/${m[1]}Test.php`;\n    if (!test) continue;\n    const abs = `${root}/${test}`;\n    if (files.includes(abs) || claimed[abs]) continue;\n    return { id: 'auto-test', title: `Pest test for ${rel}`, files: [abs], reads: [f], instruction: `Write the Pest test for ${rel}: cover its public methods, the contract and the edge cases named in the plan (sections Contracts, Edge Cases, Test Plan). Use factories or in-memory data, no network. Use the exact class and method names of ${rel}.`, checks: [`php -l ${abs}`] };\n  }\n  return null;\n}\n" + "function scPlansText(S) {"),
 ("      const dropped = [];", '      if (cfg.autoTest && cfg.requireTests && cur.tasks && cur.tasks.length < 6) {\n        const at = scAutoTest(S, part, cur.tasks);\n        if (at) { cur.tasks.push(at); const i = missing.findIndex((m) => /^TASKS must include at least one TEST task/.test(m)); if (i >= 0) missing.splice(i, 1); S.warn.push(`${part.key}: the planner added no test task, the engine added ${at.files[0].slice(root.length + 1)}`); }\n      }\n' + "      const dropped = [];"),
]
n = 0
for node in wf['nodes']:
    c = node.get('parameters', {}).get('jsCode')
    if not c or 'sc_plan_call' not in c: continue
    for olds, new in PAIRS:
        if new in c: continue
        olds = olds if isinstance(olds, list) else [olds]
        hit = [o for o in olds if c.count(o) == 1]
        assert hit, (node['name'], olds[0][:50])
        c = c.replace(hit[0], new)
    node['parameters']['jsCode'] = c; n += 1; print('patched', node['name'])
print('nodes patched:', n, '| total nodes:', len(wf['nodes']))
if n == 0: sys.exit(1)
json.dump(wfs, open(dst, 'w'))
