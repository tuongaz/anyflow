export interface OrderItem {
  sku: string;
  qty: number;
}

export type OrderStatus =
  | 'pending'
  | 'inventory-confirmed'
  | 'paid'
  | 'shipped'
  | 'failed';

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: number;
  paidAt: number | null;
  shippedAt: number | null;
}

export interface OrderStore {
  list(): Order[];
  get(id: string): Order | undefined;
  create(input: { id?: string; customerId: string; items: OrderItem[] }): Order;
  setStatus(id: string, status: OrderStatus, stamps?: { paidAt?: number; shippedAt?: number }): Order | undefined;
  stats(): {
    total: number;
    pending: number;
    paid: number;
    shipped: number;
    revenue: number;
    lastOrderId: string | null;
  };
}

const PRICES: Record<string, number> = {
  'sku-shirt': 29,
  'sku-mug': 12,
  'sku-book': 18,
};

const totalFor = (items: OrderItem[]): number =>
  items.reduce((sum, item) => sum + (PRICES[item.sku] ?? 10) * item.qty, 0);

export function createOrderStore(seed: Order[] = []): OrderStore {
  const orders = new Map<string, Order>(seed.map((o) => [o.id, o]));
  let nextId = seed.length + 1;

  return {
    list() {
      return [...orders.values()].sort((a, b) => a.createdAt - b.createdAt);
    },
    get(id) {
      return orders.get(id);
    },
    create(input) {
      const id = input.id ?? `ord-${nextId++}`;
      const order: Order = {
        id,
        customerId: input.customerId,
        items: input.items,
        total: totalFor(input.items),
        status: 'pending',
        createdAt: Date.now(),
        paidAt: null,
        shippedAt: null,
      };
      orders.set(id, order);
      return order;
    },
    setStatus(id, status, stamps) {
      const o = orders.get(id);
      if (!o) return undefined;
      const updated: Order = {
        ...o,
        status,
        paidAt: stamps?.paidAt ?? o.paidAt,
        shippedAt: stamps?.shippedAt ?? o.shippedAt,
      };
      orders.set(id, updated);
      return updated;
    },
    stats() {
      const all = [...orders.values()];
      const paid = all.filter((o) => o.status === 'paid' || o.status === 'shipped');
      const shipped = all.filter((o) => o.status === 'shipped');
      const last = all.sort((a, b) => b.createdAt - a.createdAt)[0];
      return {
        total: all.length,
        pending: all.filter((o) => o.status === 'pending').length,
        paid: paid.length,
        shipped: shipped.length,
        revenue: paid.reduce((s, o) => s + o.total, 0),
        lastOrderId: last?.id ?? null,
      };
    },
  };
}
