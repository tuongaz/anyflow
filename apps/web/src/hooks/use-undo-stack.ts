import { useCallback, useReducer, useRef } from 'react';

export interface UndoEntry {
  do: () => Promise<void>;
  undo: () => Promise<void>;
  coalesceKey?: string;
  capturedAt: number;
}

export interface UndoStackState {
  stack: UndoEntry[];
  cursor: number;
}

export const MAX_HISTORY = 100;
export const COALESCE_WINDOW_MS = 500;

const INITIAL_STATE: UndoStackState = { stack: [], cursor: 0 };

interface PushOpts {
  now?: number;
  max?: number;
  coalesceWindowMs?: number;
}

export const applyPush = (
  state: UndoStackState,
  entry: UndoEntry,
  opts?: PushOpts,
): UndoStackState => {
  const now = opts?.now ?? Date.now();
  const max = opts?.max ?? MAX_HISTORY;
  const coalesceWindowMs = opts?.coalesceWindowMs ?? COALESCE_WINDOW_MS;

  const { stack, cursor } = state;

  // Coalesce: same key, top of stack, within the window → merge into the top
  // entry by replacing `do` with the new one and updating `capturedAt`. The
  // original `undo` is preserved so the entire gesture can still be reverted
  // back to its starting state. Cursor is unchanged.
  if (entry.coalesceKey && cursor > 0) {
    const top = stack[cursor - 1];
    if (top && top.coalesceKey === entry.coalesceKey && now - top.capturedAt <= coalesceWindowMs) {
      const nextStack = stack.slice(0, cursor);
      nextStack[cursor - 1] = { ...top, do: entry.do, capturedAt: now };
      return { stack: nextStack, cursor };
    }
  }

  // Truncate the redo branch, then append.
  const nextStack = stack.slice(0, cursor);
  nextStack.push({ ...entry, capturedAt: now });
  let nextCursor = cursor + 1;

  // Capacity: drop oldest entries until we fit. Cursor moves with the shift.
  while (nextStack.length > max) {
    nextStack.shift();
    nextCursor -= 1;
  }
  if (nextCursor < 0) nextCursor = 0;

  return { stack: nextStack, cursor: nextCursor };
};

export const applyUndo = (state: UndoStackState): { state: UndoStackState; entry?: UndoEntry } => {
  if (state.cursor === 0) return { state, entry: undefined };
  return {
    state: { ...state, cursor: state.cursor - 1 },
    entry: state.stack[state.cursor - 1],
  };
};

export const applyRedo = (state: UndoStackState): { state: UndoStackState; entry?: UndoEntry } => {
  if (state.cursor === state.stack.length) return { state, entry: undefined };
  return {
    state: { ...state, cursor: state.cursor + 1 },
    entry: state.stack[state.cursor],
  };
};

export const applyClear = (): UndoStackState => ({ stack: [], cursor: 0 });

export const applyDropTop = (state: UndoStackState): UndoStackState => {
  if (state.cursor === 0) return state;
  const nextStack = state.stack.slice();
  nextStack.splice(state.cursor - 1, 1);
  return { stack: nextStack, cursor: state.cursor - 1 };
};

// ---- Hook ----

type Action = { type: 'replace'; state: UndoStackState };

const reducer = (_state: UndoStackState, action: Action): UndoStackState => action.state;

export type PushInput = Omit<UndoEntry, 'capturedAt'> & { capturedAt?: number };

export interface UseUndoStackResult {
  /** Push a new entry. `capturedAt` defaults to `Date.now()`. */
  push: (entry: PushInput) => void;
  /** Pop the cursor down by one. Returns the entry whose `undo` the caller should run. */
  undo: () => Promise<{ entry?: UndoEntry } | undefined>;
  /** Move the cursor up by one. Returns the entry whose `do` the caller should replay. */
  redo: () => Promise<{ entry?: UndoEntry } | undefined>;
  /** Empty the stack and reset the cursor. */
  clear: () => void;
  /** Revert the most recent push (used on optimistic API failure). */
  dropTop: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Stamp `lastMutationAt = Date.now()` to keep the stack alive across watcher echoes. */
  markMutation: () => void;
  /** Read the most recent `lastMutationAt` timestamp without re-rendering. */
  lastMutationAt: () => number;
}

/**
 * Per-demo undo/redo stack. Pure reducers above are exported for unit tests;
 * the hook wraps them in `useReducer` and adds an internal promise chain so
 * concurrent `undo()`/`redo()` calls queue rather than racing on the cursor.
 */
export const useUndoStack = (): UseUndoStackResult => {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // stateRef tracks the latest reducer state synchronously so the chained
  // promise callbacks below see fresh state without waiting on React's commit.
  const stateRef = useRef(state);
  stateRef.current = state;

  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastMutationAtRef = useRef(0);

  const replace = useCallback((next: UndoStackState) => {
    if (next === stateRef.current) return;
    stateRef.current = next;
    dispatch({ type: 'replace', state: next });
  }, []);

  const push = useCallback(
    (input: PushInput) => {
      const fullEntry: UndoEntry = {
        do: input.do,
        undo: input.undo,
        coalesceKey: input.coalesceKey,
        capturedAt: input.capturedAt ?? Date.now(),
      };
      replace(applyPush(stateRef.current, fullEntry));
    },
    [replace],
  );

  const undo = useCallback((): Promise<{ entry?: UndoEntry } | undefined> => {
    const next = chainRef.current.then(() => {
      const result = applyUndo(stateRef.current);
      if (!result.entry) return undefined;
      replace(result.state);
      return { entry: result.entry };
    });
    chainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, [replace]);

  const redo = useCallback((): Promise<{ entry?: UndoEntry } | undefined> => {
    const next = chainRef.current.then(() => {
      const result = applyRedo(stateRef.current);
      if (!result.entry) return undefined;
      replace(result.state);
      return { entry: result.entry };
    });
    chainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, [replace]);

  const clear = useCallback(() => {
    replace(applyClear());
  }, [replace]);

  const dropTop = useCallback(() => {
    replace(applyDropTop(stateRef.current));
  }, [replace]);

  const markMutation = useCallback(() => {
    lastMutationAtRef.current = Date.now();
  }, []);

  const lastMutationAt = useCallback(() => lastMutationAtRef.current, []);

  return {
    push,
    undo,
    redo,
    clear,
    dropTop,
    canUndo: state.cursor > 0,
    canRedo: state.cursor < state.stack.length,
    markMutation,
    lastMutationAt,
  };
};
