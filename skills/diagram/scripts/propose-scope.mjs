#!/usr/bin/env bun
// Phase 2 helper — entry-point heuristic scoring (deterministic).
//
// Reads scan-result.json and ranks candidate entry-point files by name and
// position. The `scope-proposer` agent uses this list as a hint; the agent
// (not this script) makes the actual scope decision.
//
// Usage:
//   bun propose-scope.mjs --root <target-repo>
//                         [--scan <intermediate/scan-result.json>]
//                         [--out <intermediate/entry-candidates.json>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root ? resolvePath(args.root) : process.cwd();
const SCAN_PATH = args.scan ?? join(ROOT, '.anydemo/intermediate/scan-result.json');
const OUT = args.out ?? join(ROOT, '.anydemo/intermediate/entry-candidates.json');

const ENTRY_NAMES = [
  'server.ts',
  'server.js',
  'index.ts',
  'index.js',
  'app.ts',
  'app.js',
  'main.ts',
  'main.js',
  'app.py',
  'main.py',
  'wsgi.py',
  'asgi.py',
  'manage.py',
  'main.go',
  'main.rs',
  'application.rb',
  'config.ru',
];

main();

function main() {
  if (!existsSync(SCAN_PATH)) die(`Cannot find scan-result.json at ${SCAN_PATH}.`);
  const scan = JSON.parse(readFileSync(SCAN_PATH, 'utf8'));
  const candidates = [];
  for (const f of scan.files ?? []) {
    if (f.category !== 'code') continue;
    const score = scoreFile(f.path);
    if (score > 0) candidates.push({ path: f.path, score, reasons: scoreReasons(f.path) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidates: candidates.slice(0, 30),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.error(`propose-scope: wrote ${OUT} (${result.candidates.length} candidates)`);
}

function scoreFile(path) {
  let score = 0;
  const base = path.split('/').pop() ?? '';
  if (ENTRY_NAMES.includes(base)) score += 10;
  if (path.startsWith('src/')) score += 4;
  if (path.startsWith('apps/')) score += 3;
  const depth = path.split('/').length;
  score += Math.max(0, 6 - depth);
  if (/\bindex\.(ts|js)$/i.test(path)) score += 2;
  if (/\b(server|app|main)\.(ts|js|py|go|rs)$/i.test(path)) score += 5;
  if (/test|spec|__tests__|\.test\.|\.spec\./i.test(path)) score -= 8;
  if (path.includes('node_modules')) score -= 50;
  return score;
}

function scoreReasons(path) {
  const reasons = [];
  const base = path.split('/').pop() ?? '';
  if (ENTRY_NAMES.includes(base)) reasons.push(`canonical entry name: ${base}`);
  if (path.startsWith('src/') || path.startsWith('apps/'))
    reasons.push('top-level src/apps directory');
  if (path.split('/').length <= 3) reasons.push('shallow path');
  return reasons;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--scan' || a === '--out') out[a.slice(2)] = argv[++i];
    else if (a.includes('=')) {
      const [k, v] = a.split('=', 2);
      out[k.replace(/^--/, '')] = v;
    }
  }
  return out;
}

function die(msg) {
  console.error(`propose-scope: ${msg}`);
  process.exit(1);
}
