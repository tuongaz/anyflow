import { useEffect, useState } from 'react';

export type StudioEventType =
  | 'demo:reload'
  | 'node:running'
  | 'node:done'
  | 'node:error'
  | 'node:status';

export interface StudioEvent {
  type: StudioEventType;
  ts: number;
  /** Convenience flag — present on demo:reload only. */
  valid?: boolean;
  error?: string;
  /** Other payload data passed through. */
  [key: string]: unknown;
}

export interface UseStudioEventsOptions {
  /** Fired on the first hello + every demo:reload event so the page can re-fetch. */
  onReload?: () => void;
  onEvent?: (event: StudioEvent) => void;
}

export interface UseStudioEventsResult {
  /** The most recent demo:reload event (or null if none yet). */
  lastReload: StudioEvent | null;
  connected: boolean;
}

/**
 * Wraps an EventSource subscribed to /api/events?demoId=:id. Fires `onReload`
 * on every `demo:reload` AND on the initial `hello`/each reconnect so the
 * caller can always re-fetch and catch up on missed mutations.
 */
export const useStudioEvents = (
  demoId: string | null,
  options: UseStudioEventsOptions = {},
): UseStudioEventsResult => {
  const [lastReload, setLastReload] = useState<StudioEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const { onReload, onEvent } = options;

  useEffect(() => {
    if (!demoId) {
      setLastReload(null);
      setConnected(false);
      return;
    }

    const url = `/api/events?demoId=${encodeURIComponent(demoId)}`;
    const source = new EventSource(url);

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));

    // On the initial 'hello' event (sent on every connect AND reconnect),
    // ask the caller to re-fetch so we never miss a mutation.
    source.addEventListener('hello', () => {
      onReload?.();
    });

    source.addEventListener('demo:reload', (e) => {
      const event = parsePayload(e, 'demo:reload');
      setLastReload(event);
      onEvent?.(event);
      onReload?.();
    });

    for (const type of ['node:running', 'node:done', 'node:error', 'node:status'] as const) {
      source.addEventListener(type, (e) => {
        onEvent?.(parsePayload(e, type));
      });
    }

    return () => {
      source.close();
    };
  }, [demoId, onReload, onEvent]);

  return { lastReload, connected };
};

const parsePayload = (e: MessageEvent, type: StudioEventType): StudioEvent => {
  try {
    const parsed = JSON.parse(e.data) as Record<string, unknown>;
    return { type, ts: Date.now(), ...parsed };
  } catch {
    return { type, ts: Date.now() };
  }
};
