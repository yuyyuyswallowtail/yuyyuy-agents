// pathOk / validateTasks / coverage regressions for the "backend always incomplete" case
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const e = new Function(src + ';return { coverage, pathOk, validateTasks, DEFAULT_CHECK };')();
const root = '/workspace/app';
assert.strictEqual(e.pathOk(root + '/app/Http/Controllers/', root, 'backend', '01'), false, 'directory path must be rejected');
assert.strictEqual(e.pathOk(root + '/app/Services/A.php', root, 'backend', '01'), true);
assert.strictEqual(e.pathOk(root + '/app/{Models,X}/A.php', root, 'backend', '01'), false);
const why = [];
assert.strictEqual(e.validateTasks([{ id: 't1', instruction: 'x', files: [root + '/app/Http/Controllers/'] }], root, 'backend', '01', why), null);
assert(why.length === 1 && /rejected file/.test(why[0]), why.join());
assert.deepStrictEqual(e.coverage('## Files by layer\n## Contract\n## Edge cases\n## Test plan\n', e.DEFAULT_CHECK), [], 'tolerant headings');
assert.strictEqual(e.coverage('## Contracts\n## Edge Cases\n## Test Plan\n', e.DEFAULT_CHECK).length, 1, 'missing heading still reported');
console.log('ENGINE_PATHS_OK');
