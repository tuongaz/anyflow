import { type NodeDetailResult, fetchNodeDetail } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export type NodeDetailFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: NodeDetailResult }
  | { status: 'error'; message: string };

export interface UseNodeDetailResult {
  state: NodeDetailFetchState;
  refresh: () => void;
}

/**
 * Fetches the dynamic-source body for a (demoId, nodeId) pair. Caller is
 * expected to only invoke this when `data.detail.dynamicSource` is declared
 * (the proxy returns 404 otherwise). The fetch is automatically cleared and
 * re-fired whenever either id changes — re-opening the panel re-fetches.
 */
export const useNodeDetail = (
  demoId: string | null,
  nodeId: string | null,
  enabled: boolean,
): UseNodeDetailResult => {
  const [state, setState] = useState<NodeDetailFetchState>({ status: 'idle' });
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the trigger for explicit refreshes; the effect body intentionally doesn't reference it.
  useEffect(() => {
    if (!demoId || !nodeId || !enabled) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetchNodeDetail(demoId, nodeId)
      .then((result) => {
        if (cancelled) return;
        setState({ status: 'success', result });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [demoId, nodeId, enabled, tick]);

  return { state, refresh };
};
