import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// US-015 regression fence: a single handle (any of 't' / 'l' / 'r' / 'b' on
// any node type) must accept unlimited inbound AND outbound connections, and
// onConnect must NOT reject a new connection because a handle is already used.
// React Flow exposes two opt-in mechanisms that would silently break this:
//   • <Handle connectionLimit={N}> — caps connections per handle
//   • <ReactFlow isValidConnection={fn}> — vetoes connections at gesture time
// Either appearing in the node renderers OR demo-canvas would re-introduce the
// limit. Static-text fence is enough — these props don't have synonymous APIs.
// US-023 extends the watch list to icon-node + image-node so a future change
// that adds a per-type connectionLimit (e.g. "icons shouldn't be sources") is
// caught at test time, not by a user.
const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..');
const watched = [
  'apps/web/src/components/nodes/shape-node.tsx',
  'apps/web/src/components/nodes/play-node.tsx',
  'apps/web/src/components/nodes/state-node.tsx',
  'apps/web/src/components/nodes/icon-node.tsx',
  'apps/web/src/components/nodes/image-node.tsx',
  'apps/web/src/components/demo-canvas.tsx',
];

describe('US-015: no per-handle connection limit', () => {
  for (const rel of watched) {
    it(`${rel} does not set connectionLimit or isValidConnection`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf-8');
      expect(src).not.toMatch(/\bconnectionLimit\b/);
      expect(src).not.toMatch(/\bisValidConnection\b/);
    });
  }
});

// US-025: every custom node renderer must forward NodeProps.isConnectable to
// every <Handle> so the per-node `connectable: false` set in demo-canvas
// buildNode actually gates connection-start. xyflow's Handle defaults
// `isConnectable = true` — if a renderer omits the prop, the Handle stays
// hit-testable as a connection origin regardless of node.connectable, defeating
// the gate. Static-text fence on each renderer source is sufficient; any new
// custom node added to this list inherits the same check.
const nodeRenderers = [
  'apps/web/src/components/nodes/shape-node.tsx',
  'apps/web/src/components/nodes/play-node.tsx',
  'apps/web/src/components/nodes/state-node.tsx',
  'apps/web/src/components/nodes/icon-node.tsx',
  'apps/web/src/components/nodes/image-node.tsx',
];

describe('US-025: nodes forward isConnectable to every <Handle>', () => {
  for (const rel of nodeRenderers) {
    it(`${rel} destructures isConnectable from NodeProps and forwards to all Handles`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf-8');
      // Verify the renderer reads isConnectable off NodeProps.
      expect(src).toMatch(/\bisConnectable\b\s*[,}]/);
      // Verify every JSX <Handle ...> declaration includes isConnectable=.
      // Match only opening tags followed by whitespace (newline or space) —
      // avoids the `<Handle>` reference in prose comments. Count those and
      // ensure the prop-count matches.
      const handleOpens = src.match(/<Handle\s/g) ?? [];
      const isConnectableProps = src.match(/\bisConnectable=\{/g) ?? [];
      expect(isConnectableProps.length).toBe(handleOpens.length);
    });
  }
});
