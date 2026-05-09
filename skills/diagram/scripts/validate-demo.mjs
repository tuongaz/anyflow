#!/usr/bin/env bun
// Phase 7b — VALIDATE.
//
// Runs the assembled demo through the *same* Zod schema the studio uses
// (re-imports from apps/studio/src/schema.ts), plus skill-specific checks
// that the schema does not catch:
//   - Total node count <= 30 (warn at >25)
//   - At least one playable element when the user chose Tier 1 or Tier 2
//   - No playNode whose playAction.url is unreachable in the chosen tier
//   - Every event-connector eventName should appear in code or harness
//
// Exits non-zero if there are any issues. Warnings are surfaced but not
// fatal. Writes intermediate/validation-report.json.
//
// Usage:
//   bun validate-demo.mjs --root <target-repo>
//                         [--demo <path>]
//                         [--tier real|mock|static]
//                         [--out <intermediate/validation-report.json>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root ? resolvePath(args.root) : process.cwd();
const DEMO = args.demo ?? join(ROOT, '.anydemo/demo.json');
const TIER = args.tier ?? readTierFromEvidence(ROOT) ?? 'static';
const OUT = args.out ?? join(ROOT, '.anydemo/intermediate/validation-report.json');

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCHEMA_MODULE = resolvePath(SCRIPT_DIR, '../../../../../apps/studio/src/schema.ts');

main();

async function main() {
  if (!existsSync(DEMO)) die(`Cannot find demo at ${DEMO}.`);
  const demo = JSON.parse(readFileSync(DEMO, 'utf8'));

  const issues = [];
  const warnings = [];

  let DemoSchema;
  try {
    ({ DemoSchema } = await import(SCHEMA_MODULE));
  } catch (err) {
    die(`Failed to import studio schema from ${SCHEMA_MODULE}: ${String(err)}`);
  }

  const result = DemoSchema.safeParse(demo);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        kind: 'zod',
        path: issue.path.join('.') || '<root>',
        message: issue.message,
      });
    }
  }

  const nodeCount = demo.nodes?.length ?? 0;
  if (nodeCount > 30)
    issues.push({ kind: 'cap', message: `Node count ${nodeCount} exceeds soft cap 30` });
  else if (nodeCount > 25)
    warnings.push({ kind: 'cap', message: `Node count ${nodeCount} approaching cap 30` });

  const playable = (demo.nodes ?? []).filter(
    (n) => n.type === 'playNode' || (n.type === 'stateNode' && n.data?.playAction),
  );
  if (TIER !== 'static' && playable.length === 0) {
    issues.push({
      kind: 'tier-mismatch',
      message: `Tier '${TIER}' requires at least one playable node; found 0. Either add a playNode or pass --tier=static.`,
    });
  }

  const harnessRoutes = TIER === 'mock' ? loadHarnessRoutes(ROOT) : null;
  for (const n of demo.nodes ?? []) {
    const action = n.data?.playAction;
    if (!action || action.kind !== 'http' || !action.url) continue;
    if (
      TIER === 'mock' &&
      harnessRoutes &&
      !harnessHandles(harnessRoutes, action.url, action.method)
    ) {
      issues.push({
        kind: 'harness-coverage',
        message: `Node '${n.id}' references ${action.method} ${action.url} but the generated harness does not handle it.`,
      });
    }
    if (TIER === 'real') {
      warnings.push({
        kind: 'real-tier-reachability',
        message: `Node '${n.id}': ensure ${action.method} ${action.url} is reachable in your dev server before clicking.`,
      });
    }
  }

  const codeMentions = TIER !== 'static' ? buildEventIndex(ROOT) : new Set();
  for (const c of demo.connectors ?? []) {
    if (c.kind !== 'event') continue;
    if (TIER === 'static') continue;
    if (!codeMentions.has(c.eventName)) {
      warnings.push({
        kind: 'event-emitter-missing',
        message: `Event connector '${c.id}' references '${c.eventName}' but no emitter found in code or harness.`,
      });
    }
  }

  const stats = {
    tier: TIER,
    nodeCount,
    connectorCount: demo.connectors?.length ?? 0,
    playableCount: playable.length,
    issueCount: issues.length,
    warningCount: warnings.length,
  };

  const report = { generatedAt: new Date().toISOString(), demoPath: DEMO, stats, issues, warnings };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  for (const i of issues)
    console.error(`ISSUE  [${i.kind}] ${i.path ? `${i.path}: ` : ''}${i.message}`);
  for (const w of warnings) console.error(`WARN   [${w.kind}] ${w.message}`);
  console.error(
    `validate-demo: ${issues.length} issue(s), ${warnings.length} warning(s) (tier=${TIER})`,
  );

  process.exit(issues.length > 0 ? 1 : 0);
}

function readTierFromEvidence(root) {
  const path = join(root, '.anydemo/intermediate/tier-evidence.json');
  if (!existsSync(path)) return null;
  try {
    const ev = JSON.parse(readFileSync(path, 'utf8'));
    if (ev.chosenTier) return ev.chosenTier;
    if (ev.recommendation) return ev.recommendation.replace(/^tier/, '').toLowerCase();
  } catch {
    /* ignore */
  }
  return null;
}

function loadHarnessRoutes(root) {
  const path = join(root, '.anydemo/harness/server.ts');
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, 'utf8');
    const out = [];
    const re = /\bapp\.(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)['"]/gi;
    for (const m of content.matchAll(re)) {
      out.push({ method: m[1].toUpperCase(), path: m[2] });
    }
    return out;
  } catch {
    return [];
  }
}

function harnessHandles(routes, url, method) {
  const u = new URL(url);
  return routes.some((r) => r.path === u.pathname && (r.method === method || r.method === 'ANY'));
}

function buildEventIndex(root) {
  const set = new Set();
  const scan = join(root, '.anydemo/intermediate/boundary-surfaces.json');
  if (existsSync(scan)) {
    try {
      const surfaces = JSON.parse(readFileSync(scan, 'utf8'));
      for (const ev of surfaces.events ?? []) set.add(ev);
    } catch {
      /* ignore */
    }
  }
  const harness = join(root, '.anydemo/harness/server.ts');
  if (existsSync(harness)) {
    try {
      const content = readFileSync(harness, 'utf8');
      const re = /emit\s*\(\s*[^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/g;
      for (const m of content.matchAll(re)) set.add(m[1]);
    } catch {
      /* ignore */
    }
  }
  return set;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--demo' || a === '--tier' || a === '--out')
      out[a.slice(2)] = argv[++i];
    else if (a.includes('=')) {
      const [k, v] = a.split('=', 2);
      out[k.replace(/^--/, '')] = v;
    }
  }
  return out;
}

function die(msg) {
  console.error(`validate-demo: ${msg}`);
  process.exit(1);
}
