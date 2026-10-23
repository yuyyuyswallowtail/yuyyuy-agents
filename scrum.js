/* ===== yuyyuy scrum flow v1 (appended after engine.js; embedded in the same n8n Code nodes) =====
 * One sprint (= one feature, several role parts) at a time:
 *   kickoff (PM/llama) -> plan loop: every part planned by deepseek, PM gate APPROVE/REJECT (max 3 iterations)
 *   -> implement (writers: llama for database/uiux/qa, qwen for backend/frontend) -> QA tools -> PM final
 *   (deepseek) -> retro + next-scrum trigger (PM/llama) -> ship feat/<id> | park wip/<id>-<ts>.
 * Steps are prefixed sc_. State lives in S.sc and must stay JSON-serializable. The legacy task loop
 * (task_start/recall/reads/code/apply/task_after) is reused for implementation through small hooks in engine.js. */
const SC_ROLES = ['database', 'backend', 'uiux', 'frontend', 'qa'];
const SC_IMPL_ORDER = ['database', 'uiux', 'backend', 'frontend', 'qa']; // batches writers: llama, llama, qwen, qwen, llama
const SC_WRITER = { database: 'llama', backend: 'qwen', uiux: 'llama', frontend: 'qwen', qa: 'llama' };
const SC_TOK = { plan: 6000, fix: 6000, gate: 1800, final: 1800, kick: 800, retro: 800 };
const SC_LIM = { peers: 4500, facts: 3000, md: 1800, tool: 900, sum: 2600 };
const SC_ROLE_CHECK = { uiux: [['Purpose', []], ['Components', []], ['States', []], ['Accessibility', []]] };

function scrumInit(S) {
  S.step = 'sc_load';
  S.ctxRole = '';
  S.sc = { si: 0, finished: 0, sprints: [], written: [], failed: [], stats: { shipped: [], parked: [], gitFailed: [], gaps: [], lessons: [], planIter: {}, skipped: [], resumed: [] } };
}

// 'auto' lets qa-tools.sh decide from what is installed; true/false force it
const scFlag = (v) => (v === 'auto' || v === undefined ? 'auto' : (v ? 1 : 0));
const scCfg = (S) => Object.assign({ maxPlan: 3, maxRev: 2, maxProbe: 2, maxFinal: 2, maxSprints: 0, onBlocked: 'stop', qaMutation: 'auto', qaE2e: 'auto', e2eBlocking: false, requireTests: true, vision: 'auto', softGate: false }, S.cfg.scrum || {});

// load the bundle of one role (ctx.sh) before a step that needs its prompts, scope, skills and snapshot
function scNeed(S, role, step) {
  if (S.ctxRole === role) return false;
  S.ctxWant = role; S.afterCtx = step; S.step = 'sc_ctx';
  return true;
}
function scStatus(S, status, next) { S.sc.statusTo = status; S.sc.afterStatus = next; S.step = 'sc_status'; }
const scPartOf = (S, key) => S.sc.sp.parts.find((p) => p.key === key);
const scRel = (S, f) => (String(f).startsWith(S.cfg.root + '/') ? String(f).slice(S.cfg.root.length + 1) : String(f));
const scLines = (t) => String(t || '').split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);

// "backend: do x" lines (also "- **qa**: ..." and "ui/ux: ..."); continuation lines are appended to the previous item
function scRoleLines(text) {
  const out = []; let cur = null;
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const m = raw.match(/^\s*(?:[-*•]|\d+[.)])?\s*\**\s*(database|backend|ui\s*\/?\s*ux|frontend|qa)\s*\**\s*[:\-–]\s*(.*)$/i);
    if (m) { cur = { role: m[1].toLowerCase().replace(/[\s/]/g, ''), text: m[2].trim() }; out.push(cur); }
    else if (cur && raw.trim()) cur.text += ' ' + raw.trim();
  });
  return out;
}

// qa-tools.sh blocks: "@@ <name> exit=<n> blocking=<0|1> [note]" followed by the output tail
function scParseQa(text) {
  const out = []; let cur = null;
  String(text || '').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^@@ (\S+) exit=(\d+) blocking=([01])\s*(.*)$/);
    if (m) { cur = { name: m[1], exit: Number(m[2]), blocking: m[3] === '1', note: m[4], skipped: /SKIPPED/.test(m[4]), out: '' }; out.push(cur); }
    else if (cur) cur.out += l + '\n';
  });
  out.forEach((t) => { t.out = t.out.trim(); });
  return out;
}

function scRoleOfPath(rel) {
  if (/^(database\/|app\/(Models|Enums)\/|tests\/Unit\/(Models|Enums|Database)\/)/.test(rel)) return 'database';
  if (/^(docs\/design\/|resources\/css\/)/.test(rel)) return 'uiux';
  if (/^(resources\/|app\/Livewire\/|app\/View\/|routes\/features\/|public\/|tests\/Feature\/(Livewire|Public)\/)/.test(rel)) return 'frontend';
  if (/^tests\//.test(rel)) return 'qa';
  return 'backend';
}

// absolute project paths mentioned in a text (absolute, or relative to the repo root)
function scPathsIn(S, text) {
  const root = S.cfg.root; const found = [];
  const re = new RegExp('(?:' + esc(root) + '/|(?<![A-Za-z0-9_./-]))((?:app|routes|database|resources|tests|config|docs|public|bootstrap)/[A-Za-z0-9._/-]*[A-Za-z0-9_])', 'g');
  let m;
  while ((m = re.exec(String(text || '')))) { const abs = root + '/' + m[1]; if (!found.includes(abs)) found.push(abs); }
  return found;
}

// defects -> fix tasks for the writer of the role that owns the file (defects "fall back" to database/uiux/frontend/backend/qa)
function scFixTasks(S, items) {
  const sc = S.sc; const root = S.cfg.root; const by = {};
  items.forEach((it) => { if (SC_WRITER[it.role]) (by[it.role] = by[it.role] || []).push(it.text); });
  const out = [];
  SC_IMPL_ORDER.forEach((role) => {
    if (!by[role]) return;
    const text = by[role].join('\n');
    let files = scPathsIn(S, text).filter((f) => pathOk(f, root, role, sc.sp.id)).slice(0, 3);
    if (!files.length) files = sc.written.filter((f) => scRoleOfPath(scRel(S, f)) === role && pathOk(f, root, role, sc.sp.id)).slice(0, 3);
    if (!files.length) return;
    out.push({
      id: `${role}.fix${sc.round + 1}`, title: `fix defects (${role})`, role, writer: SC_WRITER[role], files, reads: files.slice(0, 3),
      checks: files.filter((f) => /\.php$/.test(f)).map((f) => `php -l ${f}`),
      instruction: `Fix ONLY these defects found by the final acceptance. Output each listed file COMPLETE and keep everything that already works.\n${clip(text, 1500)}`,
    });
  });
  return out.slice(0, 4);
}

// defects derived from failing blocking tools and failed tasks, independent of what the PM model wrote
function scEvidenceItems(S) {
  const sc = S.sc; const items = [];
  (sc.qa || []).filter((t) => t.blocking && !t.skipped && t.exit !== 0).forEach((t) => {
    const buckets = {};
    t.out.split('\n').forEach((line) => {
      const paths = scPathsIn(S, line);
      const role = paths.length ? scRoleOfPath(scRel(S, paths[0])) : 'backend';
      (buckets[role] = buckets[role] || []).push(line);
    });
    Object.keys(buckets).forEach((role) => items.push({ role, text: `${t.name} failed (exit ${t.exit}):\n${buckets[role].slice(0, 12).join('\n')}` }));
  });
  sc.failed.forEach((f) => {
    const role = f.files && f.files.length ? scRoleOfPath(scRel(S, f.files[0])) : 'backend';
    items.push({ role, text: `task ${f.key} failed its automated gate: ${f.feedback} (files: ${(f.files || []).join(', ')})` });
  });
  return items;
}

/* ---------- prompts ---------- */
const pmSystem = (S) => `${S.ctx.PM}\n\nPROJECT AND POLICY:\n${clip(S.ctx.SCOPE, LIM.scope)}`;
const scPartsList = (S) => S.sc.sp.parts.map((p) => `- ${p.role}: ${p.slice} - ${p.title}: ${clip(p.brief, 300)}`).join('\n');
function scCriteria(S, role) {
  const k = S.sc.kick || {};
  const c = (k.criteria || {})[role];
  return c && c.length ? c.map((x) => '- ' + x).join('\n') : '(none given: derive them from the brief)';
}
function scKickText(S) {
  const k = S.sc.kick || {};
  const crit = Object.keys(k.criteria || {}).map((r) => `${r}: ${(k.criteria[r] || []).join(' | ')}`).join('\n');
  return `GOAL: ${k.goal || S.sc.sp.brief}\nCRITERIA:\n${crit || '(none)'}\nRISKS: ${k.risks || '(none)'}`;
}
function scPeers(S, part) {
  let out = '';
  S.sc.sp.parts.forEach((p) => {
    const pl = S.sc.plans[p.key];
    if (p.key === part.key || !pl) return;
    const tl = (pl.tasks || []).map((t) => `${t.id}: ${t.title} -> ${t.files.join(', ')}`).join('\n');
    out += `--- ${p.key} (${p.role}) ---\n${clip(pl.md, SC_LIM.md)}\nTASKS:\n${tl || '(none)'}\n`;
  });
  return clip(out || '(no peer plan yet)', SC_LIM.peers);
}
function scClaimed(S, part) {
  const m = {};
  S.sc.sp.parts.forEach((p) => {
    const pl = S.sc.plans[p.key];
    if (p.key !== part.key && pl && pl.tasks) pl.tasks.forEach((t) => t.files.forEach((f) => { m[f] = p.key; }));
  });
  return m;
}
const scCheckOf = (part) => SC_ROLE_CHECK[part.role] || (part.check && part.check.length ? part.check : DEFAULT_CHECK);
const scReqList = (part) => scCheckOf(part).map(([h, kw]) => `- heading "${h}"` + ((kw || []).length ? ` mentioning: ${kw.join(', ')}` : '')).join('\n');

function scPlanSystem(S, part) {
  return `${S.ctx.PLANNER}\n\n${S.ctx.TEAM}\n\nAGENT: ${part.role}\nREPO ROOT (absolute): ${S.cfg.root}\nALLOWED PATHS (relative to root): ${LAYER_HELP[part.role]}\n\nSKILLS (excerpts, absolute paths):\n${clip(S.ctx.SKILLS, LIM.skills)}${depsBlock(S)}`;
}
function scPlanUser(S, part) {
  const sc = S.sc; const sp = sc.sp; const cur = sc.cur; const fb = sc.fb[part.role];
  const ask = !cur.md
    ? `TASK: Write the plan for this part. MD under 450 words. At most 5 tasks, at most 3 files per task. Every entry in 'files' must be ONE concrete file path (example: ${S.cfg.root}/app/Models/User.php): never a directory, never braces {}, never wildcards.\nRequired headings:\n${scReqList(part)}\n\nReply with sections MD, TASKS, CODER, MEMORY (add GAP only if a rule is missing). If you are not SURE of an API, reply FIRST with only <<<PROBE>>>.`
    : `Your plan is incomplete. Reply with ONLY the sections needed to fix these gaps (MD: only the missing headings, do not repeat finished parts; TASKS: the full JSON array):\n${sc.missing.map((m) => '- ' + m).join('\n')}`;
  const facts = sc.facts[part.key] ? `\nVERIFIED FACTS (answers to your probes; they win over your memory):\n${sc.facts[part.key]}\n` : '';
  return `SPRINT ${sp.id} - ${sp.title} (plan iteration ${sc.iter} of ${scCfg(S).maxPlan})\n${scKickText(S)}\n\nYOUR PART: ${part.key} - ${part.title}\nBRIEF: ${part.brief}\nACCEPTANCE CRITERIA FOR ${part.role}:\n${scCriteria(S, part.role)}\n`
    + (fb ? `\nPM FEEDBACK YOU MUST FIX (iteration ${sc.iter - 1}):\n${fb}\n` : '')
    + `\nPEER PLANS (reuse their exact names; their files are taken):\n${scPeers(S, part)}\n${facts}\nAGENT SCOPE:\n${clip(S.ctx.SCOPE, LIM.scope)}\n\nREPO SNAPSHOT:\n${clip(S.ctx.SNAPSHOT, LIM.snap)}\n\nMEMORY BRIEF:\n${S.memctx}\n\n${ask}`;
}
function scPlansText(S) {
  return S.sc.sp.parts.map((p) => {
    const pl = S.sc.plans[p.key];
    if (!pl || pl.failed) return `--- ${p.key} (${p.role}) ---\nNO VALID PLAN (engine could not obtain MD and TASKS)\n`;
    const tl = pl.tasks.map((t) => `${t.id}: ${t.title} -> ${t.files.join(', ')}${t.reads.length ? ' [reads ' + t.reads.length + ']' : ''}`).join('\n');
    const notes = [].concat(pl.missing.length ? ['ENGINE: still incomplete: ' + pl.missing.join('; ')] : [], pl.dropped.length ? ['ENGINE: dropped duplicate file claims: ' + pl.dropped.join('; ')] : []).join('\n');
    return `--- ${p.key} (${p.role}) ---\n${clip(pl.md, SC_LIM.md)}\nTASKS:\n${tl}\n${notes}\n`;
  }).join('\n');
}
function scGateUser(S) {
  const sc = S.sc; const last = sc.iter >= scCfg(S).maxPlan;
  const prev = sc.gate.length ? `\nPREVIOUS GATE FEEDBACK:\n${clip(sc.gate[sc.gate.length - 1].feedback, 900)}\n` : '';
  return `MODE: GATE\nITERATION ${sc.iter} OF ${scCfg(S).maxPlan}${last ? ' (LAST: approve unless a defect would break the build, leak data or skip authorization)' : ''}\nSPRINT ${sc.sp.id} - ${sc.sp.title}\n${scKickText(S)}\n${prev}\nPLANS:\n${scPlansText(S)}\nMEMORY BRIEF:\n${S.memctx}\n\nReply with sections VERDICT, FEEDBACK, MEMORY.`;
}
function scQaText(S) {
  return (S.sc.qa || []).map((t) => `- ${t.name}: ${t.skipped ? 'SKIPPED (' + t.note + ')' : (t.exit === 0 ? 'PASS' : 'FAIL exit ' + t.exit)} (${t.blocking ? 'blocking' : 'advisory'})`
    + (!t.skipped && t.exit !== 0 ? '\n' + clip(t.out, SC_LIM.tool) : '')).join('\n') || '(no QA tool output)';
}
function scFinalUser(S) {
  const sc = S.sc;
  const failed = sc.failed.map((f) => `- ${f.key}: ${f.feedback}`).join('\n') || '(none)';
  return `MODE: FINAL\nSPRINT ${sc.sp.id} - ${sc.sp.title} (acceptance round ${sc.round + 1} of ${scCfg(S).maxFinal + 1})\n${scKickText(S)}\n\nFILES WRITTEN (${sc.written.length}):\n${clip(sc.written.map((f) => scRel(S, f)).join('\n'), 1800)}\n\nFAILED TASKS:\n${failed}\n\nQA TOOLS:\n${scQaText(S)}\n\nMEMORY BRIEF:\n${S.memctx}\n\nReply with sections VERDICT, FEEDBACK, LESSON, GAP, MEMORY.`;
}
function scPmDoc(S) {
  const sc = S.sc; const k = sc.kick || {};
  const gates = sc.gate.map((g) => `- iteration ${g.iter}: ${g.verdict}${g.feedback ? ' - ' + g.feedback.replace(/\n/g, ' ') : ''}`).join('\n') || '- (none)';
  return `# Sprint ${sc.sp.id} - ${sc.sp.title}\n\nOutcome: ${sc.outcome}${sc.reason ? ' (' + sc.reason + ')' : ''}\n\n## Goal\n${k.goal || sc.sp.brief}\n\n## Acceptance criteria\n${scKickText(S)}\n\n## Plan gate\n${gates}\n\n## Final acceptance\n${sc.final ? sc.final.verdict + (sc.final.feedback ? ' - ' + sc.final.feedback.replace(/\n/g, ' ') : '') : '(not reached)'}\n\n${scQaText(S)}\n\n## Retro\n${(sc.retro && sc.retro.retro) || '(none)'}\n\nNext sprint must know: ${(sc.retro && sc.retro.next) || '(none)'}\n\n## Lessons (review, then promote to memory or scope/rules)\n${sc.lessons.join('\n') || '(none)'}\n\n## Gaps: rules the skills did not cover (review, then add to scope/rules/<vendor>__<package>.md)\n${sc.gaps.join('\n') || '(none)'}\n`;
}

/* ---------- router: one step per call; returns S when an action is ready, null to let the main loop continue ---------- */
// A reply sometimes leaks a section delimiter into the body, and a revision used to be appended whole, which
// duplicated headings (and let the model contradict its first attempt). Keep the first text; only add headings
// that are new, and replace a heading only when the engine asked for exactly that one.
function cleanMd(md) {
  return String(md || '').replace(/\r/g, '').replace(/^[ \t]*(<<<[A-Z]*(?: [^>\n]*)?(>>>)?|>>>)[ \t]*$/gm, '').replace(/\s+$/, '');
}
const mdParts = (md) => String(md || '').split(/^(?=#{1,6}[ \t]+\S)/m).filter((x) => x.trim());
const mdKey = (x) => ((x.match(/^#{1,6}[ \t]+(.*)$/m) || [, ''])[1] || '').trim().toLowerCase();
function mergeMd(old, add, missing) {
  const want = (missing || []).map((m) => { const x = /^heading "(.+?)"/.exec(m); return x ? x[1].toLowerCase() : null; }).filter(Boolean);
  const out = mdParts(cleanMd(old)); const idx = {};
  out.forEach((x, i) => { idx[mdKey(x)] = i; });
  mdParts(cleanMd(add)).forEach((x) => {
    const k = mdKey(x); if (!k) return;
    if (k in idx) { if (want.some((w) => k.includes(w))) out[idx[k]] = x; } else { idx[k] = out.length; out.push(x); }
  });
  return out.map((x) => x.replace(/\s+$/, '')).join('\n\n');
}

// Vision review (gemma3): the newest E2E screenshots are sent as OpenAI-style image_url parts.
function chatVision(system, user, images, max, temp) {
  const content = [{ type: 'text', text: user }].concat(images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.b64}` } })));
  return { model: 'local', messages: [{ role: 'system', content: system }, { role: 'user', content }], max_tokens: max, temperature: temp, stream: false };
}
const SC_VISION_SYSTEM = 'You review screenshots of a web application against its design specification. Reply ONLY with lines, one per screenshot or problem: "OK <file>" when it matches, or "ISSUE <file>: <one short, concrete problem>". Look for: wrong palette or fonts, overlapping or clipped text, missing empty/loading/error states, low contrast, raw error pages or debug output, broken layout on the page width. At most 6 lines. Do not invent problems you cannot see.';
function scVisionUser(S) {
  const sc = S.sc; const ui = sc.sp.parts.filter((p) => p.role === 'uiux').map((p) => sc.plans[p.key]).filter((pl) => pl && pl.md).map((pl) => clip(pl.md, 1500)).join('\n');
  return `SPRINT ${sc.sp.id} - ${sc.sp.title}\nDESIGN SPEC:\n${ui || '(none for this sprint: judge general quality)'}\n\nSCREENSHOTS (in this order): ${sc.shots.map((x) => x.path).join(', ')}`;
}

function scrumRoute(S) {
  const sc = S.sc; const cfg = scCfg(S); const root = S.cfg.root; const bin = S.cfg.bin; const sp = sc.sp;
  switch (S.step) {
    case 'sc_load': return execCmd(S, `bash ${bin}/mem.sh migrate`);
    case 'sc_ctx': return execCmd(S, `bash ${bin}/ctx.sh ${S.ctxWant} ${root}`);
    case 'sc_status': return execCmd(S, memCmd(S, `conv-status ${sc.conv} ${sc.statusTo}${sc.statusTo === 'planning' ? ' ' + sc.iter : ''}`));

    case 'sc_next': {
      if (sc.si >= sc.sprints.length || (cfg.maxSprints && sc.finished >= cfg.maxSprints)) { S.step = 'done'; return null; }
      sc.sp = sc.sprints[sc.si];
      Object.assign(sc, { plans: {}, fb: {}, iter: 0, round: 0, gate: [], kick: null, facts: {}, gaps: [], lessons: [], written: [], failed: [], qa: null, final: null, retro: null, outcome: '', reason: '', conv: '', decision: '' });
      S.sliceFail = 0;
      S.step = S.cfg.git ? 'sc_exists' : 'sc_open';
      return null;
    }
    case 'sc_exists': return execCmd(S, `bash ${bin}/git-feature.sh exists ${root} ${sp.id}`);
    case 'sc_open': return execCmd(S, memCmd(S, `conv-open ${sp.id} ${b64(sp.id + ': ' + sp.title)}`));

    case 'sc_resume': {
      const files = sp.parts.map((p) => `"${root}/docs/agents/${p.role}/${p.slice}.tasks.json"`).join(' ');
      return execCmd(S, `sh -c 'i=0; for f in ${files}; do echo "@@PART $i"; [ -s "$f" ] && cat "$f"; i=$((i+1)); done; true'`);
    }

    case 'sc_kickoff':
      if (scNeed(S, 'pm', 'sc_kickoff')) return null;
      S.agent = 'pm'; S.scopeKey = sp.id; S.afterRecall = 'sc_kickoff_call'; S.step = 'recall';
      return null;
    case 'sc_kickoff_call':
      S.action = 'llama';
      S.req = chat(pmSystem(S), `MODE: KICKOFF\nSPRINT: ${sp.id} - ${sp.title}\nBRIEF: ${sp.brief}\nPARTS (role: slice - title: brief):\n${scPartsList(S)}\n\nHANDOFF FROM THE PREVIOUS SPRINT: ${sc.next || '(none)'}\n\nMEMORY BRIEF:\n${S.memctx}\n\nReply with sections GOAL, CRITERIA, RISKS, MEMORY.`, SC_TOK.kick, 0.3);
      return S;

    case 'sc_plan_start':
      sc.iter = 1; sc.redo = sp.parts.map((p) => p.key); sc.qi = 0;
      scStatus(S, 'planning', 'sc_part');
      return null;

    case 'sc_part': {
      if (sc.qi >= sc.redo.length) { S.step = 'sc_gate'; return null; }
      const part = scPartOf(S, sc.redo[sc.qi]);
      sc.part = part; sc.revs = 0; sc.probes = 0; sc.missing = [];
      sc.cur = { md: '', tasks: null, coder: '', memo: '', gap: '' };
      if (scNeed(S, part.role, 'sc_part_go')) return null;
      S.step = 'sc_part_go';
      return null;
    }
    case 'sc_part_go':
      S.agent = sc.part.role; S.scopeKey = sp.id + '/' + sc.part.slice; S.afterRecall = 'sc_plan_call'; S.step = 'recall';
      return null;
    case 'sc_plan_call':
      S.action = 'deepseek';
      S.req = chat(scPlanSystem(S, sc.part), scPlanUser(S, sc.part), sc.cur.md ? SC_TOK.fix : SC_TOK.plan, 0.6);
      return S;
    case 'sc_probe':
      return execCmd(S, `bash ${bin}/probe.sh ${root}`, b64(sc.probeLines.join('\n')));
    case 'sc_part_next': sc.qi++; S.step = 'sc_part'; return null;

    case 'sc_gate':
      if (scNeed(S, 'pm', 'sc_gate')) return null;
      S.agent = 'pm'; S.scopeKey = sp.id; S.afterRecall = 'sc_gate_call'; S.step = 'recall';
      return null;
    case 'sc_gate_call':
      S.action = 'deepseek';
      S.req = chat(pmSystem(S), scGateUser(S), SC_TOK.gate, 0.3);
      return S;
    case 'sc_gate_next': {
      if (sc.decision === 'approve') { sc.afterDocs = 'sc_impl_start'; S.step = 'sc_docs_start'; return null; }
      if (sc.iter >= cfg.maxPlan) {
        sc.outcome = 'blocked'; sc.reason = `plan rejected by the PM gate ${sc.iter} times`; sc.afterDocs = 'sc_retro'; S.step = 'sc_docs_start';
        return null;
      }
      sc.iter++; sc.qi = 0;
      scStatus(S, 'planning', 'sc_part');
      return null;
    }

    case 'sc_docs_start': sc.di = 0; S.step = 'sc_docs'; return null;
    case 'sc_docs': {
      if (sc.di >= sp.parts.length) { S.step = sc.afterDocs; return null; }
      const p = sp.parts[sc.di]; const pl = sc.plans[p.key];
      if (!pl || !pl.md) { sc.di++; return null; }
      return execCmd(S, `php ${bin}/apply.php docs`, b64(JSON.stringify({ root, agent: p.role, slice: p.slice, md: pl.md, tasks: pl.tasks || [] })));
    }

    case 'sc_impl_start': {
      const tasks = [];
      SC_IMPL_ORDER.forEach((role) => sp.parts.filter((p) => p.role === role).forEach((p) => {
        const pl = sc.plans[p.key];
        (pl.tasks || []).forEach((t) => {
          const reads = t.reads.slice();
          const spec = `${root}/docs/design/${p.slice}.md`;
          if (role === 'frontend' && sp.parts.some((q) => q.role === 'uiux' && q.slice === p.slice) && !reads.includes(spec)) reads.unshift(spec);
          tasks.push(Object.assign({}, t, { id: `${p.role}.${p.slice}.${t.id}`, role, writer: SC_WRITER[role], reads: reads.slice(0, 3), coder: pl.coder }));
        });
      }));
      S.slices = [{ id: sp.id, title: sp.title, brief: sp.brief }]; S.allSlices = S.slices; S.si = 0;
      S.plans = { [sp.id]: { tasks, coder: 'Follow the task instruction and the exact names in the plan docs under docs/agents/.' } };
      S.ti = 0; S.sliceFail = 0; sc.failed = [];
      scStatus(S, 'executing', 'task_start');
      return null;
    }
    case 'sc_impl_done': scStatus(S, 'review', 'sc_qa_run'); return null;
    case 'sc_qa_run': return execCmd(S, `env QA_MUTATION=${scFlag(cfg.qaMutation)} QA_E2E=${scFlag(cfg.qaE2e)} QA_E2E_BLOCKING=${cfg.e2eBlocking ? 1 : 0} QA_REQUIRE_TESTS=${cfg.requireTests ? 1 : 0} bash ${bin}/qa-tools.sh ${root}`);

    case 'sc_vision': return execCmd(S, `php ${bin}/shots.php ${root} 3 450000`);
    case 'sc_vision_call':
      S.action = 'gemma';
      S.req = chatVision(SC_VISION_SYSTEM, scVisionUser(S), sc.shots, 500, 0.2);
      sc.shotNames = sc.shots.map((x) => x.path); delete sc.shots;
      return S;
    case 'sc_final':
      if (scNeed(S, 'pm', 'sc_final')) return null;
      S.agent = 'pm'; S.scopeKey = sp.id; S.afterRecall = 'sc_final_call'; S.step = 'recall';
      return null;
    case 'sc_final_call':
      S.action = 'deepseek';
      S.req = chat(pmSystem(S), scFinalUser(S), SC_TOK.final, 0.3);
      return S;
    case 'sc_final_next': {
      if (sc.decision === 'ship') { sc.outcome = 'shipped'; sc.reason = ''; S.step = 'sc_retro'; return null; }
      if (sc.decision === 'fix') {
        S.plans[sp.id].tasks = sc.fixTasks; S.ti = 0; S.sliceFail = 0; sc.failed = []; sc.round++;
        scStatus(S, 'executing', 'task_start');
        return null;
      }
      sc.outcome = 'blocked'; S.step = 'sc_retro';
      return null;
    }

    case 'sc_retro':
      if (scNeed(S, 'pm', 'sc_retro')) return null;
      S.action = 'llama';
      S.req = chat(pmSystem(S), `MODE: RETRO\nSPRINT ${sp.id} - ${sp.title}\nOUTCOME: ${sc.outcome}${sc.reason ? ' (' + sc.reason + ')' : ''}\n${scKickText(S)}\n\nPLAN GATE:\n${sc.gate.map((g) => `iteration ${g.iter}: ${g.verdict} ${clip(g.feedback, 300)}`).join('\n') || '(none)'}\nFINAL: ${sc.final ? sc.final.verdict + ' ' + clip(sc.final.feedback, 400) : '(not reached)'}\nQA TOOLS:\n${scQaText(S)}\nFILES WRITTEN: ${sc.written.length}\nLESSONS SO FAR:\n${sc.lessons.join('\n') || '(none)'}\n\nReply with sections RETRO, NEXT, LESSON, MEMORY.`, SC_TOK.retro, 0.3);
      return S;
    case 'sc_store': {
      const adds = [];
      const add = (kind, text) => adds.push(`bash ${bin}/mem.sh add pm global ${kind} ok ${b64(clip(text, 500))} ${sp.id} llama retro ${sc.iter}`);
      if (sc.retro && sc.retro.next) add('handoff', `HANDOFF after ${sp.id} (${sc.outcome}): ${sc.retro.next}`);
      sc.lessons.slice(-3).forEach((l) => add('lesson', l));
      if (!adds.length) { S.step = 'sc_pmdoc'; return null; }
      return execCmd(S, `sh -c '${adds.join('; ')}'`);
    }
    case 'sc_pmdoc': return execCmd(S, `php ${bin}/apply.php docs`, b64(JSON.stringify({ root, agent: 'pm', slice: sp.id, md: scPmDoc(S) })));
    case 'sc_close':
      if (!S.cfg.git) { S.step = 'sc_closed'; return null; }
      return execCmd(S, `bash ${bin}/git-feature.sh ${sc.outcome === 'shipped' ? 'ship' : 'park'} ${root} ${sp.id} ${b64(sp.id + ': ' + sp.title)}`);
    case 'sc_closed':
      scStatus(S, sc.outcome === 'shipped' ? 'shipped' : 'blocked', 'sc_advance');
      return null;
    case 'sc_advance':
      sc.finished++; sc.stats.gaps.push(...sc.gaps); sc.stats.lessons.push(...sc.lessons);
      if (sc.outcome !== 'shipped' && cfg.onBlocked === 'stop') { S.abort = `sprint ${sp.id} is blocked (${sc.reason || 'see docs/agents/pm'}): parked for human review, run stopped`; S.step = 'done'; return null; }
      sc.si++; S.step = 'sc_next';
      return null;

    default:
      S.abort = 'unknown scrum step ' + S.step; S.step = 'done';
      return null;
  }
}

/* ---------- absorb: parse the result of the action issued by scrumRoute ---------- */
function scAbort(S, msg) { S.abort = msg; S.step = 'done'; return S; }
function scAddLessons(S, secs) {
  scLines(pick(secs, 'LESSON')).forEach((l) => {
    const t = /^LESSON:/i.test(l) ? l : 'LESSON: ' + l;
    if (S.sc.lessons.length < 6 && !S.sc.lessons.includes(t)) S.sc.lessons.push(t);
  });
}

function scrumAbsorb(S, text, err) {
  const sc = S.sc; const cfg = scCfg(S); const root = S.cfg.root; const sp = sc.sp;
  switch (S.step) {
    case 'sc_load':
      if (err) return scAbort(S, 'mem.sh migrate failed (is sqlite3 installed where the Exec node runs?): ' + err);
      S.ctxWant = 'pm'; S.afterCtx = 'sc_next'; S.step = 'sc_ctx';
      return S;

    case 'sc_ctx': {
      if (err || !text.includes('=====PLANNER=====')) return scAbort(S, `ctx.sh ${S.ctxWant} failed: ${err || 'no output'}`);
      const c = ctxSections(text);
      if (!sc.loaded) {
        let all; try { all = JSON.parse(c.SPRINTS); } catch (e) { return scAbort(S, 'sprint backlog JSON invalid (php bin/sprints.php scope)'); }
        const only = S.cfg.only || [];
        sc.sprints = only.length ? all.filter((s) => { const code = String(s.id).split('-')[0]; return only.some((p) => (p.endsWith('*') ? code.startsWith(p.slice(0, -1)) : code === p)); }) : all;
        sc.loaded = true;
      }
      delete c.SPRINTS; delete c.SLICES;
      S.ctx = c; S.ctxRole = S.ctxWant; S.step = S.afterCtx;
      return S;
    }

    case 'sc_status': S.step = sc.afterStatus; return S;

    case 'sc_exists':
      if (!err && /DONE/.test(text)) { sc.stats.skipped.push(sp.id); sc.si++; S.step = 'sc_next'; return S; }
      S.step = 'sc_open';
      return S;
    case 'sc_open': sc.conv = sp.id; S.step = 'sc_resume'; return S;

    case 'sc_resume': {
      const chunks = text.split(/^@@PART (\d+)\s*$/m); const found = {};
      for (let i = 1; i < chunks.length; i += 2) {
        const part = sp.parts[Number(chunks[i])]; let arr = null;
        try { arr = JSON.parse(String(chunks[i + 1] || '').trim()); } catch (e) { arr = null; }
        const tasks = part ? validateTasks(arr, root, part.role, part.slice) : null;
        if (tasks) found[part.key] = tasks;
      }
      if (sp.parts.every((p) => found[p.key])) {
        sp.parts.forEach((p) => {
          sc.plans[p.key] = { role: p.role, slice: p.slice, title: p.title, md: '(resumed from docs)', tasks: found[p.key], coder: `Resumed from existing docs. Follow ${root}/docs/agents/${p.role}/${p.slice}.md and the memory brief.`, missing: [], dropped: [], failed: false };
        });
        sc.kick = { goal: sp.brief, criteria: {}, risks: '' };
        sc.stats.resumed.push(sp.id); S.step = 'sc_impl_start';
        return S;
      }
      S.step = 'sc_kickoff';
      return S;
    }

    case 'sc_kickoff_call': {
      const secs = sections(text); const goal = pick(secs, 'GOAL'); const criteria = {};
      scRoleLines(pick(secs, 'CRITERIA')).forEach((l) => { (criteria[l.role] = criteria[l.role] || []).push(l.text); });
      sc.kick = { goal: goal || sp.brief, criteria, risks: scLines(pick(secs, 'RISKS')).join(' | ') };
      if (!goal) S.warn.push('kickoff: no usable PM reply, using the backlog brief as the goal');
      recordNext(S, 'kickoff', goal ? 'ok' : 'failed', `Kickoff ${sp.id}: ${pick(secs, 'MEMORY') || sc.kick.goal}\nCriteria: ${Object.keys(criteria).map((r) => r + ' ' + criteria[r].length).join(', ') || 'none'}`, 'sc_plan_start', 'llama', 'kickoff');
      return S;
    }

    case 'sc_plan_call': {
      const part = sc.part; const cur = sc.cur; const secs = sections(text);
      const probe = pick(secs, 'PROBE');
      if (probe && !pick(secs, 'MD') && sc.probes < cfg.maxProbe) {
        sc.probeLines = scLines(probe).slice(0, 5); sc.probes++;
        if (sc.probeLines.length) { S.step = 'sc_probe'; return S; }
      }
      const md = pick(secs, 'MD');
      if (md) cur.md = cur.md && sc.revs > 0 ? mergeMd(cur.md, unfence(md), sc.missing) : cleanMd(unfence(md));
      const why = []; const tb = pick(secs, 'TASKS'); let arr = null;
      if (tb == null) why.push('TASKS section is missing: add a <<<TASKS>>> header line followed by the JSON array');
      else { try { arr = JSON.parse(unfence(tb)); } catch (e) { why.push('TASKS is not valid JSON (' + e.message + ')'); } }
      const tasks = arr == null ? null : validateTasks(arr, root, part.role, part.slice, why);
      if (tasks) cur.tasks = tasks;
      cur.coder = pick(secs, 'CODER') || cur.coder; cur.memo = pick(secs, 'MEMORY') || cur.memo;
      scLines(pick(secs, 'GAP')).forEach((g) => { const line = `${part.key}: ${g}`; if (!sc.gaps.includes(line) && sc.gaps.length < 12) sc.gaps.push(line); });
      const missing = cur.md ? coverage(cur.md, scCheckOf(part)) : ['MD section is missing or the reply was truncated'];
      if (!cur.tasks) missing.push(`TASKS must be a valid JSON array of at most 5 tasks, absolute file paths inside ${root}, only in: ${LAYER_HELP[part.role]}` + (why.length ? `\nWhy your previous TASKS was rejected:\n- ${why.slice(0, 6).join('\n- ')}` : ''));
      const claimed = scClaimed(S, part); const conflicts = [];
      if (cur.tasks) cur.tasks.forEach((t) => t.files.forEach((f) => { if (claimed[f]) conflicts.push(`${f} (owned by ${claimed[f]})`); }));
      conflicts.forEach((c) => missing.push(`file already owned by a peer part, remove it or use "reads": ${c}`));
      if (cfg.requireTests && (part.role === 'backend' || part.role === 'frontend') && cur.tasks && !cur.tasks.some((t) => t.files.some((f) => /\/tests\/[^/]+\/.*\.php$/.test(f) || /\/tests\/.*\.(spec|test)\.[jt]s$/.test(f)))) {
        missing.push(`TASKS must include at least one TEST task: a Pest file for the behaviour you add (${part.role === 'backend' ? 'tests/Unit/<Layer>/<Name>Test.php' : 'tests/Feature/Livewire/<Name>Test.php'}); the exact class and method names come from your own plan`);
      }
      sc.missing = missing;
      if (missing.length && sc.revs < cfg.maxRev) { sc.revs++; return S; } // same step: the router asks again for the gaps only
      const dropped = [];
      if (cur.tasks && conflicts.length) {
        cur.tasks = cur.tasks.map((t) => Object.assign({}, t, { files: t.files.filter((f) => { if (claimed[f]) { dropped.push(`${f} (owned by ${claimed[f]})`); return false; } return true; }) })).filter((t) => t.files.length);
        if (!cur.tasks.length) cur.tasks = null;
      }
      const failed = !cur.md || !cur.tasks;
      const left = missing.filter((m) => !/^file already owned/.test(m));
      sc.plans[part.key] = { role: part.role, slice: part.slice, title: part.title, md: cur.md, tasks: cur.tasks, coder: cur.coder, memo: cur.memo, missing: left, dropped, failed };
      recordNext(S, 'plan', failed ? 'failed' : (left.length ? 'incomplete' : 'ok'),
        `Plan ${part.key} (iteration ${sc.iter}): ${cur.memo}\nTasks: ${(cur.tasks || []).map((t) => t.id + ':' + t.title).join('; ') || 'none'}\nMissing: ${left.join('; ') || 'none'}`, 'sc_part_next', 'deepseek', 'plan');
      return S;
    }
    case 'sc_probe':
      sc.facts[sc.part.key] = clip(((sc.facts[sc.part.key] || '') + '\n' + (text || '(probe returned nothing' + (err ? ': ' + err : '') + ')')).trim(), SC_LIM.facts);
      S.step = 'sc_plan_call';
      return S;

    case 'sc_gate_call': {
      const secs = sections(text); const vt = pick(secs, 'VERDICT');
      let approve = !/REJECT/i.test(vt || ''); let fb = pick(secs, 'FEEDBACK') || '';
      if (!vt) S.warn.push('gate: PM returned no verdict, approved on the engine checks');
      const bad = sp.parts.filter((p) => !sc.plans[p.key] || sc.plans[p.key].failed);
      if (bad.length) { approve = false; fb += '\n' + bad.map((p) => `${p.role}: no valid plan for ${p.slice}: produce MD and TASKS`).join('\n'); }
      sc.fb = {};
      if (!approve && cfg.softGate && sc.iter >= cfg.maxPlan && !bad.length) { approve = true; S.warn.push(`gate: soft-approved at the last iteration (softGate); the PM still wanted: ${clip(fb, 200)}`); fb = 'soft-approved after ' + sc.iter + ' rejections. ' + fb; }
      if (!approve) {
        scRoleLines(fb).forEach((l) => { sc.fb[l.role] = ((sc.fb[l.role] || '') + ' ' + l.text).trim(); });
        let redo = sp.parts.filter((p) => sc.fb[p.role]).map((p) => p.key);
        if (!redo.length) { redo = sp.parts.map((p) => p.key); sp.parts.forEach((p) => { sc.fb[p.role] = clip(fb || 'rejected without detail', 600); }); }
        sc.redo = redo;
      }
      sc.gate.push({ iter: sc.iter, verdict: approve ? 'APPROVE' : 'REJECT', feedback: clip(fb, 900) });
      sc.stats.planIter[sp.id] = sc.iter;
      sc.decision = approve ? 'approve' : 'reject';
      recordNext(S, 'gate', approve ? 'approve' : 'reject', `Gate iteration ${sc.iter}: ${approve ? 'APPROVE' : 'REJECT'}. ${pick(secs, 'MEMORY') || ''}\nFeedback: ${clip(fb, 300)}`, 'sc_gate_next', 'deepseek', 'gate');
      return S;
    }

    case 'sc_docs': {
      let r = null; try { r = JSON.parse(text.trim()); } catch (e) { r = null; }
      if (!r || !r.ok) S.warn.push(`docs write failed for ${sp.parts[sc.di].key}: ${(err || text).slice(0, 120)}`);
      sc.di++;
      return S;
    }

    case 'sc_qa_run':
      sc.qa = scParseQa(text);
      if (!sc.qa.length) S.warn.push('qa-tools.sh returned no tool blocks' + (err ? ': ' + err : ''));
      S.step = cfg.vision === false ? 'sc_final' : 'sc_vision';
      return S;

    case 'sc_vision': {
      let shots = []; try { shots = JSON.parse(String(text || '').trim()); } catch (e) { shots = []; }
      sc.shots = (Array.isArray(shots) ? shots : []).filter((x) => x && x.b64 && x.path).slice(0, 3);
      S.step = sc.shots.length ? 'sc_vision_call' : 'sc_final';
      return S;
    }
    case 'sc_vision_call': {
      S.req = null;
      const issues = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^ISSUE\s/i.test(l)).slice(0, 6);
      if (err || !String(text || '').trim()) S.warn.push('vision review returned nothing' + (err ? ': ' + err : ''));
      else sc.qa.push({ name: 'vision', exit: issues.length ? 1 : 0, blocking: false, note: 'advisory (gemma3 on ' + (sc.shotNames || []).length + ' screenshot(s))', skipped: false, out: issues.join('\n') });
      S.step = 'sc_final';
      return S;
    }

    case 'sc_final_call': {
      const secs = sections(text); const vt = pick(secs, 'VERDICT') || ''; const fbText = pick(secs, 'FEEDBACK') || '';
      if (!vt) S.warn.push('final: PM returned no verdict, decided on the QA evidence');
      let approve = !/REJECT/i.test(vt);
      const evidence = scEvidenceItems(S); let override = false;
      if (approve && evidence.length) { approve = false; override = true; }
      scAddLessons(S, secs);
      scLines(pick(secs, 'GAP')).forEach((g) => { const line = `${sp.id}: ${g}`; if (!sc.gaps.includes(line) && sc.gaps.length < 12) sc.gaps.push(line); });
      const fb = fbText + (override ? '\nENGINE: the PM approved but a blocking check or task failed; defects were taken from the tool output.' : '');
      sc.final = { verdict: approve ? 'APPROVE' : 'REJECT', feedback: clip(fb, 900) };
      if (approve) sc.decision = 'ship';
      else {
        const items = scRoleLines(fbText).concat(evidence);
        const fix = sc.round < cfg.maxFinal ? scFixTasks(S, items) : [];
        if (fix.length) { sc.fixTasks = fix; sc.decision = 'fix'; }
        else { sc.decision = 'block'; sc.reason = sc.round >= cfg.maxFinal ? `final acceptance rejected after ${sc.round + 1} rounds` : 'rejected and no fixable file could be identified'; }
      }
      recordNext(S, 'final', approve ? 'approve' : 'reject', `Final round ${sc.round + 1}: ${sc.final.verdict}. ${pick(secs, 'MEMORY') || ''}\nFeedback: ${clip(fb, 300)}\nTools: ${(sc.qa || []).map((t) => t.name + '=' + (t.skipped ? 'skip' : t.exit)).join(' ')}`, 'sc_final_next', 'deepseek', 'final');
      return S;
    }

    case 'sc_retro': {
      const secs = sections(text);
      sc.retro = { retro: scLines(pick(secs, 'RETRO')).join(' | '), next: scLines(pick(secs, 'NEXT')).join(' ') };
      scAddLessons(S, secs);
      if (!sc.retro.retro && !sc.retro.next) S.warn.push('retro: no usable PM reply');
      sc.next = sc.retro.next;
      recordNext(S, 'retro', sc.outcome, `Retro ${sp.id} ${sc.outcome}: ${pick(secs, 'MEMORY') || sc.retro.retro}`, 'sc_store', 'llama', 'retro');
      return S;
    }
    case 'sc_store': S.step = 'sc_pmdoc'; return S;
    case 'sc_pmdoc': {
      let r = null; try { r = JSON.parse(text.trim()); } catch (e) { r = null; }
      if (!r || !r.ok) S.warn.push('pm doc write failed: ' + (err || text).slice(0, 120));
      S.step = 'sc_close';
      return S;
    }
    case 'sc_close':
      if (sc.outcome === 'shipped') {
        if (err) sc.stats.gitFailed.push(sp.id); else sc.stats.shipped.push(sp.id + (/NOTHING/.test(text) ? ' (no changes)' : ''));
      } else {
        sc.stats.parked.push(`${sp.id}: ${err ? 'git park failed' : (text.trim() || 'parked')} - ${sc.reason}`);
        if (err) sc.stats.gitFailed.push(sp.id);
      }
      S.step = 'sc_closed';
      return S;

    default:
      return scAbort(S, 'absorb: unexpected scrum step ' + S.step);
  }
}

function scrumSummary(S) {
  const sc = S.sc;
  return {
    ok: !S.abort && !sc.stats.parked.length && !sc.stats.gitFailed.length, mode: 'scrum', abort: S.abort || null,
    lastLlmError: S.lastLlmErr || null, maxPromptChars: S.maxPrompt || 0,
    shipped: sc.stats.shipped, parked: sc.stats.parked, skipped: sc.stats.skipped, resumed: sc.stats.resumed, gitFailed: sc.stats.gitFailed,
    planIterations: sc.stats.planIter, tasksPassed: S.stats.pass.length, taskGateFailures: S.stats.fail.length,
    gapsToReview: sc.stats.gaps, lessons: sc.stats.lessons, warnings: S.warn.slice(-15), iterations: S.iter,
  };
}
/* ===== end scrum ===== */
