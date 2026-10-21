/* ===== yuyyuy agent engine v2.1 (embedded in the n8n Config, Router, Absorb and Done Code nodes) ===== */
const LIM = { scope: 5200, snap: 3000, skills: 7500, memo: 1800, md: 6500, file: 2500, files: 7000, checks: 2200, brief: 1500, reads: 4000 };
const TOK = { docs: 6000, fix: 4000, code: 3500, qa: 1800, brief: 300, record: 160 };
const LLM_ACTIONS = ['deepseek', 'qwen', 'ministral'];
const DEFAULT_CHECK = [['Files Per Layer', []], ['Contracts', []], ['Edge Cases', []], ['Test Plan', []]];
const BASE_OWNED = ['routes/web.php', 'app/Providers/RepositoryServiceProvider.php', 'database/seeders/DatabaseSeeder.php', 'bootstrap/providers.php', 'bootstrap/app.php'];
const BAD_PATHS = /^app\/(Exceptions\/Handler|Http\/Kernel)\.php$/;
const LAYER_RE = {
  backend: /^(app\/(Models|Enums|DTOs|Repositories|Services|Validators|Policies|Providers|Support|Exceptions|Jobs|Http\/(Controllers|Requests|Middleware|Resources))\/|routes\/|database\/(migrations|factories|seeders)\/|config\/|bootstrap\/(providers|app)\.php$|tests\/Unit\/|docs\/|README\.md$|\.env\.example$)/,
  frontend: /^(resources\/|app\/Livewire\/|app\/View\/|routes\/features\/|public\/|tests\/Feature\/(Livewire|Public)\/)/,
  qa: /^(tests\/|docs\/|phpunit\.xml$|pint\.json$)/,
};
const LAYER_HELP = {
  backend: 'app/{Models,Enums,DTOs,Repositories,Services,Validators,Policies,Providers,Support,Exceptions,Jobs}, app/Http/{Controllers,Requests,Middleware,Resources}, routes/, database/{migrations,factories,seeders}, config/, bootstrap/{providers,app}.php, tests/Unit/, docs/, README.md, .env.example (NOT app/Exceptions/Handler.php or app/Http/Kernel.php: they do not exist in Laravel 11+)',
  frontend: 'resources/, app/Livewire/, app/View/, routes/features/, public/, tests/Feature/{Livewire,Public}/',
  qa: 'tests/, docs/, phpunit.xml, pint.json',
};

const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\n...[truncated]' : s; };
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sections(text) {
  text = String(text || '');
  const close = text.lastIndexOf('</think>');
  if (close !== -1) text = text.slice(close + 8);
  text = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const re = /^<<<([A-Z]+)(?: ([^>\n]+?))?>>>[ \t]*$/gm;
  const out = []; let m, last = null;
  while ((m = re.exec(text))) {
    if (last) last.body = text.slice(last.end, m.index);
    last = { name: m[1], arg: (m[2] || '').trim(), end: re.lastIndex, body: '' };
    out.push(last);
  }
  if (last) last.body = text.slice(last.end);
  out.forEach((s) => { s.body = s.body.replace(/^\r?\n/, '').replace(/\s+$/, ''); });
  return out;
}
const pick = (secs, name) => (secs.find((s) => s.name === name) || {}).body;
function unfence(b) { const m = String(b || '').match(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/); return m ? m[1] : b; }

function ctxSections(text) {
  const out = {}; const re = /^=====([A-Z]+)=====\r?$/gm; let m, last = null;
  while ((m = re.exec(text))) { if (last) out[last.n] = text.slice(last.e, m.index).replace(/^\n/, '').replace(/\s+$/, ''); last = { n: m[1], e: re.lastIndex }; }
  return out;
}

function pathOk(f, root, agent, sliceId) {
  if (typeof f !== 'string' || !f.startsWith(root + '/') || f.includes('..') || !/^[A-Za-z0-9._\/-]+$/.test(f)) return false;
  const rel = f.slice(root.length + 1);
  if (BAD_PATHS.test(rel)) return false;
  if (LAYER_RE[agent] && !LAYER_RE[agent].test(rel)) return false;
  if (BASE_OWNED.includes(rel) && !String(sliceId).startsWith('00')) return false;
  return true;
}
function readOk(f, root) {
  return typeof f === 'string' && f.startsWith(root + '/') && !f.includes('..') && /^[A-Za-z0-9._\/-]+$/.test(f)
    && !/(^|\/)\.env/.test(f) && !/\/(vendor|node_modules|\.git)\//.test(f);
}

function validateTasks(tasks, root, agent, sliceId) {
  if (!Array.isArray(tasks) || !tasks.length) return null;
  const out = [];
  tasks.slice(0, 6).forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const files = (Array.isArray(t.files) ? t.files : []).filter((f) => pathOk(f, root, agent, sliceId)).slice(0, 3);
    let reads = (Array.isArray(t.reads) ? t.reads : []).filter((f) => readOk(f, root)).slice(0, 3);
    files.forEach((f) => { if (BASE_OWNED.includes(f.slice(root.length + 1)) && !reads.includes(f)) reads.unshift(f); });
    reads = reads.slice(0, 3);
    const checks = (Array.isArray(t.checks) ? t.checks : []).filter((c) => typeof c === 'string').slice(0, 6);
    if (!t.instruction || !files.length) return;
    out.push({ id: String(t.id || 't' + (i + 1)).replace(/[^A-Za-z0-9._-]/g, '-'), title: String(t.title || t.id || 'task'), files, reads, instruction: String(t.instruction), checks });
  });
  return out.length ? out : null;
}

function coverage(md, check) {
  const low = String(md || '').toLowerCase();
  return (check || []).filter(([h, kw]) => {
    const heading = new RegExp('^#{1,6}\\s+.*' + esc(h), 'im').test(md || '');
    return !(heading && (kw || []).every((k) => low.includes(String(k).toLowerCase())));
  }).map(([h, kw]) => `heading "${h}"` + ((kw || []).length ? ` with keywords: ${kw.join(', ')}` : ''));
}

function chat(system, user, max, temp) {
  return { model: 'local', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: max, temperature: temp, stream: false };
}

function execCmd(S, cmd, stdin) {
  S.action = 'exec';
  const pre = S.cfg.prefix ? S.cfg.prefix + ' ' : '';
  S.cmd = (stdin ? `printf '%s' '${stdin}' | ` : '') + pre + cmd;
  return S;
}
const memCmd = (S, args) => `bash ${S.cfg.bin}/mem.sh ${args}`;
const slice = (S) => S.slices[S.si];
const checkOf = (sl) => (sl.check && sl.check.length ? sl.check : DEFAULT_CHECK);

function plannerSystem(S) {
  return `${S.ctx.PLANNER}\n\nAGENT: ${S.agent}\nREPO ROOT (absolute): ${S.cfg.root}\nALLOWED PATHS (relative to root): ${LAYER_HELP[S.agent]}\n\nSKILLS (excerpts, absolute paths):\n${clip(S.ctx.SKILLS, LIM.skills)}`;
}
function sliceHeader(S) {
  const s = slice(S);
  const idx = S.allSlices.findIndex((x) => x.id === s.id);
  const prev = S.allSlices.slice(0, Math.max(idx, 0)).map((x) => x.id).join(', ') || '(none)';
  return `FEATURE: ${s.id} - ${s.title}\nBRIEF: ${s.brief}\nEARLIER FEATURES OF THIS AGENT (already planned, do not re-plan): ${prev}\n\nAGENT SCOPE:\n${clip(S.ctx.SCOPE, LIM.scope)}\n\nREPO SNAPSHOT:\n${clip(S.ctx.SNAPSHOT, LIM.snap)}\n\nMEMORY BRIEF:\n${S.memctx}`;
}
function requiredList(S) {
  return checkOf(slice(S)).map(([h, kw]) => `- heading "${h}"` + ((kw || []).length ? ` mentioning: ${kw.join(', ')}` : '')).join('\n');
}

function gateFailures(S, a) {
  const out = [];
  if (a.error) out.push('apply error: ' + a.error);
  if (a.note) out.push(a.note);
  (a.rejected || []).forEach((r) => out.push(`rejected ${r.path}: ${r.reason}`));
  (a.missing || []).forEach((f) => out.push('declared file not written: ' + f));
  (a.checks || []).filter((c) => c.code !== 0).forEach((c) => out.push(`check failed (${c.cmd}) exit ${c.code}: ${clip(c.out, 600)}`));
  if (S.codeCut) out.push('your reply was cut off by the token limit: write the declared files completely and keep them shorter');
  return out;
}
function failGate(S, gate) {
  S.passed = false;
  S.feedback = gate.map((g, i) => `${i + 1}. ${g}`).join('\n');
  const a = S.apply || {};
  recordNext(S, 'qa', 'fail', `Task ${S.task.id} attempt ${S.attempt}. Automated gate failed: ${clip(S.feedback, 400)}\nWritten: ${(a.written || []).join(', ')}`, 'task_after');
  return S;
}

function route(S) {
  S.iter = (S.iter || 0) + 1;
  if (S.iter > S.cfg.maxIter) { S.abort = 'iteration cap reached'; S.step = 'done'; }
  delete S.cmd; delete S.req;
  for (;;) {
    switch (S.step) {
      case 'load_ctx':
        S.agent = S.cfg.agents[S.ai];
        return execCmd(S, `bash ${S.cfg.bin}/ctx.sh ${S.agent} ${S.cfg.root}`);

      case 'slice_start': {
        if (S.si >= S.slices.length) {
          if (S.phase === 1) { S.phase = 2; S.si = 0; continue; }
          S.step = 'agent_done'; continue;
        }
        const sl = slice(S); S.revs = 0; S.missing = []; S.md = ''; S.tasks = null; S.coder = '';
        if (S.phase === 1) { S.scopeKey = sl.id; S.step = 'have_plan'; continue; }
        const plan = S.plans[sl.id];
        if (!plan || !plan.tasks) { S.si++; continue; }
        S.ti = 0; S.sliceFail = 0;
        S.step = S.cfg.git ? 'feat_exists' : 'task_start'; continue;
      }

      case 'have_plan':
        return execCmd(S, `sh -c 'f=${S.cfg.root}/docs/agents/${S.agent}/${slice(S).id}.tasks.json; [ -s "$f" ] && cat "$f" || true'`);

      case 'feat_exists':
        return execCmd(S, `bash ${S.cfg.bin}/git-feature.sh exists ${S.cfg.root} ${slice(S).id}`);

      case 'task_start': {
        const sl = slice(S); const plan = S.plans[sl.id];
        if (S.ti >= plan.tasks.length) {
          if (S.cfg.git && S.sliceFail === 0) { S.step = 'ship'; continue; }
          S.si++; S.step = 'slice_start'; continue;
        }
        S.task = plan.tasks[S.ti]; S.attempt = 0; S.feedback = ''; S.readctx = '';
        S.scopeKey = sl.id + '/' + S.task.id;
        S.afterRecall = S.task.reads && S.task.reads.length ? 'reads' : 'code';
        S.step = 'recall'; continue;
      }

      case 'recall':
        return execCmd(S, memCmd(S, `recall ${S.agent} ${S.scopeKey} 12`));

      case 'brief':
        S.action = 'ministral';
        S.req = chat(S.ctx.MEMORY, `BRIEF for scope ${S.scopeKey} (agent ${S.agent}).\nEntries:\n${clip(S.memraw, LIM.memo)}`, TOK.brief, 0.1);
        return S;

      case 'reads': {
        const list = S.task.reads.map((f) => `"${f}"`).join(' ');
        return execCmd(S, `sh -c 'for f in ${list}; do if [ -f "$f" ]; then echo "--- $f ---"; head -c 1800 "$f"; echo; else echo "--- $f (does not exist yet) ---"; fi; done'`);
      }

      case 'plan_docs':
        S.action = 'deepseek';
        S.req = chat(plannerSystem(S), `${sliceHeader(S)}\n\nTASK: Write the specification for this feature and the executor task list. MD under 450 words. At most 5 tasks, at most 3 files per task.\nRequired headings:\n${requiredList(S)}\n\nReply with sections MD, TASKS, CODER, MEMORY.`, TOK.docs, 0.6);
        return S;

      case 'revise': {
        S.reviseFull = !S.md;
        S.action = 'deepseek';
        const ask = S.reviseFull
          ? `Your previous reply had no usable MD. Reply again with sections MD, TASKS, CODER, MEMORY. MD under 450 words.\nRequired headings:\n${requiredList(S)}`
          : `Your documentation is incomplete. Reply with ONLY the sections needed to fix these gaps (MD: only the missing headings, do not repeat finished parts; TASKS: the full JSON array):\n${S.missing.map((m) => '- ' + m).join('\n')}`;
        S.req = chat(plannerSystem(S), `${sliceHeader(S)}\n\n${ask}`, S.reviseFull ? TOK.docs : TOK.fix, 0.6);
        return S;
      }

      case 'write_docs':
        return execCmd(S, `php ${S.cfg.bin}/apply.php docs`, b64(JSON.stringify({ root: S.cfg.root, agent: S.agent, slice: slice(S).id, md: S.md, tasks: S.tasks || [] })));

      case 'record':
        S.action = 'ministral';
        S.req = chat(S.ctx.MEMORY, `RECORD for agent ${S.agent}, scope ${S.scopeKey}, status ${S.recStatus}.\nNotes:\n${clip(S.recRaw, 2500)}`, TOK.record, 0.1);
        return S;

      case 'mem_add':
        return execCmd(S, memCmd(S, `add ${S.agent} ${S.scopeKey} ${S.recKind} ${S.recStatus} ${b64(S.line)}`));

      case 'docs_next': S.si++; S.step = 'slice_start'; continue;

      case 'code': {
        const sl = slice(S); const plan = S.plans[sl.id]; const t = S.task;
        S.action = 'qwen';
        S.req = chat(`${S.ctx.CODER}\n\nREPO ROOT (absolute): ${S.cfg.root}\n\nSKILLS (excerpts, absolute paths):\n${clip(S.ctx.SKILLS, LIM.skills)}`,
          `TASK ${t.id} of feature ${sl.id}: ${t.title}\nFiles to write (absolute, write ONLY these):\n${t.files.map((f) => '- ' + f).join('\n')}\n\nINSTRUCTION:\n${t.instruction}\n\n${S.readctx ? `EXISTING FILES (read-only context; if one is also in the write list, output it COMPLETE and keep all existing content):\n${clip(S.readctx, LIM.reads)}\n\n` : ''}FEATURE BRIEF FROM PLANNER:\n${clip(plan.coder, LIM.brief)}\n\nMEMORY BRIEF:\n${S.memctx}\n${S.attempt > 0 ? `\nREVIEW FEEDBACK (attempt ${S.attempt}, fix all points):\n${clip(S.feedback, 1800)}\n` : ''}\nReply with FILE/END blocks, REPORT, MEMORY.`, TOK.code, 0.3);
        return S;
      }

      case 'apply':
        return execCmd(S, `php ${S.cfg.bin}/apply.php files`, b64(JSON.stringify({ root: S.cfg.root, files: S.files, checks: S.task.checks })));

      case 'qa': {
        const t = S.task; const a = S.apply || {};
        const shown = (S.files || []).map((f) => `--- ${f.path} ---\n${clip(f.content, LIM.file)}`).join('\n');
        const chk = (a.checks || []).map((c) => `$ ${c.cmd}\nexit ${c.code}\n${clip(c.out, 700)}`).join('\n');
        S.action = 'deepseek';
        S.req = chat(plannerSystem(S),
          `QA REVIEW of task ${t.id}: ${t.title}\nThe automated gate already PASSED (declared files written, paths allowed, checks exit 0). Review only what the gate cannot see: skill rules, layer rules, security, missing edge cases, missing unit tests.\nExpected files:\n${t.files.map((f) => '- ' + f).join('\n')}\n\nINSTRUCTION GIVEN:\n${t.instruction}\n\nEXECUTOR REPORT:\n${clip(S.report, 900)}\n\nCHECK RESULTS:\n${clip(chk, LIM.checks)}\n\nFILES:\n${clip(shown, LIM.files)}\n\nReply with sections VERDICT, FEEDBACK, MEMORY.`, TOK.qa, 0.4);
        return S;
      }

      case 'task_after': {
        const key = S.agent + ':' + slice(S).id + '/' + S.task.id;
        if (S.passed) { S.stats.pass.push(key); S.ti++; S.step = 'task_start'; continue; }
        S.attempt++;
        if (S.attempt > S.cfg.maxFix) { S.stats.fail.push(key); S.sliceFail++; S.ti++; S.step = 'task_start'; continue; }
        S.afterRecall = 'code'; S.step = 'recall'; continue;
      }

      case 'ship': {
        const sl = slice(S);
        return execCmd(S, `bash ${S.cfg.bin}/git-feature.sh ship ${S.cfg.root} ${sl.id} ${b64(sl.id + ': ' + sl.title)}`);
      }

      case 'agent_done':
        S.stats.agents.push(S.agent);
        S.ai++;
        if (S.ai >= S.cfg.agents.length) { S.step = 'done'; continue; }
        S.step = 'load_ctx'; continue;

      case 'done':
        S.action = 'done';
        return S;

      default:
        S.abort = 'unknown step ' + S.step; S.step = 'done'; continue;
    }
  }
}

function recordNext(S, kind, status, raw, after) {
  S.recKind = kind; S.recStatus = status; S.recRaw = raw; S.afterRecord = after; S.step = 'record';
}

function absorb(S, raw) {
  const llm = LLM_ACTIONS.includes(S.action);
  let text = ''; let err = null;
  S.cut = false;
  if (llm) {
    const ch = raw && raw.choices && raw.choices[0];
    text = (ch && ch.message && ch.message.content) || '';
    S.cut = !!(ch && ch.finish_reason === 'length');
    if (raw && raw.error) err = JSON.stringify(raw.error).slice(0, 300);
    S.maxPrompt = Math.max(S.maxPrompt || 0, S.req ? JSON.stringify(S.req.messages).length : 0);
    if (err) {
      S.llmErrs = (S.llmErrs || 0) + 1;
      S.lastLlmErr = `${S.action} @ ${S.step}: ${err}`;
      S.warn.push(`${S.step}: LLM error ${err.slice(0, 160)}`);
    } else {
      S.llmErrs = 0;
    }
    if (S.llmErrs >= 3) { S.abort = 'LLM unreachable or rejecting requests: ' + S.lastLlmErr; S.step = 'done'; return S; }
  } else {
    text = (raw && raw.stdout) || '';
    const rc = raw ? (raw.code !== undefined ? raw.code : raw.exitCode) : undefined;
    if (raw && raw.error) err = JSON.stringify(raw.error).slice(0, 400);
    else if (rc !== undefined && rc !== null && rc !== 0) err = String(raw.stderr || 'exit ' + rc).slice(0, 400);
  }
  if (llm && (err || (!String(text).trim() && !S.cut)) && (S.retry || 0) < 1) {
    S.retry = (S.retry || 0) + 1; S.warn.push(`${S.step}: empty/failed LLM response, retry ${S.retry}`); return S;
  }
  S.retry = 0;
  if (S.cut) S.warn.push(`${S.step}: reply cut by max_tokens`);
  if (err && !llm) S.warn.push(`${S.step}: ${err}`);

  switch (S.step) {
    case 'load_ctx': {
      if (err || !text.includes('=====SLICES=====')) { S.abort = 'ctx.sh failed: ' + (err || 'no output'); S.step = 'done'; return S; }
      S.ctx = ctxSections(text);
      let all; try { all = JSON.parse(S.ctx.SLICES); } catch (e) { S.abort = 'slices json invalid'; S.step = 'done'; return S; }
      const only = S.cfg.only || [];
      S.allSlices = all;
      S.slices = only.length ? all.filter((s) => { const code = String(s.id).split('-')[0]; return only.some((p) => (p.endsWith('*') ? code.startsWith(p.slice(0, -1)) : code === p)); }) : all;
      S.si = 0; S.phase = 1; S.plans = {}; S.step = 'slice_start'; return S;
    }
    case 'have_plan': {
      const sl = slice(S);
      let arr = null; try { arr = JSON.parse(text.trim()); } catch (e) { arr = null; }
      const tasks = validateTasks(arr, S.cfg.root, S.agent, sl.id);
      if (tasks) {
        S.plans[sl.id] = { tasks, coder: `Resumed from existing docs. Follow ${S.cfg.root}/docs/agents/${S.agent}/${sl.id}.md and the memory brief.`, docPath: null };
        S.stats.resumed.push(S.agent + ':' + sl.id); S.step = 'docs_next'; return S;
      }
      S.afterRecall = 'plan_docs'; S.step = 'recall'; return S;
    }
    case 'feat_exists': {
      if (!err && /DONE/.test(text)) { S.stats.skipped.push(S.agent + ':' + slice(S).id); S.si++; S.step = 'slice_start'; return S; }
      S.ti = 0; S.sliceFail = 0; S.step = 'task_start'; return S;
    }
    case 'recall': {
      const rows = text.trim();
      S.memraw = rows;
      if (!rows) { S.memctx = '(no prior memory for this scope)'; S.step = S.afterRecall; return S; }
      if (rows.length < 700) { S.memctx = rows; S.step = S.afterRecall; return S; }
      S.step = 'brief'; return S;
    }
    case 'brief': {
      const t = text.trim();
      S.memctx = !t || /^NONE$/i.test(t) ? clip(S.memraw, 700) : clip(t, LIM.brief);
      S.step = S.afterRecall; return S;
    }
    case 'reads': { S.readctx = clip(text, LIM.reads); S.step = 'code'; return S; }
    case 'plan_docs':
    case 'revise': {
      const sl = slice(S);
      const secs = sections(text);
      const md = pick(secs, 'MD');
      if (md) S.md = (S.step === 'revise' && !S.reviseFull && S.md) ? S.md + '\n\n' + unfence(md) : unfence(md);
      const tasks = validateTasks((() => { try { return JSON.parse(unfence(pick(secs, 'TASKS') || '')); } catch (e) { return null; } })(), S.cfg.root, S.agent, sl.id);
      if (tasks) S.tasks = tasks;
      S.coder = pick(secs, 'CODER') || S.coder;
      S.memo = pick(secs, 'MEMORY') || S.memo || '';
      const missing = S.md ? coverage(S.md, checkOf(sl)) : ['MD section is missing or the reply was truncated'];
      if (!S.tasks) missing.push(`TASKS must be a valid JSON array of at most 5 tasks, absolute file paths inside ${S.cfg.root}, only in: ${LAYER_HELP[S.agent]}`);
      S.missing = missing;
      if (missing.length && S.revs < S.cfg.maxRev) { S.revs++; S.step = 'revise'; return S; }
      if (!S.md) {
        S.stats.docsFailed.push(S.agent + ':' + sl.id);
        recordNext(S, 'plan', 'failed', `Planner produced no documentation for ${sl.id}.`, 'docs_next');
        return S;
      }
      if (missing.length) S.stats.docsIncomplete.push(S.agent + ':' + sl.id);
      S.step = 'write_docs'; return S;
    }
    case 'write_docs': {
      let r = null; try { r = JSON.parse(text.trim()); } catch (e) { r = null; }
      if (!r || !r.ok) { S.warn.push('write_docs failed: ' + (err || text).slice(0, 200)); }
      const sl = slice(S);
      S.plans[sl.id] = { tasks: S.tasks, coder: S.coder, docPath: r && r.path };
      recordNext(S, 'plan', S.missing.length ? 'incomplete' : 'ok',
        `Planner note: ${S.memo}\nDocs: ${(r && r.path) || 'not written'}\nTasks: ${(S.tasks || []).map((t) => t.id + ':' + t.title).join('; ')}\nMissing: ${S.missing.join('; ') || 'none'}`, 'docs_next');
      return S;
    }
    case 'record': {
      const fallback = String(S.recRaw).replace(/\s+/g, ' ').slice(0, 400);
      let line = text.replace(/\s+/g, ' ').trim() || fallback;
      if (/CONTRACT:/.test(S.recRaw) && !/^CONTRACT:/.test(line)) line = 'CONTRACT: ' + line.replace(/CONTRACT:\s*/g, '');
      S.line = line.slice(0, 500);
      S.step = 'mem_add'; return S;
    }
    case 'mem_add': S.step = S.afterRecord; return S;
    case 'code': {
      const secs = sections(text);
      const declared = S.task.files;
      const parsed = [];
      secs.forEach((s, i) => { if (s.name === 'FILE' && s.arg && (secs[i + 1] || !S.cut)) parsed.push({ path: s.arg, content: unfence(s.body) }); });
      S.files = parsed.filter((f) => declared.includes(f.path));
      const extra = parsed.filter((f) => !declared.includes(f.path)).map((f) => f.path);
      if (extra.length) S.warn.push(`${S.task.id}: ignored undeclared files ${extra.join(', ')}`);
      S.report = pick(secs, 'REPORT') || '';
      S.coderMemo = pick(secs, 'MEMORY') || '';
      S.codeCut = S.cut;
      if (!S.files.length) {
        S.apply = { written: [], rejected: [], checks: [], missing: declared, note: 'no complete FILE blocks for the declared files could be parsed from the executor reply' };
        return failGate(S, gateFailures(S, S.apply));
      }
      S.step = 'apply'; return S;
    }
    case 'apply': {
      let a; try { a = JSON.parse(text.trim()); } catch (e) { a = { written: [], rejected: [], checks: [], error: (err || text || 'apply.php returned no JSON').slice(0, 300) }; }
      a.missing = (S.task.files || []).filter((f) => !(a.written || []).includes(f));
      S.apply = a;
      const gate = gateFailures(S, a);
      if (gate.length) return failGate(S, gate);
      if (S.cfg.qa === false) {
        S.passed = true; S.feedback = '';
        recordNext(S, 'qa', 'pass', `Task ${S.task.id} attempt ${S.attempt}. Coder: ${S.coderMemo}\nVerdict: PASS (automated gate only).\nWritten: ${(a.written || []).join(', ')}\nChecks: ${(a.checks || []).map((c) => `${c.cmd}=>${c.code}`).join('; ')}`, 'task_after');
        return S;
      }
      S.step = 'qa'; return S;
    }
    case 'qa': {
      const secs = sections(text);
      const vt = pick(secs, 'VERDICT');
      if (!vt) S.warn.push(`${S.task.id}: reviewer returned no verdict (truncated?), passed on automated gate`);
      S.passed = vt ? /^\s*PASS\b/i.test(vt) : true;
      let fb = pick(secs, 'FEEDBACK') || '';
      if (!fb && !S.passed) fb = 'No feedback produced. Re-check the instruction against the files.';
      S.feedback = fb;
      const a = S.apply || {};
      const checks = (a.checks || []).map((c) => `${c.cmd}=>${c.code}`).join('; ');
      recordNext(S, 'qa', S.passed ? 'pass' : 'fail',
        `Task ${S.task.id} attempt ${S.attempt}. Coder: ${S.coderMemo}\nQA: ${pick(secs, 'MEMORY') || ''}\nVerdict: ${S.passed ? 'PASS' : 'FAIL'}. Feedback: ${clip(fb, 300)}\nWritten: ${(a.written || []).join(', ')}\nChecks: ${checks}`, 'task_after');
      return S;
    }
    case 'ship': {
      const id = S.agent + ':' + slice(S).id;
      if (err) { S.stats.gitFailed.push(id); } else { S.stats.shipped.push(id + (/NOTHING/.test(text) ? ' (no changes)' : '')); }
      S.si++; S.step = 'slice_start'; return S;
    }
    default:
      S.abort = 'absorb: unexpected step ' + S.step; S.step = 'done'; return S;
  }
}

function initialState(cfg) {
  return { cfg, step: 'load_ctx', ai: 0, iter: 0, retry: 0, llmErrs: 0, warn: [], stats: { pass: [], fail: [], docsIncomplete: [], docsFailed: [], agents: [], resumed: [], skipped: [], shipped: [], gitFailed: [] } };
}

function summary(S) {
  return { ok: !S.abort && !S.stats.fail.length, abort: S.abort || null, lastLlmError: S.lastLlmErr || null, maxPromptChars: S.maxPrompt || 0, agentsDone: S.stats.agents, tasksPassed: S.stats.pass.length, tasksFailed: S.stats.fail, docsIncomplete: S.stats.docsIncomplete, docsFailed: S.stats.docsFailed, resumed: S.stats.resumed, skippedFeatures: S.stats.skipped, shipped: S.stats.shipped, gitFailed: S.stats.gitFailed, warnings: S.warn.slice(-15), iterations: S.iter };
}

if (typeof module !== 'undefined') module.exports = { route, absorb, initialState, summary, sections, coverage, validateTasks, ctxSections };
/* ===== end engine ===== */
