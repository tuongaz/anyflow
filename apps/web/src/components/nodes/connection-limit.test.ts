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
const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..');
const watched = [
  'apps/web/src/components/nodes/shape-node.tsx',
  'apps/web/src/components/nodes/play-node.tsx',
  'apps/web/src/components/nodes/state-node.tsx',
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
