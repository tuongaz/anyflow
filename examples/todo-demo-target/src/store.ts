export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
  completedAt: number | null;
}

export interface TodoStore {
  list(): Todo[];
  get(id: string): Todo | undefined;
  create(input: { id?: string; title: string }): Todo;
  complete(id: string): Todo | undefined;
  stats(): { total: number; completed: number; pending: number; lastCompletedId: string | null };
}

export function createTodoStore(seed: Todo[] = []): TodoStore {
  const todos = new Map<string, Todo>(seed.map((t) => [t.id, t]));
  let nextId = seed.length + 1;

  return {
    list() {
      return [...todos.values()].sort((a, b) => a.createdAt - b.createdAt);
    },
    get(id) {
      return todos.get(id);
    },
    create(input) {
      const id = input.id ?? `todo-${nextId++}`;
      const todo: Todo = {
        id,
        title: input.title,
        completed: false,
        createdAt: Date.now(),
        completedAt: null,
      };
      todos.set(id, todo);
      return todo;
    },
    complete(id) {
      const t = todos.get(id);
      if (!t) return undefined;
      // Always restamp completedAt so re-completing the same id is a fresh
      // "completed" event for the demo's worker — the canvas should re-light
      // on every Play, not no-op on the second click.
      const updated: Todo = { ...t, completed: true, completedAt: Date.now() };
      todos.set(id, updated);
      return updated;
    },
    stats() {
      const all = [...todos.values()];
      const completed = all.filter((t) => t.completed);
      const lastCompleted = completed.sort(
        (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0),
      )[0];
      return {
        total: all.length,
        completed: completed.length,
        pending: all.length - completed.length,
        lastCompletedId: lastCompleted?.id ?? null,
      };
    },
  };
}
