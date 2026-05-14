/**
 * In-memory pub/sub keyed by demoId. Subscribers receive every event published
 * for that demo until they unsubscribe; subscribers for other demos are not
 * notified.
 */

export type StudioEventType =
  | 'demo:reload'
  | 'node:running'
  | 'node:done'
  | 'node:error'
  | 'node:status'
  | 'file:changed';

export interface StudioEvent {
  type: StudioEventType;
  demoId: string;
  /** Arbitrary JSON-serializable payload. Shape depends on event type. */
  payload: unknown;
  /** Server-side timestamp (ms since epoch). */
  ts: number;
}

export type Subscriber = (event: StudioEvent) => void;

export interface EventBus {
  /** Subscribe to events for a specific demo. Returns an unsubscribe fn. */
  subscribe(demoId: string, fn: Subscriber): () => void;
  /** Broadcast an event to all subscribers of `demoId`. */
  broadcast(event: Omit<StudioEvent, 'ts'> & { ts?: number }): void;
  /** Number of active subscribers for a given demo (used in tests). */
  subscriberCount(demoId: string): number;
}

export function createEventBus(): EventBus {
  const subs = new Map<string, Set<Subscriber>>();

  return {
    subscribe(demoId, fn) {
      let set = subs.get(demoId);
      if (!set) {
        set = new Set();
        subs.set(demoId, set);
      }
      set.add(fn);
      return () => {
        const current = subs.get(demoId);
        if (!current) return;
        current.delete(fn);
        if (current.size === 0) subs.delete(demoId);
      };
    },
    broadcast(event) {
      const set = subs.get(event.demoId);
      if (!set) return;
      const full: StudioEvent = { ...event, ts: event.ts ?? Date.now() };
      for (const fn of set) {
        try {
          fn(full);
        } catch (err) {
          console.error('[events] subscriber threw, dropping:', err);
        }
      }
    },
    subscriberCount(demoId) {
      return subs.get(demoId)?.size ?? 0;
    },
  };
}
