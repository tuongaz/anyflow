#!/usr/bin/env bun
// Phase 7a — ASSEMBLE.
//
// Concatenates wiring-plan.json + layout.json into a single Demo object,
// normalizes IDs, deduplicates nodes/connectors, drops dangling references,
// and snaps positions to a 24px grid. No LLM. No schema validation here —
// validate-demo.mjs is the gatekeeper.
//
// Usage:
//   bun assemble-demo.mjs --root <target-repo>
//                         [--wiring <path>]
//                         [--layout <path>]
//                         [--out <path>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root ? resolvePath(args.root) : process.cwd();
const WIRING = args.wiring ?? join(ROOT, '.anydemo/intermediate/wiring-plan.json');
const LAYOUT = args.layout ?? join(ROOT, '.anydemo/intermediate/layout.json');
const OUT = args.out ?? join(ROOT, '.anydemo/demo.json');
const GRID = 24;

const stats = {
  nodesIn: 0,
  connectorsIn: 0,
  nodesOut: 0,
  connectorsOut: 0,
  duplicateNodesDropped: 0,
  duplicateConnectorsDropped: 0,
  danglingConnectorsDropped: 0,
  positionsSnapped: 0,
  positionsShifted: 0,
};

main();

function main() {
  if (!existsSync(WIRING)) die(`Cannot find wiring at ${WIRING}.`);
  const wiring = JSON.parse(readFileSync(WIRING, 'utf8'));
  const layout = existsSync(LAYOUT) ? JSON.parse(readFileSync(LAYOUT, 'utf8')) : { positions: {} };

  stats.nodesIn = wiring.nodes?.length ?? 0;
  stats.connectorsIn = wiring.connectors?.length ?? 0;

  const nodes = normalizeNodes(wiring.nodes ?? [], layout.positions ?? {});
  const nodeIds = new Set(nodes.map((n) => n.id));
  const connectors = normalizeConnectors(wiring.connectors ?? [], nodeIds);
  const positionedNodes = breakOverlap(nodes);

  stats.nodesOut = positionedNodes.length;
  stats.connectorsOut = connectors.length;

  const demo = {
    version: 1,
    name: wiring.name ?? 'Untitled diagram',
    nodes: positionedNodes,
    connectors,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(demo, null, 2)}\n`);

  console.error('assemble-demo: wrote', OUT);
  console.error('assemble-demo: stats', JSON.stringify(stats));
}

function normalizeNodes(rawNodes, positionMap) {
  const seen = new Map();
  for (const raw of rawNodes) {
    const id = slugify(raw.id);
    if (!id) continue;
    const pos = positionMap[id] ?? raw.position ?? { x: 0, y: 0 };
    const snapped = {
      x: Math.round(pos.x / GRID) * GRID,
      y: Math.round(pos.y / GRID) * GRID,
    };
    if (snapped.x !== pos.x || snapped.y !== pos.y) stats.positionsSnapped++;
    if (seen.has(id)) {
      stats.duplicateNodesDropped++;
    }
    seen.set(id, { ...raw, id, position: snapped });
  }
  return [...seen.values()];
}

function normalizeConnectors(rawConnectors, nodeIds) {
  const seen = new Map();
  for (const raw of rawConnectors) {
    const id = slugify(raw.id ?? `c-${raw.source}-${raw.target}`);
    const source = slugify(raw.source);
    const target = slugify(raw.target);
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      stats.danglingConnectorsDropped++;
      continue;
    }
    const key = [source, target, raw.kind, raw.sourceHandle ?? '', raw.targetHandle ?? ''].join(
      '\t',
    );
    if (seen.has(key)) {
      stats.duplicateConnectorsDropped++;
    }
    seen.set(key, { ...raw, id, source, target });
  }
  return [...seen.values()];
}

function breakOverlap(nodes) {
  const taken = new Map();
  const NUDGE = GRID;
  return nodes.map((n) => {
    let { x, y } = n.position;
    let key = `${x},${y}`;
    let attempts = 0;
    while (taken.has(key) && attempts < 100) {
      x += NUDGE;
      y += NUDGE;
      key = `${x},${y}`;
      attempts++;
      stats.positionsShifted++;
    }
    taken.set(key, true);
    return { ...n, position: { x, y } };
  });
}

function slugify(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--wiring' || a === '--layout' || a === '--out')
      out[a.slice(2)] = argv[++i];
    else if (a.includes('=')) {
      const [k, v] = a.split('=', 2);
      out[k.replace(/^--/, '')] = v;
    }
  }
  return out;
}

function die(msg) {
  console.error(`assemble-demo: ${msg}`);
  process.exit(1);
}
