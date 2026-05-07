// Tiny in-memory FIFO queue with a single async consumer. The consumer is
// registered once at boot via subscribe(); push() enqueues + kicks the
// drain loop. A separate construct from the event-bus on purpose — a real
// pipeline would back this with SQS / Redis / etc., and the canvas connector
// for it is `kind: 'queue'` (dotted line) rather than `kind: 'event'` (dashed).
type Handler<T> = (payload: T) => void | Promise<void>;

export interface ShipmentRequest {
  orderId: string;
  customerId: string;
}

export interface Queue {
  push(payload: ShipmentRequest): void;
  subscribe(handler: Handler<ShipmentRequest>): void;
  depth(): number;
}

export function createQueue(): Queue {
  const buffer: ShipmentRequest[] = [];
  let handler: Handler<ShipmentRequest> | null = null;
  let draining = false;

  const drain = async (): Promise<void> => {
    if (draining || !handler) return;
    draining = true;
    try {
      while (buffer.length > 0) {
        const next = buffer.shift();
        if (!next) break;
        try {
          await handler(next);
        } catch (err) {
          console.error('[queue] handler threw:', err);
        }
      }
    } finally {
      draining = false;
    }
  };

  return {
    push(payload) {
      buffer.push(payload);
      void drain();
    },
    subscribe(h) {
      handler = h;
      void drain();
    },
    depth() {
      return buffer.length;
    },
  };
}
