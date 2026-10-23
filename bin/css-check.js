#!/usr/bin/env node
// Dependency-free sanity check for generated CSS (design tokens). Prints "<file>:<line>: <reason>" per problem, exits 0.
// Catches what small models get wrong: custom properties outside a rule, filesystem paths in url(), invalid value ranges, unbalanced braces.
const fs = require('fs');

function check(file) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = []; let depth = 0; let line = 1; let buf = ''; let start = 1;
  const flush = () => {
    const b = buf.trim();
    if (b) {
      if (depth === 0 && /^--[\w-]+\s*:/.test(b)) out.push(`${file}:${start}: custom property outside a rule (wrap it in :root { } or @theme { })`);
      const val = b.includes(':') ? b.slice(b.indexOf(':') + 1) : '';
      if (/url\(\s*['"]?(\/workspace\/|\/home\/|file:|[A-Za-z]:\\)/.test(b)) out.push(`${file}:${start}: filesystem path in url() (use a web path such as /fonts/Inter.woff2)`);
      if (val && /(^|[\s(,])\d+(\.\d+)?-\d+(\.\d+)?(px|rem|em|vh|vw|%)(\s|;|,|\)|$)/.test(val.replace(/url\([^)]*\)/g, ''))) out.push(`${file}:${start}: invalid value (a range such as 24-32px is not CSS): ${val.trim().slice(0, 60)}`);
    }
    buf = '';
  };
  for (const ch of text) {
    if (ch === '\n') line++;
    if (ch === '{') { flush(); depth++; start = line; }
    else if (ch === '}') { flush(); depth--; start = line; if (depth < 0) { out.push(`${file}:${line}: unbalanced }`); depth = 0; } }
    else if (ch === ';') { flush(); start = line; }
    else { if (!buf.trim()) start = line; buf += ch; }
  }
  if (depth > 0) out.push(`${file}:${line}: unbalanced { (${depth} block(s) never closed)`);
  return out;
}

process.argv.slice(2).forEach((f) => check(f).slice(0, 8).forEach((l) => console.log(l)));
