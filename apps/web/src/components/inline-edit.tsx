import { cn } from '@/lib/utils';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

export interface InlineEditProps {
  initialValue: string;
  /** Persist a value (debounced 400ms during typing, immediate on blur/Enter). */
  onCommit: (value: string) => void;
  /** Exit edit mode (called on blur/Enter/Escape after any commit/revert). */
  onExit: () => void;
  /** Render a textarea instead of a single-line input (Shift+Enter inserts newline). */
  multiline?: boolean;
  /**
   * Empty value is rejected: revert to the previous value with a shake animation
   * and exit without firing onCommit. Used for fields that the schema mandates
   * (e.g. PlayNode/StateNode label).
   */
  required?: boolean;
  /** data-field attribute for tests; pairs with data-testid='inline-edit-input'. */
  field: string;
  className?: string;
  placeholder?: string;
}

/**
 * Local-state inline editor used by node titles, node descriptions, and
 * connector labels. The component is uncontrolled relative to its parent —
 * `initialValue` seeds the state on mount and the parent receives changes
 * via `onCommit`. Subsequent prop updates to `initialValue` do NOT clobber
 * the user's in-progress edits.
 *
 * Persistence cadence (per US-026):
 *   • 400ms debounced commit while the user is typing.
 *   • Immediate commit on blur / Enter (cancels any pending debounce).
 *   • Escape cancels both pending and exit-time commits.
 */
export function InlineEdit({
  initialValue,
  onCommit,
  onExit,
  multiline = false,
  required = false,
  field,
  className,
  placeholder,
}: InlineEditProps) {
  const [value, setValue] = useState(initialValue);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(initialValue);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if ('select' in el) el.select();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const clearDebounce = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const commitNow = (next: string) => {
    clearDebounce();
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    onCommit(next);
  };

  const handleChange = (next: string) => {
    setValue(next);
    clearDebounce();
    // Skip the debounced commit when the value would be rejected — let the
    // user keep typing without round-tripping a 400-error to the server.
    if (required && next.trim().length === 0) return;
    debounceRef.current = setTimeout(() => commitNow(next), 400);
  };

  const finalize = () => {
    clearDebounce();
    if (required && value.trim().length === 0) {
      // Reject empty for required fields: revert local state, shake to signal,
      // and exit without firing onCommit. The previous server value is left
      // untouched (no PATCH was issued during the rejected edit thanks to
      // the early-return in handleChange).
      setValue(initialValue);
      setShake(true);
      setTimeout(() => setShake(false), 320);
      onExit();
      return;
    }
    commitNow(value);
    onExit();
  };

  const cancel = () => {
    clearDebounce();
    setValue(initialValue);
    onExit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Stop the keystroke from bubbling to the canvas — Backspace/Delete on the
    // canvas would otherwise trigger node deletion (US-027).
    e.stopPropagation();
    if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
      e.preventDefault();
      // Calling el.blur() also fires our onBlur handler — guard against the
      // double finalize so we don't issue two PATCHes for one Enter.
      skipBlurRef.current = true;
      finalize();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      skipBlurRef.current = true;
      cancel();
    }
  };

  const onBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    finalize();
  };

  // `nodrag nopan nowheel` opts the editor out of React Flow's pointer/wheel
  // capture so typing isn't interpreted as a node drag, pane pan, or zoom.
  const sharedClass = cn(
    'nodrag nopan nowheel rounded border border-input bg-background px-1.5 py-0.5 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring',
    shake ? 'inline-edit-shake' : '',
    className,
  );

  if (multiline) {
    return (
      <textarea
        ref={(el) => {
          inputRef.current = el;
        }}
        data-testid="inline-edit-input"
        data-field={field}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className={cn('w-full resize-none', sharedClass)}
        rows={2}
      />
    );
  }
  return (
    <input
      ref={(el) => {
        inputRef.current = el;
      }}
      data-testid="inline-edit-input"
      data-field={field}
      type="text"
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      className={cn('w-full', sharedClass)}
    />
  );
}
