type Listener<T> = (payload: T) => void | Promise<void>;

export interface TodoCompletedEvent {
  todoId: string;
  completedAt: number;
}

export interface EventBus {
  on(event: 'todo.completed', listener: Listener<TodoCompletedEvent>): () => void;
  emit(event: 'todo.completed', payload: TodoCompletedEvent): void;
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<Listener<unknown>>>();

  return {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as Listener<unknown>);
      listeners.set(event, set);
      return () => set.delete(listener as Listener<unknown>);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const listener of set) {
        // Fire-and-forget; never block the publisher on a slow consumer.
        Promise.resolve(listener(payload)).catch((err) => {
          console.error(`[event-bus] listener for ${event} threw:`, err);
        });
      }
    },
  };
}
