#!/usr/bin/env node
/* Integration test of the scrum flow: the REAL engine.js + scrum.js drive the REAL bin/*.sh and apply.php against a
 * throw-away Laravel-like git repo (bare local remote). Only the LLMs are scripted fakes.
 * Run: node test/scrum.sim.js        (needs bash, php, git; uses a python sqlite3 shim when the CLI is missing) */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), vm = require('vm'), assert = require('assert');
const REPO = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(REPO, 'engine.js'), 'utf8') + '\n' + fs.readFileSync(path.join(REPO, 'scrum.js'), 'utf8') + '\n;({route,absorb,initialState,summary})';
const E = vm.runInNewContext(bundle, { Buffer, console });

const SHIM = `#!/usr/bin/env python3
import sqlite3, sys
a = sys.argv[1:]; sep = '|'; db = None; sql = None; i = 0
while i < len(a):
    if a[i] == '-batch': i += 1
    elif a[i] == '-separator': sep = a[i + 1]; i += 2
    elif db is None: db = a[i]; i += 1
    else: sql = a[i]; i += 1
if sql is None: sql = sys.stdin.read()
c = sqlite3.connect(db, isolation_level=None)
def run(stmt):
    for r in c.execute(stmt): print(sep.join('' if v is None else str(v) for v in r))
try:
    start = 0
    for i, ch in enumerate(sql):
        if ch == ';' and sqlite3.complete_statement(sql[start:i + 1]):
            run(sql[start:i + 1]); start = i + 1
    if sql[start:].strip(): run(sql[start:])
except sqlite3.Error as e:
    print('Error: ' + str(e), file=sys.stderr); sys.exit(1)
`;

function sh(cmd, cwd, env) {
  const r = cp.spawnSync('bash', ['-c', cmd], { cwd, env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', code: r.status };
}
const phpFile = (n) => `<?php\ndeclare(strict_types=1);\n\nnamespace App\\Support;\n\nfinal class ${n}\n{\n    public function run(): int\n    {\n        return 1;\n    }\n}\n`;

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrum-sim-'));
  const root = path.join(tmp, 'app'), remote = path.join(tmp, 'remote.git'), bin = path.join(tmp, 'shim');
  fs.mkdirSync(root); fs.mkdirSync(bin);
  const env = { AGENT_DB: path.join(tmp, 'agent.db'), PATH: bin + ':' + process.env.PATH, GIT_TERMINAL_PROMPT: '0' };
  if (sh('command -v sqlite3', tmp).code !== 0) { fs.writeFileSync(path.join(bin, 'sqlite3'), SHIM, { mode: 0o755 }); }
  sh(`git init -q --bare "${remote}" && cd "${root}" && git init -q -b main && git config user.email t@t && git config user.name t && git remote add origin "${remote}"`, tmp);
  fs.writeFileSync(path.join(root, 'composer.json'), '{"require":{"php":"^8.4","laravel/framework":"^13.17"}}\n');
  fs.writeFileSync(path.join(root, 'composer.lock'), JSON.stringify({ packages: [{ name: 'laravel/framework', version: 'v13.17.0' }], 'packages-dev': [] }));
  fs.mkdirSync(path.join(root, 'app'));
  sh('git add -A && git commit -q -m init && git push -q origin main', root);
  return { tmp, root, remote, env };
}

const HEAD = '## Files Per Layer\nx\n## Contracts\nx\n## Edge Cases\nx\n## Test Plan\nx\n## Purpose\nx\n## Components\nx\n## States\nx\n## Accessibility\nx\n';
const FILES = (slice, sprint) => ({ database: [`database/migrations/2026_10_21_000101_create_${sprint.replace(/\W/g, '_')}_table.php`], backend: ['app/Support/QueryParams.php'], uiux: [`docs/design/${slice}.md`], frontend: ['resources/views/components/button.blade.php'], qa: ['tests/Unit/Support/QueryParamsTest.php'] });

function run(name, opts) {
  const fx = fixture(); const trace = []; const calls = { gate: 0, final: 0, plan: [], code: [] };
  const cfg = Object.assign({ name: 'sim', root: fx.root, bin: path.join(REPO, 'bin'), prefix: '', agents: opts.legacy ? ['backend'] : [], only: opts.only, git: true, qa: !opts.legacy, maxRev: 2, maxFix: 1, maxIter: 20000, scrum: opts.legacy ? { enabled: false } : Object.assign({ enabled: true, maxIter: 20000 }, opts.scrum || {}) });
  if (opts.pre) opts.pre(fx);
  if (opts.legacy) sh(`bash ${REPO}/bin/mem.sh init`, fx.tmp, fx.env); // the legacy flow expects the DB to be initialised once by the operator
  let S = E.initialState(cfg); let guard = 0;
  const fake = (S) => {
    const sys = S.req.messages[0].content, usr = S.req.messages[1].content, root = fx.root;
    const reply = (c) => ({ choices: [{ message: { content: c }, finish_reason: 'stop' }] });
    if (S.action === 'gemma') {
      const c = S.req.messages[1].content; calls.gemma = (calls.gemma || 0) + 1;
      assert(Array.isArray(c) && c.some((x) => x.type === 'image_url' && /^data:image\/jpeg;base64,/.test(x.image_url.url)), 'vision request must carry the screenshots');
      return reply('OK storage/e2e-screens/other.jpg\nISSUE storage/e2e-screens/admin-dashboard.jpg: accent color is not coral');
    }
    if (S.action === 'ministral') return reply(S.step === 'brief' ? 'NONE' : 'recorded: ' + usr.split('\n')[0].slice(0, 80));
    if (/^MODE: KICKOFF/.test(usr)) return reply('<<<GOAL>>>\nThe feature works.\n<<<CRITERIA>>>\nbackend: query kit works\nui/ux: tokens documented\nfrontend: button renders\ndatabase: users table exists\n<<<RISKS>>>\n- none\n<<<MEMORY>>>\nkickoff ok');
    if (/^MODE: GATE/.test(usr)) { const g = opts.gates[calls.gate++] || 'APPROVE'; return reply(g === 'APPROVE' ? '<<<VERDICT>>>\nAPPROVE\n<<<FEEDBACK>>>\nfine\n<<<MEMORY>>>\napproved' : `<<<VERDICT>>>\nREJECT\n<<<FEEDBACK>>>\n${g.replace(/^REJECT /, '')}\n<<<MEMORY>>>\nrejected`); }
    if (/^MODE: FINAL/.test(usr)) { calls.final++; calls.finalUsr = usr; return reply('<<<VERDICT>>>\nAPPROVE\n<<<FEEDBACK>>>\nok\n<<<LESSON>>>\nLESSON: always run hygiene\n<<<GAP>>>\nlaravel/framework: sample rule\n<<<MEMORY>>>\nfinal ok'); }
    if (/^MODE: RETRO/.test(usr)) return reply('<<<RETRO>>>\nshipped it\n<<<NEXT>>>\nQueryParams lives in app/Support\n<<<MEMORY>>>\nretro ok');
    if (S.step === 'plan_docs' || S.step === 'revise') {
      const f = `${root}/app/Support/QueryParams.php`; calls.plan.push('legacy:' + S.agent);
      return reply(`<<<MD>>>\n${HEAD}\n<<<TASKS>>>\n${JSON.stringify([{ id: 't1', title: 'kit', files: [f], reads: [], instruction: 'do it', checks: ['php -l ' + f] }])}\n<<<CODER>>>\nx\n<<<MEMORY>>>\nplanned`);
    }
    if (S.step === 'sc_plan_call') {
      const role = sys.match(/^AGENT: (\w+)/m)[1], key = usr.match(/^YOUR PART: (\S+)/m)[1], slice = key.split(':')[1], sprint = S.sc.sp.id;
      calls.plan.push(key + '#' + S.sc.iter);
      if (opts.probeOnce && role === 'backend' && !/VERIFIED FACTS/.test(usr)) return reply('<<<PROBE>>>\ngrep QueryParams app\nroutes');
      if (opts.probeOnce && role === 'backend') assert(/VERIFIED FACTS/.test(usr) && /probe: grep QueryParams app/.test(usr), 'probe facts must reach the planner');
      if (opts.fbCheck && role === 'frontend' && S.sc.iter === 2) assert(/PM FEEDBACK YOU MUST FIX/.test(usr) && /use the token/.test(usr), 'feedback must reach the redone part');
      const files = FILES(slice, sprint)[role].map((f) => `${root}/${f}`);
      const task = { id: 't1', title: role + ' work', files, reads: [], instruction: 'do it', checks: files.filter((f) => f.endsWith('.php')).map((f) => 'php -l ' + f) };
      const tasks = [task];
      const testFile = { backend: 'tests/Unit/Support/KitTest.php', frontend: 'tests/Feature/Livewire/ButtonTest.php' }[role];
      if (testFile && !(opts.noTestTask && !(opts.testAfter !== undefined && calls.plan.filter((k) => k.startsWith(key)).length > opts.testAfter))) tasks.push({ id: 't2', title: role + ' test', files: [`${root}/${testFile}`], reads: [], instruction: 'write the Pest test', checks: [] });
      return reply(`<<<MD>>>\n${HEAD}\n<<<TASKS>>>\n${JSON.stringify(tasks)}\n<<<CODER>>>\nuse exact names\n<<<MEMORY>>>\nplanned ${key}`);
    }
    if (S.step === 'code') {
      const files = usr.split('Files to write (absolute, write ONLY these):\n')[1].split('\n\n')[0].split('\n').map((l) => l.replace(/^- /, ''));
      calls.code.push(S.action + ':' + files.map((f) => path.basename(f)).join(','));
      const fixing = /Fix ONLY these defects/.test(usr);
      const body = (f) => f.endsWith('.php') ? (opts.dirty && !fixing && f.endsWith('QueryParams.php') ? phpFile('QueryParams').replace('return 1;', 'dd($x);\n        return 1;') : phpFile(path.basename(f, '.php').replace(/\W/g, '_').replace(/^\d+/, 'C'))) : `# spec\n`;
      return reply(files.map((f) => `<<<FILE ${f}>>>\n${body(f)}<<<END>>>`).join('\n') + '\n<<<REPORT>>>\ndone\n<<<MEMORY>>>\nwrote ' + files.length);
    }
    throw new Error('unscripted LLM call at ' + S.step + ' action ' + S.action);
  };
  while (guard++ < 20000) {
    S = JSON.parse(JSON.stringify(E.route(S)));
    if (S.action === 'done') break;
    let raw;
    if (S.action === 'exec') { raw = sh(S.cmd, fx.tmp, fx.env); trace.push('exec'); }
    else { trace.push(S.action); raw = fake(S); }
    S = JSON.parse(JSON.stringify(E.absorb(S, raw)));
  }
  assert(guard < 20000, name + ': did not terminate');
  return { S, fx, trace, calls, summary: E.summary(S) };
}
const git = (fx, c) => sh(c, fx.root, fx.env).stdout.trim();
const heavy = (t) => t.filter((a) => ['deepseek', 'qwen', 'llama', 'gemma'].includes(a));
const swaps = (t) => heavy(t).filter((a, i, l) => i && a !== l[i - 1]).length;
const rows = (fx, q) => sh(`sqlite3 "${fx.env.AGENT_DB}" "${q}"`, fx.tmp, fx.env).stdout.trim();
let ok = 0; const pass = (m) => { ok++; console.log('  ok -', m); };

console.log('A) database-only sprint, happy path');
{
  const r = run('A', { only: ['00A'], gates: ['APPROVE'] }); const s = r.summary;
  assert.deepStrictEqual(s.shipped, ['00A-schema-identity'], JSON.stringify(s)); assert(s.ok, JSON.stringify(s)); pass('shipped, run ok');
  assert(sh(`git ls-remote --heads origin feat/00A-schema-identity`, r.fx.root).stdout.includes('feat/00A-schema-identity'), 'branch pushed'); pass('feat/00A-schema-identity pushed to the remote, main untouched: ' + git(r.fx, 'git ls-remote --heads origin').split('\n').length + ' heads');
  assert(fs.existsSync(path.join(r.fx.root, 'docs/agents/database/00A-schema-identity.md')) && fs.existsSync(path.join(r.fx.root, 'docs/agents/pm/00A-schema-identity.md')), 'docs'); pass('plan doc + PM doc written (only for this sprint)');
  assert(r.calls.code.every((c) => c.startsWith('llama:')), r.calls.code.join()); pass('database part written by llama: ' + r.calls.code.join());
  assert.strictEqual(rows(r.fx, "select status from conversations where name='00A-schema-identity'"), 'shipped'); pass('conversation status shipped');
  const models = rows(r.fx, "select distinct model||'/'||phase from messages order by 1").split('\n'); assert(['deepseek/plan', 'deepseek/gate', 'deepseek/final', 'llama/kickoff', 'llama/retro'].every((m) => models.includes(m)), models.join()); pass('every interaction linked to the conversation: ' + models.join(' '));
  assert(rows(r.fx, "select count(*) from memory where scope='global' and kind in ('handoff','lesson')") >= 2); pass('handoff + lesson stored as global memory');
  const seq = heavy(r.trace).filter((a, k, l) => !k || a !== l[k - 1]); assert.deepStrictEqual(seq, ['llama', 'deepseek', 'llama', 'deepseek', 'llama'], seq.join()); pass('model order kickoff(llama) > plan+gate(deepseek) > write(llama) > final(deepseek) > retro(llama): ' + (seq.length - 1) + ' swaps')
  assert(git(r.fx, 'git rev-parse --abbrev-ref HEAD') === 'feat/00A-schema-identity'); pass('HEAD on the shipped feature branch (next sprint stacks on it)');
  assert(!r.trace.includes('gemma') && !r.calls.gemma); pass('no screenshots: the vision model is never loaded');
}

console.log('B) mixed sprint: probe, partial gate rejection, hygiene override + fix round');
{
  const r = run('B', { only: ['00D'], gates: ['REJECT frontend: use the token --accent'], probeOnce: true, fbCheck: true, dirty: true });
  const s = r.summary; assert.deepStrictEqual(s.shipped, ['00D-query-kit'], JSON.stringify(s)); assert.strictEqual(s.planIterations['00D-query-kit'], 2); pass('approved at plan iteration 2, shipped');
  const redo = r.calls.plan.filter((p) => p.endsWith('#2')); assert.deepStrictEqual(redo, ['frontend:10A-ui-components#2'], redo.join()); pass('only the part named by the PM was re-planned: ' + redo.join());
  const code = r.calls.code; assert(code.findIndex((c) => c.startsWith('llama:10A')) < code.findIndex((c) => c.startsWith('qwen:QueryParams')), code.join());
  assert.strictEqual(code[0].split(':')[0], 'llama'); assert(code.some((c) => c.startsWith('qwen:QueryParams.php') && code.indexOf(c) >= 0)); pass('writers batched by model: ' + code.join(' > '));
  assert(r.calls.final === 2, 'final rounds ' + r.calls.final); assert(code.filter((c) => c.startsWith('qwen:QueryParams.php')).length === 2); pass('PM approved but hygiene failed: engine forced a fix round, then final 2 approved');
  const dd = git(r.fx, 'git show HEAD:app/Support/QueryParams.php | grep -c "dd("'); assert(dd === '0', 'clean file shipped'); pass('shipped file is the fixed one');
  assert(fs.readFileSync(path.join(r.fx.root, 'resources/views/components/button.blade.php'), 'utf8').length > 0); pass('frontend task executed after uiux spec existed');
  const pm = fs.readFileSync(path.join(r.fx.root, 'docs/agents/pm/00D-query-kit.md'), 'utf8'); assert(/iteration 1: REJECT/.test(pm) && /sample rule/.test(pm)); pass('PM doc lists gate history and the GAP for human review');
}

console.log('C) PM rejects 3 times: blocked, parked, run stops');
{
  const r = run('C', { only: ['00D', '01'], gates: ['REJECT backend: x', 'REJECT backend: y', 'REJECT backend: z'] });
  const s = r.summary; assert(!s.ok && s.abort && /blocked/.test(s.abort), JSON.stringify(s)); assert.strictEqual(s.planIterations['00D-query-kit'], 3); pass('3 gate iterations, then blocked: ' + s.abort.slice(0, 60));
  assert.strictEqual(s.parked.length, 1); assert(/PARKED wip\/00D-query-kit-/.test(s.parked[0])); pass('parked: ' + s.parked[0].slice(0, 50));
  assert(git(r.fx, 'git rev-parse --abbrev-ref HEAD') === 'main'); assert(git(r.fx, 'git ls-remote --heads origin').includes('wip/00D-query-kit-')); pass('HEAD back on main, wip branch on the remote');
  assert(r.calls.code.length === 0, 'no code written for a rejected plan'); assert.strictEqual(rows(r.fx, "select status from conversations where name='00D-query-kit'"), 'blocked'); pass('nothing implemented, conversation blocked');
  assert(!r.trace.slice(0, -1).includes('qwen')); pass('qwen never loaded');
}
console.log('D) regression: legacy three-agent flow (scrum.enabled=false) still works');
{
  const r = run('D', { only: ['00D'], legacy: true }); const s = r.summary;
  assert(!s.mode && s.ok, JSON.stringify(s)); assert.deepStrictEqual(s.shipped, ['backend:00D-query-kit']); pass('legacy run ok, shipped ' + s.shipped.join());
  assert.deepStrictEqual(r.calls.code, ['qwen:QueryParams.php']); assert(heavy(r.trace).join() === 'deepseek,qwen'); pass('legacy model order unchanged: ' + heavy(r.trace).join('>'));
  assert(fs.existsSync(path.join(r.fx.root, 'docs/agents/backend/00D-query-kit.md'))); assert(rows(r.fx, 'select count(*) from messages') === '0'); pass('legacy memory rows carry no conversation');
}
console.log('E) resume: a sprint whose plan docs already exist skips kickoff, planning and the gate');
{
  const pre = (fx) => {
    const f = `${fx.root}/database/migrations/2026_10_21_000101_create_00A_schema_identity_table.php`;
    const d = path.join(fx.root, 'docs/agents/database'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '00A-schema-identity.tasks.json'), JSON.stringify([{ id: 't1', title: 'db', files: [f], reads: [], instruction: 'do it', checks: ['php -l ' + f] }]));
  };
  const r = run('E', { only: ['00A'], gates: [], pre }); const s = r.summary;
  assert.deepStrictEqual(s.resumed, ['00A-schema-identity']); assert.deepStrictEqual(s.shipped, ['00A-schema-identity'], JSON.stringify(s)); pass('resumed from docs and shipped');
  assert.strictEqual(r.calls.plan.length, 0); assert.strictEqual(r.calls.gate, 0); assert(!heavy(r.trace).includes('deepseek') || r.calls.final === 1); pass('no planning, no gate; only implementation + final + retro ran: ' + heavy(r.trace).join('>'));
}
console.log('F) a plan without a test task is sent back once, then accepted');
{
  const r = run('F', { only: ['00D'], gates: ['APPROVE'], noTestTask: true, testAfter: 1 }); const s = r.summary;
  assert.deepStrictEqual(s.shipped, ['00D-query-kit'], JSON.stringify(s));
  const be = r.calls.plan.filter((k) => k.startsWith('backend:00D')); assert.strictEqual(be.length, 2, be.join()); pass('backend plan revised once because it had no test task: ' + be.join(' '));
  assert(r.calls.code.some((c) => /KitTest\.php/.test(c)) && r.calls.code.some((c) => /ButtonTest\.php/.test(c)), r.calls.code.join()); pass('test files of backend and frontend were written: ' + r.calls.code.join(' > '));
  assert.strictEqual(r.calls.final, 1); pass('no extra final round needed');
}

console.log('G) planners never add tests: the QA gate blocks, the engine asks qa to write them');
{
  const r = run('G', { only: ['00D'], gates: ['APPROVE'], noTestTask: true }); const s = r.summary;
  assert.deepStrictEqual(s.shipped, ['00D-query-kit'], JSON.stringify(s));
  const be = r.calls.plan.filter((k) => k.startsWith('backend:00D')); assert.strictEqual(be.length, 3, be.join()); pass('backend plan stayed incomplete after 2 revisions (3 calls), the gate still saw it');
  assert.strictEqual(r.calls.final, 2, 'final rounds ' + r.calls.final); pass('PM approved but tests-added failed: forced a fix round');
  assert(r.calls.code.some((c) => c.startsWith('llama:QueryParamsTest.php')), r.calls.code.join()); pass('the qa writer (llama) created tests/Unit/Support/QueryParamsTest.php');
  assert(git(r.fx, 'git ls-files tests | grep -c QueryParamsTest') === '1'); pass('the test file is part of the shipped branch');
}
console.log('H) E2E screenshots exist: gemma3 reviews them and the PM sees the findings (advisory)');
{
  const pre = (fx) => { const d = path.join(fx.root, 'storage/e2e-screens'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'admin-dashboard.jpg'), Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////', 'base64')); };
  const r = run('H', { only: ['00A'], gates: ['APPROVE'], pre }); const s = r.summary;
  assert.deepStrictEqual(s.shipped, ['00A-schema-identity'], JSON.stringify(s)); assert.strictEqual(r.calls.gemma, 1); pass('one vision call with the screenshot attached, run shipped (findings are advisory, not blocking)');
  assert(/vision: FAIL exit 1 \(advisory\)/.test(r.calls.finalUsr) && /accent color is not coral/.test(r.calls.finalUsr)); pass('the PM FINAL prompt contains the vision finding');
  const seq = heavy(r.trace).filter((a, k, l) => !k || a !== l[k - 1]); assert.deepStrictEqual(seq, ['llama', 'deepseek', 'llama', 'gemma', 'deepseek', 'llama'], seq.join()); pass('model order: ' + seq.join(' > '));
  assert(!JSON.stringify(r.S).includes('/9j/4AAQ'), 'image data must not stay in the state'); pass('image data is dropped from the run state after the review');
}
console.log(`\nSCRUM_SIM_OK (${ok} checks)`);
