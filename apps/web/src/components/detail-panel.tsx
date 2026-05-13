import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { type Connector, type DemoNode, openProjectFile, revealProjectFile } from '@/lib/api';
import {
  getStoredDetailPanelWidth,
  setStoredDetailPanelWidth,
  startResizeGesture,
} from '@/lib/detail-panel-width';
import { cn } from '@/lib/utils';
import { FolderOpen, PencilLine } from 'lucide-react';
import {
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface DetailPanelProps {
  demoId: string | null;
  node: DemoNode | null;
  connector: Connector | null;
  // Three-field consolidation: name (header), description (light-bold body),
  // detail (long-form body). All three share the same single-click → edit,
  // blur → save UX via EditableField. When a callback is omitted the field
  // renders read-only. Empty string clears the field on disk.
  onNameChange?: (nodeId: string, name: string) => void;
  onDescriptionChange?: (nodeId: string, value: string) => void;
  onDetailChange?: (nodeId: string, value: string) => void;
  onClose: () => void;
}

export function DetailPanel({
  demoId,
  node,
  connector,
  onNameChange,
  onDescriptionChange,
  onDetailChange,
  onClose,
}: DetailPanelProps) {
  // Text shape nodes are pure on-canvas labels — the sidebar would only
  // duplicate the inline-edited text and offer no extra fields, so the panel
  // stays closed for them. Clicking a text node still selects it on the
  // canvas; double-click still opens inline edit.
  const isTextShapeNode =
    node?.type === 'shapeNode' && (node.data as { shape?: string }).shape === 'text';
  const inspectableNode = isTextShapeNode ? null : node;
  const open = inspectableNode !== null || connector !== null;
  const nodeName =
    inspectableNode && 'name' in inspectableNode.data ? (inspectableNode.data.name ?? '') : '';
  const description = inspectableNode?.data.description ?? '';
  const detail = inspectableNode?.data.detail ?? '';

  // Panel width is user-resizable above the sm breakpoint via a left-edge
  // handle; persisted across sessions in localStorage. The CSS variable feeds
  // the `sm:!w-[var(...)]` override below.
  const [width, setWidth] = useState<number>(() => getStoredDetailPanelWidth());
  const onResizeHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startResizeGesture(width, e.clientX, {
      onWidth: setWidth,
      onCommit: setStoredDetailPanelWidth,
    });
  };
  const widthStyle = { ['--detail-panel-w' as string]: `${width}px` } as CSSProperties;

  return (
    <Sheet
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="overflow-y-auto sm:!w-[var(--detail-panel-w)] sm:!max-w-[var(--detail-panel-w)]"
        style={widthStyle}
        data-testid="detail-panel"
        onEscapeKeyDown={(e) => {
          // While any of the three editable fields is in edit mode, Escape is
          // the cancel-edit shortcut — preventDefault stops Radix from also
          // closing the Sheet. Each field's own onKeyDown handles the cancel.
          const active = document.activeElement as HTMLElement | null;
          if (active?.getAttribute('data-testid')?.endsWith('-editor')) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          // Resize gestures (US-031) start with a pointerdown on a
          // .react-flow__resize-control outside the Sheet. Radix's default is
          // to close on outside interaction, which would unmount the resize
          // controls mid-gesture. Suppress the close so the panel stays open.
          const target = e.target as HTMLElement | null;
          if (target?.closest('.react-flow__resize-control')) e.preventDefault();
          // Style-strip color popovers render in a portal outside the
          // SheetContent. A click inside the popover would otherwise close
          // the Sheet. Keep it open.
          if (target?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
          // Canvas style strip lives outside the Sheet — keep open while the
          // user adjusts styles for the selected entity.
          if (target?.closest('[data-testid="canvas-style-strip"]')) e.preventDefault();
          // Clicks inside a React Flow node are part of the inspector's UX —
          // selecting another node, hitting Play, etc. Don't close on those.
          if (target?.closest('.react-flow__node')) e.preventDefault();
          // Same for connectors: another-edge click swaps selection; endpoint
          // drag starts a reconnect — neither should close the panel.
          if (target?.closest('.react-flow__edge')) e.preventDefault();
        }}
      >
        <div
          aria-label="Resize detail panel"
          onPointerDown={onResizeHandlePointerDown}
          data-testid="detail-panel-resize-handle"
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-border sm:block"
        />
        {inspectableNode ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <SheetTitle data-testid="detail-panel-title">
                <EditableField
                  nodeId={inspectableNode.id}
                  value={nodeName}
                  placeholder="Name"
                  multiline={false}
                  ariaLabel="Name"
                  testIdBase="detail-panel-name"
                  onSave={onNameChange}
                  textClassName="text-base font-semibold"
                />
              </SheetTitle>
              {/* Radix requires a Description for a11y; keep one as sr-only
                  so screen readers still announce what kind of entity the
                  panel describes without cluttering the visual header. */}
              <SheetDescription className="sr-only">
                {inspectableNode.id} · {inspectableNode.type}
              </SheetDescription>
            </div>

            <div className="mt-0 flex flex-col gap-3">
              <EditableField
                nodeId={inspectableNode.id}
                value={description}
                placeholder="Short description shown on the node body"
                multiline={true}
                ariaLabel="Description"
                testIdBase="detail-panel-description"
                onSave={onDescriptionChange}
                textClassName="font-medium"
              />
              <EditableField
                nodeId={inspectableNode.id}
                value={detail}
                placeholder="Long-form notes, context, anything…"
                multiline={true}
                ariaLabel="Detail"
                testIdBase="detail-panel-detail"
                onSave={onDetailChange}
              />

              {inspectableNode.type === 'htmlNode' && demoId ? (
                <HtmlNodeSection projectId={demoId} htmlPath={inspectableNode.data.htmlPath} />
              ) : null}
            </div>
          </div>
        ) : connector ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <SheetTitle data-testid="detail-panel-title">
                {connector.label ?? 'Connector'}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {connector.id} · {connector.kind}
              </SheetDescription>
            </div>

            <div className="mt-0 flex flex-col gap-3">
              <ConnectorSummary connector={connector} />
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// Click-to-edit + blur-saves field. No pencil affordance; the rendered text
// itself is the click target (cursor: text on hover). Single click enters
// edit mode; blur commits; Escape cancels. Enter commits when multiline is
// false, inserts a literal '\n' when true (Firefox parity via execCommand
// since it doesn't honor contentEditable='plaintext-only').
//
// WHY contentEditable + plaintext-only over <input>/<textarea>: the editor
// inherits the panel's typography (no jarring font swap on enter-edit) and
// the rendered/edit DOM stays nearly identical so the layout doesn't shift.
// The element is uncontrolled: textContent is seeded once on enter-edit and
// the browser owns the DOM until commit/cancel — React must not write
// children every keystroke or caret positioning fights the IME.
export function EditableField({
  nodeId,
  value,
  placeholder,
  multiline,
  ariaLabel,
  testIdBase,
  onSave,
  textClassName,
}: {
  nodeId: string;
  value: string;
  placeholder: string;
  multiline: boolean;
  ariaLabel: string;
  testIdBase: string;
  onSave?: (nodeId: string, value: string) => void;
  textClassName?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  // Escape sets this so the imminent blur is a no-op cancel instead of a save.
  const cancelOnBlurRef = useRef(false);

  // Seed textContent imperatively on enter-edit, focus, place caret at end.
  // We seed via DOM (not JSX children) because contentEditable + React
  // children fights React's reconciliation.
  useEffect(() => {
    if (!isEditing) return;
    const el = editorRef.current;
    if (!el) return;
    el.textContent = value;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [isEditing, value]);

  const isEmpty = value === '';

  // Read-only: plain rendered text (or muted placeholder). No edit affordance.
  if (!onSave) {
    return (
      <div
        data-testid={testIdBase}
        aria-label={ariaLabel}
        className={cn(
          'w-full whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-sm',
          isEmpty ? 'italic text-muted-foreground/50' : 'text-foreground',
          textClassName,
        )}
      >
        {isEmpty ? placeholder : value}
      </div>
    );
  }

  const commit = () => {
    const text = editorRef.current?.textContent ?? value;
    onSave(nodeId, text);
    setIsEditing(false);
  };

  const cancel = () => {
    setIsEditing(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Stop the keystroke from bubbling to the canvas — Backspace/Delete on
    // the canvas would otherwise trigger node deletion. Cover the native side
    // too: window-level shortcuts listen for native events.
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      // Flag the imminent blur as a cancel so onBlur doesn't save the stale
      // textContent (commit() would otherwise persist whatever the user typed).
      cancelOnBlurRef.current = true;
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Shift+Enter always commits, even in multiline fields — gives the user
      // a keyboard escape hatch that mirrors blur.
      if (e.shiftKey || !multiline) {
        commit();
        return;
      }
      document.execCommand('insertText', false, '\n');
    }
  };

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    // plaintext-only forces paste-as-text on Chromium/Safari; Firefox needs
    // explicit preventDefault + insertText to strip rich-text formatting.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  // onInput is intentionally a no-op — we read via textContent at commit time
  // and never need a controlled mirror. Keeping the handler attached avoids
  // a React warning about contentEditable without onChange.
  const onInput = (_e: ReactFormEvent<HTMLDivElement>) => {};

  const onBlur = () => {
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false;
      return;
    }
    commit();
  };

  const enterEdit = () => {
    if (isEditing) return;
    setIsEditing(true);
  };

  return (
    <div className="relative" data-testid={testIdBase} data-editing={isEditing ? 'true' : 'false'}>
      {isEditing ? (
        <div
          ref={editorRef}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onInput={onInput}
          onBlur={onBlur}
          data-testid={`${testIdBase}-editor`}
          className={cn(
            // No ring on focus and no leading override — the edit surface
            // visually matches the rendered button surface exactly so toggling
            // edit mode doesn't shift the row's height. Caret + IME are the
            // only edit affordance.
            'block w-full whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-sm outline-none',
            textClassName,
          )}
          role="textbox"
          aria-multiline={multiline ? 'true' : 'false'}
          aria-label={ariaLabel}
        />
      ) : (
        <button
          type="button"
          onClick={enterEdit}
          aria-label={`Edit ${ariaLabel.toLowerCase()}`}
          className={cn(
            'block w-full cursor-text whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50',
            isEmpty ? 'italic text-muted-foreground/50' : 'text-foreground',
            textClassName,
          )}
        >
          {isEmpty ? placeholder : value}
        </button>
      )}
    </div>
  );
}

// htmlNode detail section — surfaces the relative `data.htmlPath` and provides
// Open-in-editor + Reveal-in-file-manager shellout buttons. Both POST to the
// project-scoped /files endpoint; on `ok: false` (EDITOR unset, spawn failure,
// file missing) the helper falls back to copying the absolute path to the
// clipboard and surfacing an inline status line.
export function HtmlNodeSection({
  projectId,
  htmlPath,
}: {
  projectId: string;
  htmlPath: string;
}) {
  const [status, setStatus] = useState<{
    kind: 'idle' | 'pending' | 'copied' | 'error';
    message?: string;
  }>({ kind: 'idle' });

  const fallbackCopy = async (absPath: string, hint: string) => {
    try {
      await navigator.clipboard.writeText(absPath);
      setStatus({ kind: 'copied', message: hint });
      setTimeout(() => setStatus({ kind: 'idle' }), 1200);
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Clipboard write failed',
      });
    }
  };

  const dispatch = async (action: 'open' | 'reveal') => {
    setStatus({ kind: 'pending' });
    try {
      const result =
        action === 'open'
          ? await openProjectFile(projectId, htmlPath)
          : await revealProjectFile(projectId, htmlPath);
      if (result.ok) {
        setStatus({ kind: 'idle' });
        return;
      }
      const hint =
        action === 'open' ? 'Copied path — paste into your editor' : 'Copied path to clipboard';
      await fallbackCopy(result.absPath, hint);
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-xs"
      data-testid="detail-panel-html-node"
    >
      <div className="flex flex-col gap-1">
        <span className="font-medium tracking-wide text-[10px] text-muted-foreground">Path</span>
        <code
          data-testid="detail-panel-html-path"
          className="block break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px]"
        >
          {htmlPath}
        </code>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2"
          onClick={() => {
            void dispatch('open');
          }}
          disabled={status.kind === 'pending'}
          data-testid="detail-panel-html-open"
          aria-label="Open in editor"
        >
          <PencilLine className="h-3.5 w-3.5" />
          Open in editor
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2"
          onClick={() => {
            void dispatch('reveal');
          }}
          disabled={status.kind === 'pending'}
          data-testid="detail-panel-html-reveal"
          aria-label="Reveal in Finder/Explorer"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Reveal
        </Button>
      </div>
      {status.kind === 'copied' || status.kind === 'error' ? (
        <div
          data-testid="detail-panel-html-status"
          data-status={status.kind}
          className={cn(
            'text-[11px]',
            status.kind === 'copied' ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {status.message ?? ''}
        </div>
      ) : null}
    </div>
  );
}

function ConnectorSummary({ connector }: { connector: Connector }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs">
      <dl className="divide-y">
        <SummaryRow label="Source" value={connector.source} />
        <SummaryRow label="Target" value={connector.target} />
        <SummaryRow label="Kind" value={connector.kind} />
        {connector.label ? <SummaryRow label="Label" value={connector.label} /> : null}
        {connector.style ? <SummaryRow label="Style" value={connector.style} /> : null}
        {connector.color ? <SummaryRow label="Color" value={connector.color} /> : null}
        {connector.direction ? <SummaryRow label="Direction" value={connector.direction} /> : null}
        {connector.kind === 'http' && connector.url ? (
          <SummaryRow label="URL" value={`${connector.method ?? 'GET'} ${connector.url}`} />
        ) : null}
        {connector.kind === 'event' ? (
          <SummaryRow label="Event" value={connector.eventName} />
        ) : null}
        {connector.kind === 'queue' ? (
          <SummaryRow label="Queue" value={connector.queueName} />
        ) : null}
      </dl>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="w-20 shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-all font-mono">{value}</dd>
    </div>
  );
}
