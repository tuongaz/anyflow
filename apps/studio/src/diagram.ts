import { z } from 'zod';
import { DemoSchema } from './schema.ts';

// Pure-compute helpers backing the three diagram-pipeline endpoints. No file
// I/O lives here — the skill writes responses to disk on the user's machine.
// Logic was extracted from skills/diagram/scripts/{propose-scope,assemble-demo,
// validate-demo}.mjs so it can be exercised in-process and via HTTP.

// === propose-scope =========================================================

const ScanFileSchema = z
  .object({
    path: z.string(),
    category: z.string(),
  })
  .passthrough();

export const ProposeScopeRequestSchema = z.object({
  files: z.array(ScanFileSchema),
});

export type ProposeScopeRequest = z.infer<typeof ProposeScopeRequestSchema>;

export interface ScopeCandidate {
  path: string;
  score: number;
  reasons: string[];
}

const ENTRY_NAMES = new Set([
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
]);

const scoreFile = (path: string): number => {
  let score = 0;
  const base = path.split('/').pop() ?? '';
  if (ENTRY_NAMES.has(base)) score += 10;
  if (path.startsWith('src/')) score += 4;
  if (path.startsWith('apps/')) score += 3;
  const depth = path.split('/').length;
  score += Math.max(0, 6 - depth);
  if (/\bindex\.(ts|js)$/i.test(path)) score += 2;
  if (/\b(server|app|main)\.(ts|js|py|go|rs)$/i.test(path)) score += 5;
  if (/test|spec|__tests__|\.test\.|\.spec\./i.test(path)) score -= 8;
  if (path.includes('node_modules')) score -= 50;
  return score;
};

const scoreReasons = (path: string): string[] => {
  const reasons: string[] = [];
  const base = path.split('/').pop() ?? '';
  if (ENTRY_NAMES.has(base)) reasons.push(`canonical entry name: ${base}`);
  if (path.startsWith('src/') || path.startsWith('apps/'))
    reasons.push('top-level src/apps directory');
  if (path.split('/').length <= 3) reasons.push('shallow path');
  return reasons;
};

export const proposeScope = (req: ProposeScopeRequest): { candidates: ScopeCandidate[] } => {
  const candidates: ScopeCandidate[] = [];
  for (const f of req.files) {
    if (f.category !== 'code') continue;
    const score = scoreFile(f.path);
    if (score > 0) candidates.push({ path: f.path, score, reasons: scoreReasons(f.path) });
  }
  candidates.sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, 30) };
};

// === assemble ==============================================================

const GRID = 24;

const WiringNodeSchema = z
  .object({
    id: z.string().min(1),
    position: z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .optional(),
  })
  .passthrough();

const WiringConnectorSchema = z
  .object({
    id: z.string().optional(),
    source: z.string().min(1),
    target: z.string().min(1),
  })
  .passthrough();

export const AssembleRequestSchema = z.object({
  wiring: z.object({
    name: z.string().optional(),
    nodes: z.array(WiringNodeSchema),
    connectors: z.array(WiringConnectorSchema),
  }),
  layout: z
    .object({
      positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
    })
    .optional(),
});

export type AssembleRequest = z.infer<typeof AssembleRequestSchema>;

export interface AssembleStats {
  nodesIn: number;
  connectorsIn: number;
  nodesOut: number;
  connectorsOut: number;
  duplicateNodesDropped: number;
  duplicateConnectorsDropped: number;
  danglingConnectorsDropped: number;
  positionsSnapped: number;
  positionsShifted: number;
}

export interface AssembleResult {
  demo: {
    version: 1;
    name: string;
    nodes: Array<Record<string, unknown>>;
    connectors: Array<Record<string, unknown>>;
  };
  stats: AssembleStats;
}

const slugify = (raw: string): string =>
  String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const assembleDemo = (req: AssembleRequest): AssembleResult => {
  const stats: AssembleStats = {
    nodesIn: req.wiring.nodes.length,
    connectorsIn: req.wiring.connectors.length,
    nodesOut: 0,
    connectorsOut: 0,
    duplicateNodesDropped: 0,
    duplicateConnectorsDropped: 0,
    danglingConnectorsDropped: 0,
    positionsSnapped: 0,
    positionsShifted: 0,
  };

  const positions = req.layout?.positions ?? {};
  const nodes = normalizeNodes(req.wiring.nodes, positions, stats);
  const nodeIds = new Set(nodes.map((n) => n.id as string));
  const connectors = normalizeConnectors(req.wiring.connectors, nodeIds, stats);
  const positionedNodes = autoLayout(nodes, connectors, stats);

  stats.nodesOut = positionedNodes.length;
  stats.connectorsOut = connectors.length;

  return {
    demo: {
      version: 1,
      name: req.wiring.name ?? 'Untitled diagram',
      nodes: positionedNodes,
      connectors,
    },
    stats,
  };
};

const normalizeNodes = (
  rawNodes: ReadonlyArray<Record<string, unknown>>,
  positionMap: Record<string, { x: number; y: number }>,
  stats: AssembleStats,
): Array<Record<string, unknown>> => {
  const seen = new Map<string, Record<string, unknown>>();
  for (const raw of rawNodes) {
    const id = slugify(String(raw.id ?? ''));
    if (!id) continue;
    const rawPos = positionMap[id] ??
      (raw.position as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    const snapped = {
      x: Math.round(rawPos.x / GRID) * GRID,
      y: Math.round(rawPos.y / GRID) * GRID,
    };
    if (snapped.x !== rawPos.x || snapped.y !== rawPos.y) stats.positionsSnapped++;
    if (seen.has(id)) stats.duplicateNodesDropped++;
    seen.set(id, { ...raw, id, position: snapped });
  }
  return [...seen.values()];
};

const normalizeConnectors = (
  rawConnectors: ReadonlyArray<Record<string, unknown>>,
  nodeIds: Set<string>,
  stats: AssembleStats,
): Array<Record<string, unknown>> => {
  const seen = new Map<string, Record<string, unknown>>();
  for (const raw of rawConnectors) {
    const source = slugify(String(raw.source ?? ''));
    const target = slugify(String(raw.target ?? ''));
    const id = slugify(String(raw.id ?? `c-${source}-${target}`));
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      stats.danglingConnectorsDropped++;
      continue;
    }
    const key = [
      source,
      target,
      String(raw.kind ?? ''),
      String(raw.sourceHandle ?? ''),
      String(raw.targetHandle ?? ''),
    ].join('\t');
    if (seen.has(key)) stats.duplicateConnectorsDropped++;
    seen.set(key, { ...raw, id, source, target });
  }
  return [...seen.values()];
};

// Layered topological auto-layout. The skill's layout-arranger agent supplies
// a starting layout, but its rough x-bands often produce overlapping nodes
// (rectangles, not exact-position collisions) and connectors too short to fit
// labels. We replace those positions with a Sugiyama-style layered layout:
//   • Layers come from longest-path from sources; each connected component
//     gets its own column-stack.
//   • Within a layer, nodes sort by the agent's input y so the original
//     lifecycle-role intent (Actors above, Workers below…) is preserved.
//   • Layer gap is wide enough for a typical 200px node plus a connector
//     label (~140px middle band); node gap leaves breathing room for handles.
//   • Sticky / text shape nodes keep their input position — they're floating
//     annotations meant to be pinned by the agent, not part of the flow.
const LAYOUT_LAYER_GAP = 360;
const LAYOUT_NODE_GAP = 80;
const LAYOUT_COMPONENT_GAP = 240;
const LAYOUT_DEFAULT_W = 200;
const LAYOUT_DEFAULT_H = 120;

const isFloatingAnnotation = (n: Record<string, unknown>): boolean => {
  if (n.type !== 'shapeNode') return false;
  const shape = (n.data as { shape?: string } | undefined)?.shape;
  return shape === 'sticky' || shape === 'text';
};

const nodeDimensions = (n: Record<string, unknown>): { w: number; h: number } => {
  const data = (n.data ?? {}) as { width?: number; height?: number; shape?: string };
  const w =
    typeof data.width === 'number'
      ? data.width
      : n.type === 'shapeNode' && data.shape === 'text'
        ? 160
        : LAYOUT_DEFAULT_W;
  let h = LAYOUT_DEFAULT_H;
  if (typeof data.height === 'number') h = data.height;
  else if (n.type === 'shapeNode' && data.shape === 'text') h = 40;
  else if (n.type === 'shapeNode' && data.shape === 'sticky') h = 180;
  else if (n.type === 'imageNode') h = 150;
  return { w, h };
};

const autoLayout = (
  nodes: ReadonlyArray<Record<string, unknown>>,
  connectors: ReadonlyArray<Record<string, unknown>>,
  stats: AssembleStats,
): Array<Record<string, unknown>> => {
  if (nodes.length === 0) return [];

  const flowNodes = nodes.filter((n) => !isFloatingAnnotation(n));
  // A single flow node has no layout to compute — keep its input position so
  // callers can pin standalone nodes via `layout.positions`.
  if (flowNodes.length <= 1) return [...nodes];

  const flowIds = new Set(flowNodes.map((n) => n.id as string));
  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();
  for (const id of flowIds) {
    successors.set(id, new Set());
    predecessors.set(id, new Set());
  }
  for (const c of connectors) {
    const s = c.source as string;
    const t = c.target as string;
    if (!flowIds.has(s) || !flowIds.has(t) || s === t) continue;
    successors.get(s)?.add(t);
    predecessors.get(t)?.add(s);
  }

  // Longest-path layering. A node sits at max(layer(predecessors)) + 1, so
  // chains form clean columns. Cycles short-circuit via the in-progress set:
  // back edges contribute 0 to a node's layer rather than recursing forever.
  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const layerFor = (id: string): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let max = -1;
    for (const p of predecessors.get(id) ?? []) max = Math.max(max, layerFor(p));
    visiting.delete(id);
    const l = max + 1;
    layerOf.set(id, l);
    return l;
  };
  for (const n of flowNodes) layerFor(n.id as string);

  // Group by weakly-connected component so disconnected sub-flows can stack
  // vertically with their own column structure instead of stretching across
  // shared rows.
  const componentOf = new Map<string, number>();
  let componentCount = 0;
  for (const n of flowNodes) {
    const seed = n.id as string;
    if (componentOf.has(seed)) continue;
    const queue: string[] = [seed];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      if (componentOf.has(cur)) continue;
      componentOf.set(cur, componentCount);
      for (const nb of successors.get(cur) ?? []) if (!componentOf.has(nb)) queue.push(nb);
      for (const nb of predecessors.get(cur) ?? []) if (!componentOf.has(nb)) queue.push(nb);
    }
    componentCount++;
  }
  const componentOrder = new Map<number, Array<Record<string, unknown>>>();
  for (const n of flowNodes) {
    const c = componentOf.get(n.id as string) ?? 0;
    if (!componentOrder.has(c)) componentOrder.set(c, []);
    componentOrder.get(c)?.push(n);
  }

  const newPositions = new Map<string, { x: number; y: number }>();
  let componentYOffset = 0;
  for (const members of componentOrder.values()) {
    const layersInComponent = new Map<number, Array<Record<string, unknown>>>();
    for (const m of members) {
      const l = layerOf.get(m.id as string) ?? 0;
      if (!layersInComponent.has(l)) layersInComponent.set(l, []);
      layersInComponent.get(l)?.push(m);
    }

    const layerIndices = [...layersInComponent.keys()].sort((a, b) => a - b);
    const placedLayers: Array<{
      x: number;
      height: number;
      items: Array<{ id: string; y: number }>;
    }> = [];

    let cursorX = 0;
    let componentHeight = 0;
    for (const l of layerIndices) {
      const layerNodes = (layersInComponent.get(l) ?? []).slice().sort((a, b) => {
        const ay = (a.position as { y?: number } | undefined)?.y ?? 0;
        const by = (b.position as { y?: number } | undefined)?.y ?? 0;
        if (ay !== by) return ay - by;
        return (a.id as string).localeCompare(b.id as string);
      });

      const items: Array<{ id: string; y: number }> = [];
      let cursorY = 0;
      let maxW = 0;
      for (const n of layerNodes) {
        const { w, h } = nodeDimensions(n);
        items.push({ id: n.id as string, y: cursorY });
        cursorY += h + LAYOUT_NODE_GAP;
        if (w > maxW) maxW = w;
      }
      const layerHeight = Math.max(0, cursorY - LAYOUT_NODE_GAP);
      placedLayers.push({ x: cursorX, height: layerHeight, items });
      cursorX += maxW + LAYOUT_LAYER_GAP;
      if (layerHeight > componentHeight) componentHeight = layerHeight;
    }

    // Vertically center each layer within the tallest layer of the component
    // so columns line up at the middle (matches the visual feel of dagre LR).
    for (const { x, height, items } of placedLayers) {
      const offset = (componentHeight - height) / 2;
      for (const { id, y } of items) {
        newPositions.set(id, { x, y: y + offset + componentYOffset });
      }
    }
    componentYOffset += componentHeight + LAYOUT_COMPONENT_GAP;
  }

  const snap = (v: number) => Math.round(v / GRID) * GRID;
  return nodes.map((n) => {
    if (isFloatingAnnotation(n)) return n;
    const next = newPositions.get(n.id as string);
    if (!next) return n;
    const snapped = { x: snap(next.x), y: snap(next.y) };
    const prev = (n.position as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    if (snapped.x !== prev.x || snapped.y !== prev.y) stats.positionsShifted++;
    return { ...n, position: snapped };
  });
};

// === validate ==============================================================

export const TierSchema = z.enum(['real', 'mock', 'static']);
export type Tier = z.infer<typeof TierSchema>;

export const ValidateRequestSchema = z.object({
  demo: z.unknown(),
  tier: TierSchema.optional(),
});

export type ValidateRequest = z.infer<typeof ValidateRequestSchema>;

export interface ValidateIssue {
  kind: string;
  path?: string;
  message: string;
}

export interface ValidateReport {
  ok: boolean;
  stats: {
    tier: Tier;
    nodeCount: number;
    connectorCount: number;
    playableCount: number;
    issueCount: number;
    warningCount: number;
  };
  issues: ValidateIssue[];
  warnings: ValidateIssue[];
}

// Filesystem-bound checks (harness coverage, event-emitter index) deliberately
// stay in the skill — the studio doesn't reach into the user's `$TARGET`. The
// endpoint covers schema + node-count cap + tier playability only.
export const validateDemo = (req: ValidateRequest): ValidateReport => {
  const tier: Tier = req.tier ?? 'static';
  const issues: ValidateIssue[] = [];
  const warnings: ValidateIssue[] = [];

  const parsed = DemoSchema.safeParse(req.demo);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        kind: 'zod',
        path: issue.path.join('.') || '<root>',
        message: issue.message,
      });
    }
  }

  // Best-effort access to nodes/connectors so cap + tier checks still surface
  // on a demo that fails Zod (e.g. one extra/missing field shouldn't hide a
  // 50-node count problem).
  const rawDemo = (req.demo ?? {}) as {
    nodes?: unknown;
    connectors?: unknown;
  };
  const nodes: Array<Record<string, unknown>> = Array.isArray(rawDemo.nodes)
    ? (rawDemo.nodes as Array<Record<string, unknown>>)
    : [];
  const connectors: unknown[] = Array.isArray(rawDemo.connectors) ? rawDemo.connectors : [];

  if (nodes.length > 30) {
    issues.push({ kind: 'cap', message: `Node count ${nodes.length} exceeds soft cap 30` });
  } else if (nodes.length > 25) {
    warnings.push({ kind: 'cap', message: `Node count ${nodes.length} approaching cap 30` });
  }

  const playable = nodes.filter((n) => {
    const data = n.data as { playAction?: unknown } | undefined;
    return n.type === 'playNode' || (n.type === 'stateNode' && data?.playAction !== undefined);
  });
  if (tier !== 'static' && playable.length === 0) {
    issues.push({
      kind: 'tier-mismatch',
      message: `Tier '${tier}' requires at least one playable node; found 0. Either add a playNode or set tier=static.`,
    });
  }

  if (tier === 'real') {
    for (const n of nodes) {
      const action = (n.data as { playAction?: { kind?: string; method?: string; url?: string } })
        ?.playAction;
      if (action?.kind !== 'http' || !action.url) continue;
      warnings.push({
        kind: 'real-tier-reachability',
        message: `Node '${String(n.id)}': ensure ${action.method ?? '?'} ${action.url} is reachable in your dev server before clicking.`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    stats: {
      tier,
      nodeCount: nodes.length,
      connectorCount: connectors.length,
      playableCount: playable.length,
      issueCount: issues.length,
      warningCount: warnings.length,
    },
    issues,
    warnings,
  };
};
