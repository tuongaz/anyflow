import type { Connector, DemoNode } from '@/lib/api';
import { nodeCenter, pickFacingHandle } from '@/lib/pick-facing-handle';
import { useEffect, useRef } from 'react';

export interface ReroutePatch {
  connectorId: string;
  patch: { sourceHandle?: string; targetHandle?: string };
}

/**
 * For every connector with sourceHandleAutoPicked or targetHandleAutoPicked
 * set to true, recompute the facing handle for that endpoint based on the
 * current node positions. Returns only the diffs — connectors whose handle
 * is already correct produce no patch, so a stable scene yields zero work.
 *
 * Pure function — exposed for unit tests. The hook below schedules it via
 * requestAnimationFrame and dispatches the patches.
 */
export const computeReroutes = (
  nodes: ReadonlyArray<DemoNode>,
  connectors: ReadonlyArray<Connector>,
): ReroutePatch[] => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: ReroutePatch[] = [];
  for (const c of connectors) {
    const sourceAuto = c.sourceHandleAutoPicked === true;
    const targetAuto = c.targetHandleAutoPicked === true;
    if (!sourceAuto && !targetAuto) continue;
    const srcNode = byId.get(c.source);
    const tgtNode = byId.get(c.target);
    if (!srcNode || !tgtNode) continue;
    const sCenter = nodeCenter(srcNode);
    const tCenter = nodeCenter(tgtNode);
    const patch: { sourceHandle?: string; targetHandle?: string } = {};
    if (sourceAuto) {
      const desired = pickFacingHandle(sCenter, tCenter, 'source', srcNode.type);
      if (desired !== c.sourceHandle) patch.sourceHandle = desired;
    }
    if (targetAuto) {
      const desired = pickFacingHandle(tCenter, sCenter, 'target', tgtNode.type);
      if (desired !== c.targetHandle) patch.targetHandle = desired;
    }
    if (patch.sourceHandle !== undefined || patch.targetHandle !== undefined) {
      out.push({ connectorId: c.id, patch });
    }
  }
  return out;
};

/**
 * React hook: re-runs the reroute computation whenever the merged
 * nodes/connectors arrays change identity, debounced via rAF so a multi-drag
 * dispatches at most one patch per connector per frame. The dispatch goes
 * through the supplied onReroute callback (typically the same path as a
 * user-driven reconnect).
 */
export const useAutoHandleRerouter = (
  nodes: ReadonlyArray<DemoNode>,
  connectors: ReadonlyArray<Connector>,
  onReroute:
    | ((connectorId: string, patch: { sourceHandle?: string; targetHandle?: string }) => void)
    | undefined,
): void => {
  const onRerouteRef = useRef(onReroute);
  useEffect(() => {
    onRerouteRef.current = onReroute;
  }, [onReroute]);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const dispatch = onRerouteRef.current;
      if (!dispatch) return;
      const patches = computeReroutes(nodes, connectors);
      for (const p of patches) dispatch(p.connectorId, p.patch);
    });
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [nodes, connectors]);
};
