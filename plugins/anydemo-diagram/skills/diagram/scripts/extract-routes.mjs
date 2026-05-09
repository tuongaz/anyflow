#!/usr/bin/env bun
// Extract HTTP routes, queue names, and event names from a target codebase
// using regex patterns per framework. Deterministic — no LLM.
//
// Reads scan-result.json for the file list and frameworks. Writes
// intermediate/boundary-surfaces.json containing { routes, queues, events }.
//
// Usage:
//   bun extract-routes.mjs --root <target-repo>
//                          [--scan <intermediate/scan-result.json>]
//                          [--out <intermediate/boundary-surfaces.json>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root ? resolvePath(args.root) : process.cwd();
const SCAN_PATH = args.scan ?? join(ROOT, '.anydemo/intermediate/scan-result.json');
const OUT = args.out ?? join(ROOT, '.anydemo/intermediate/boundary-surfaces.json');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

const ROUTE_PATTERNS = {
  expressLike: {
    regex: new RegExp(
      String.raw`\b(?:app|router|api|server|fastify|router2)\.(` +
        HTTP_METHODS.join('|') +
        String.raw`)\s*\(\s*['"\`]([^'"\`]+)['"\`]`,
      'gi',
    ),
    methodIdx: 1,
    pathIdx: 2,
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
  },
  honoChain: {
    regex: new RegExp(
      String.raw`\.(` + HTTP_METHODS.join('|') + String.raw`)\s*\(\s*['"\`]([^'"\`]+)['"\`]`,
      'gi',
    ),
    methodIdx: 1,
    pathIdx: 2,
    extensions: ['.ts', '.tsx', '.js', '.mjs'],
  },
  nestController: {
    regex: /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*['"]([^'"]*)['"]?/g,
    methodIdx: 1,
    pathIdx: 2,
    extensions: ['.ts'],
  },
  flask: {
    regex: /@\w+\.route\s*\(\s*['"]([^'"]+)['"]/g,
    methodIdx: null,
    pathIdx: 1,
    extensions: ['.py'],
  },
  fastapi: {
    regex: new RegExp(
      String.raw`@\w+\.(` + HTTP_METHODS.join('|') + String.raw`)\s*\(\s*['"]([^'"]+)['"]`,
      'g',
    ),
    methodIdx: 1,
    pathIdx: 2,
    extensions: ['.py'],
  },
  django: {
    regex: /\bpath\s*\(\s*['"]([^'"]*)['"]/g,
    methodIdx: null,
    pathIdx: 1,
    extensions: ['.py'],
  },
  rails: {
    regex: new RegExp(
      String.raw`\b(` + HTTP_METHODS.join('|') + String.raw`)\s+['"]([^'"]+)['"]\s*,\s*to:`,
      'g',
    ),
    methodIdx: 1,
    pathIdx: 2,
    extensions: ['.rb'],
  },
  goChi: {
    regex: /\b\w+\.(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*"([^"]+)"/g,
    methodIdx: 1,
    pathIdx: 2,
    extensions: ['.go'],
  },
};

const QUEUE_PATTERNS = [
  /\bqueue\.(?:send|publish|enqueue|push)\s*\(\s*['"]([^'"]+)['"]/g,
  /new\s+Queue\s*\(\s*['"]([^'"]+)['"]/g,
  /\b\w+\.(?:assertQueue|sendToQueue)\s*\(\s*['"]([^'"]+)['"]/g,
  /QueueName:\s*['"]([^'"]+)['"]/g,
  /\bXADD\s+['"]([^'"]+)['"]/gi,
];

const EVENT_PATTERNS = [
  /\b(?:bus|emitter|eventBus|events|pubsub)\.(?:publish|emit|fire|broadcast)\s*\(\s*['"]([a-zA-Z0-9_.\-:]+)['"]/g,
  /topic:\s*['"]([a-zA-Z0-9_.\-:]+)['"]/g,
  /\bthis\.emit\s*\(\s*['"]([a-zA-Z0-9_.\-:]+)['"]/g,
];

main();

function main() {
  if (!existsSync(SCAN_PATH))
    die(`Cannot find scan-result.json at ${SCAN_PATH}. Run scan-target.mjs first.`);
  const scan = JSON.parse(readFileSync(SCAN_PATH, 'utf8'));

  const codeFiles = scan.files.filter((f) => f.category === 'code');
  const routes = [];
  const queues = new Set();
  const events = new Set();

  for (const f of codeFiles) {
    const abs = join(ROOT, f.path);
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    extractFromFile(f.path, content, routes, queues, events);
  }

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    routes: dedupeRoutes(routes),
    queues: [...queues].sort(),
    events: [...events].sort(),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.error(
    `extract-routes: wrote ${OUT} (${result.routes.length} routes, ${result.queues.length} queues, ${result.events.length} events)`,
  );
}

function extractFromFile(path, content, routes, queues, events) {
  const ext = `.${path.split('.').pop()}`;
  for (const [name, pat] of Object.entries(ROUTE_PATTERNS)) {
    if (!pat.extensions.includes(ext)) continue;
    for (const match of content.matchAll(pat.regex)) {
      const route = (pat.pathIdx ? match[pat.pathIdx] : '').trim();
      if (!route) continue;
      const method = pat.methodIdx ? String(match[pat.methodIdx]).toUpperCase() : 'ANY';
      const line = lineOf(content, match.index ?? 0);
      routes.push({ method, path: route, filePath: path, line, framework: name });
    }
  }
  for (const re of QUEUE_PATTERNS) {
    for (const m of content.matchAll(re)) queues.add(m[1]);
  }
  for (const re of EVENT_PATTERNS) {
    for (const m of content.matchAll(re)) {
      const ev = m[1];
      if (/^[A-Za-z0-9_.\-:]+$/.test(ev) && ev.length < 80) events.add(ev);
    }
  }
}

function dedupeRoutes(routes) {
  const map = new Map();
  for (const r of routes) {
    const key = `${r.method}\t${r.path}\t${r.filePath}`;
    if (!map.has(key)) map.set(key, r);
  }
  return [...map.values()];
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--scan' || a === '--out') out[a.slice(2)] = argv[++i];
    else if (a.startsWith('--root=')) out.root = a.slice('--root='.length);
    else if (a.startsWith('--scan=')) out.scan = a.slice('--scan='.length);
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
  }
  return out;
}

function die(msg) {
  console.error(`extract-routes: ${msg}`);
  process.exit(1);
}
