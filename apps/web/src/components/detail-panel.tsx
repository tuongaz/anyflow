import { JsonTree } from '@/components/json-tree';
import { StatusPill } from '@/components/nodes/status-pill';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useNodeDetail } from '@/hooks/use-node-detail';
import type { NodeEventLogEntry } from '@/hooks/use-node-events';
import type { NodeRunState } from '@/hooks/use-node-runs';
import { type Connector, type DemoNode, openProjectFile, revealProjectFile } from '@/lib/api';
import {
  getStoredDetailPanelWidth,
  setStoredDetailPanelWidth,
  startResizeGesture,
} from '@/lib/detail-panel-width';
import { cn } from '@/lib/utils';
import { Check, FolderOpen, Pencil, PencilLine, RefreshCw } from 'lucide-react';
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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface DetailPanelProps {
  /** Demo id — required so the dynamic-source proxy can find the node. */
  demoId: string | null;
  node: DemoNode | null;
  connector: Connector | null;
  /** Current run state for the selected node, when known. */
  run?: NodeRunState;
  /** Last N node:* events for the selected node (newest first). */
  recentEvents?: NodeEventLogEntry[];
  /**
   * US-005: commit a new long-form description (`detail.description`) for the
   * given node. When omitted, the Description block is read-only — no pencil
   * affordance appears. Saving an empty string clears the description.
   */
  onDescriptionChange?: (nodeId: string, description: string) => void;
  /**
   * US-011 (text-and-group-resize): commit a new one-line caption to
   * `data.shortDescription` for the given node. Works for every node variant
   * (shape, play, state, image, icon, group). When omitted the input is
   * read-only. Empty string clears the field on disk.
   */
  onShortDescriptionChange?: (nodeId: string, value: string) => void;
  /**
   * US-011 (text-and-group-resize): commit new long-form notes to
   * `data.description` for the given node. Distinct from
   * `onDescriptionChange` above which targets `detail.description` (play/state
   * only). Empty string clears the field on disk.
   */
  onMetaDescriptionChange?: (nodeId: string, value: string) => void;
  /**
   * US-013 (text-and-group-resize): commit a new `data.label` for the given
   * node from the side panel. Currently surfaced only for group nodes — the
   * inline editor on the group's label slot (group-node.tsx) still works in
   * parallel. Both paths SHOULD route to the same dispatcher (e.g.
   * demo-view.tsx's `onNodeLabelChange`) so the existing coalesce key
   * `node:<id>:label` keeps a typing session collapsed into a single undo
   * entry. When omitted the input is read-only.
   */
  onLabelChange?: (nodeId: string, label: string) => void;
  onClose: () => void;
}

export function DetailPanel({
  demoId,
  node,
  connector,
  run,
  recentEvents,
  onDescriptionChange,
  onShortDescriptionChange,
  onMetaDescriptionChange,
  onLabelChange,
  onClose,
}: DetailPanelProps) {
  // US-011 (text-and-group-resize): every node variant now carries free-text
  // metadata (`data.shortDescription`, `data.description`) editable via the
  // side panel. The pre-US-011 gate excluded decorative nodes (image, icon,
  // group); that gate is gone so the panel opens for any selected node. The
  // play/state-only sections (detail summary/fields/dynamicSource, run,
  // events) stay gated on `functionalNode` below.
  const inspectableNode = node;
  const open = inspectableNode !== null || connector !== null;
  // Shape, image, icon, group are decorative — no detail/dynamicSource/run
  // surface. Only play/state nodes carry `data.detail` and run state.
  const functionalNode =
    inspectableNode && (inspectableNode.type === 'playNode' || inspectableNode.type === 'stateNode')
      ? inspectableNode
      : null;
  const detail = functionalNode?.data.detail;
  // ImageNodeData has no `label`; shape/play/state/icon/group nodes do (optional or required).
  const nodeLabel =
    inspectableNode && 'label' in inspectableNode.data ? inspectableNode.data.label : undefined;
  const hasDynamicSource = !!detail?.dynamicSource;

  const { state: dynamicState, refresh: refreshDynamic } = useNodeDetail(
    demoId,
    inspectableNode?.id ?? null,
    hasDynamicSource,
  );

  // US-019: panel width is user-resizable above the sm breakpoint via a left-
  // edge handle; the value persists across sessions in localStorage. The CSS
  // variable is consumed by the `sm:!w-[var(...)] sm:!max-w-[var(...)]`
  // override below — below sm the base SheetContent's `w-3/4 sm:max-w-sm`
  // applies untouched.
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
          // US-005/US-017: when the description editor is in edit mode, Escape
          // is the cancel-edit shortcut — preventDefault stops Radix from also
          // closing the entire Sheet. The EditableDescription's own
          // onKeyDown handles the cancel side. Without this, Escape would
          // discard the edit AND close the panel, dropping the user out of
          // the inspector entirely.
          const active = document.activeElement as HTMLElement | null;
          if (active?.getAttribute('data-testid') === 'detail-panel-description-editor') {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          // Resize gestures (US-031) start with a pointerdown on a
          // .react-flow__resize-control outside the Sheet. Radix's default
          // behavior is to close the Sheet on outside interaction, which would
          // also unmount the resize controls mid-gesture and clear the
          // selection. Suppress the close in that case so the panel stays
          // open through the entire resize.
          const target = e.target as HTMLElement | null;
          if (target?.closest('.react-flow__resize-control')) e.preventDefault();
          // Style-strip color popovers render their content into a portal
          // outside the SheetContent. A click inside the popover (or on its
          // trigger via Radix's outside-pointer detection) would otherwise
          // close the Sheet. Keep it open.
          if (target?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
          // Clicks on the canvas style strip itself live outside the Sheet —
          // keep the panel open while the user adjusts styles for the
          // currently-selected entity.
          if (target?.closest('[data-testid="canvas-style-strip"]')) e.preventDefault();
          // Clicks inside a React Flow node are part of the inspector's UX —
          // selecting another node, double-clicking a label to inline-edit,
          // hitting the Play button, etc. The panel must NOT close on those.
          // Clicks on the pane (no .react-flow__node ancestor) still fall
          // through and trigger the default close.
          if (target?.closest('.react-flow__node')) e.preventDefault();
          // Same treatment for connectors: clicking another edge swaps the
          // selection, and grabbing the selected edge's endpoint to drag
          // (.react-flow__edgeupdater) starts a reconnect gesture. Neither
          // should close the panel.
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
              <SheetTitle data-testid="detail-panel-title">{nodeLabel ?? ''}</SheetTitle>
              <SheetDescription className="font-mono text-[11px]">
                {inspectableNode.id} · {inspectableNode.type}
              </SheetDescription>
            </div>

            <div className="mt-0 flex flex-col gap-3">
              <NodeMetadataEditor
                nodeId={inspectableNode.id}
                // US-013 / US-018: Label input is surfaced for group nodes AND
                // htmlNodes — neither has a canvas-side label affordance (group
                // has the inline-on-frame editor too, but the panel is the
                // primary surface; htmlNode has no on-canvas label at all). All
                // other variants (play/state/shape/image/icon) edit labels via
                // inline editors / StyleStrip and pass `label={undefined}` to
                // collapse the row. Routing `onLabelChange` through the SAME
                // dispatcher both surfaces use keeps the
                // `node:<id>:label` coalesce key shared so panel + inline edits
                // collapse into one undo entry per typing session.
                label={
                  inspectableNode.type === 'group' || inspectableNode.type === 'htmlNode'
                    ? (inspectableNode.data.label ?? '')
                    : undefined
                }
                onLabelChange={
                  inspectableNode.type === 'group' || inspectableNode.type === 'htmlNode'
                    ? onLabelChange
                    : undefined
                }
                shortDescription={inspectableNode.data.shortDescription ?? ''}
                description={inspectableNode.data.description ?? ''}
                onShortDescriptionChange={onShortDescriptionChange}
                onMetaDescriptionChange={onMetaDescriptionChange}
              />

              {inspectableNode.type === 'htmlNode' && demoId ? (
                <HtmlNodeSection projectId={demoId} htmlPath={inspectableNode.data.htmlPath} />
              ) : null}

              {detail?.description || detail?.summary ? (
                <EditableDescription
                  nodeId={inspectableNode.id}
                  source={detail.description ?? detail.summary ?? ''}
                  onSave={onDescriptionChange}
                />
              ) : null}

              {detail?.fields && detail.fields.length > 0 ? (
                <div className="rounded-md border bg-muted/30">
                  <dl className="divide-y">
                    {detail.fields.map((field) => (
                      <div key={field.label} className="flex items-start gap-3 px-3 py-2 text-xs">
                        <dt className="w-24 shrink-0 font-medium text-muted-foreground">
                          {field.label}
                        </dt>
                        <dd className="flex-1 break-all font-mono">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {hasDynamicSource ? (
                <DynamicSection state={dynamicState} onRefresh={refreshDynamic} />
              ) : null}

              {run ? <RunSection run={run} /> : null}

              {recentEvents && recentEvents.length > 0 ? (
                <RecentEventsSection events={recentEvents} />
              ) : null}
            </div>
          </div>
        ) : connector ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <SheetTitle data-testid="detail-panel-title">
                {connector.label ?? 'Connector'}
              </SheetTitle>
              <SheetDescription className="font-mono text-[11px]">
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

// US-017: GFM markdown for node descriptions. Raw HTML is NOT enabled
// (no rehype-raw) so untrusted strings can't inject script tags; links open in
// a new tab with rel="noopener noreferrer" to prevent reverse-tabnabbing.
const DESCRIPTION_CLASSES = cn(
  'text-sm text-foreground/90 leading-relaxed',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold',
  '[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold',
  '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2',
  '[&_pre>code]:bg-transparent [&_pre>code]:p-0',
  '[&_a]:text-primary [&_a]:underline',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-foreground/80',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-3 [&_hr]:border-t',
);

export function DescriptionMarkdown({ source }: { source: string }) {
  return (
    <div className={DESCRIPTION_CLASSES} data-testid="detail-panel-description">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// US-005/US-017: editable wrapper around the rendered Description markdown.
// The pencil/save icons live in the top-right of the block; the pencil is the
// only affordance — no always-visible Edit button. Default is rendered
// markdown; clicking the pencil swaps to a contentEditable div seeded with
// the RAW markdown source (no live preview — asterisks/hashes/etc. visible
// character-for-character); the save (check) icon commits; Escape or blurring
// to a non-save target discards. Save and discard each route through
// `onSave(nodeId, value)` which the parent translates into a single undo
// entry (see demo-view.tsx::onDetailDescriptionChange).
//
// WHY contentEditable + plaintext-only over <textarea>: the editor inherits
// the panel's typography (no jarring font-mono swap on enter-edit) and feels
// inline / WYSIWYG-ish while still showing raw markdown source. Firefox
// doesn't implement contentEditable='plaintext-only', so Enter and paste are
// intercepted to force plain-text insertion via execCommand — the resulting
// DOM textContent always matches the textarea-like value our save path
// expects. We read on commit via textContent (NEVER innerHTML — would leak
// pasted HTML; NEVER innerText — normalizes whitespace in ways that mangle
// markdown). The element is uncontrolled: the source is seeded ONCE on
// enter-edit (useEffect imperative write), then the browser owns the DOM
// until commit/cancel — React must not write children on every keystroke or
// caret positioning fights the IME.
export function EditableDescription({
  nodeId,
  source,
  onSave,
}: {
  nodeId: string;
  source: string;
  onSave?: (nodeId: string, description: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(source);
  const editorRef = useRef<HTMLDivElement | null>(null);
  // Prevent editor onBlur from discarding when focus is moving to the save
  // button (which fires its onClick AFTER blur). The save button's
  // onMouseDown sets this flag; we re-enable blur-discard after onClick.
  const suppressBlurRef = useRef(false);

  // External `source` updates (e.g. SSE echo) shouldn't clobber an in-progress
  // edit, but when not editing we want the draft to track the latest source.
  useEffect(() => {
    if (!isEditing) setDraft(source);
  }, [source, isEditing]);

  // On enter-edit: seed the editor's text via direct DOM write, focus, and
  // select-all so the user can immediately overtype. This is parity with the
  // textarea's `el.select()` behavior. We seed via DOM (not via JSX children)
  // because contentEditable + React children fights React's reconciliation —
  // see InlineEdit for the same rationale.
  useEffect(() => {
    if (!isEditing) return;
    const el = editorRef.current;
    if (!el) return;
    el.textContent = source;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [isEditing, source]);

  // When `onSave` isn't wired (read-only mode), render the plain markdown
  // with no chrome — same DOM as the prior implementation so callers that
  // depend on the bare DescriptionMarkdown layout aren't affected.
  if (!onSave) return <DescriptionMarkdown source={source} />;

  const enterEdit = () => {
    setDraft(source);
    setIsEditing(true);
  };

  const commit = () => {
    // textContent is authoritative when the editor is mounted; `draft` is a
    // mirror updated via onInput (so tests can override it via the hook-shim
    // when no real DOM exists).
    const text = editorRef.current?.textContent ?? draft;
    onSave(nodeId, text);
    setIsEditing(false);
  };

  const cancel = () => {
    setDraft(source);
    setIsEditing(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Stop the keystroke from bubbling to the canvas — Backspace/Delete on
    // the canvas would otherwise trigger node deletion (US-027). Cover the
    // native side too: window-level shortcuts listen for native events, not
    // React's synthetic ones.
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      // Sheet's Escape-to-close suppression is handled at the SheetContent
      // level via onEscapeKeyDown (see DetailPanel below).
      return;
    }
    if (e.key === 'Enter') {
      // contentEditable='plaintext-only' on Chromium/Safari inserts a literal
      // '\n' on Enter; Firefox doesn't honor plaintext-only and would insert
      // a <br> or <div>. Force '\n' via execCommand so textContent always
      // round-trips through markdown without spurious double-newlines.
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  };

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    // plaintext-only forces paste-as-text on Chromium/Safari; Firefox needs
    // an explicit preventDefault + insertText to strip rich-text formatting
    // from the clipboard payload. Either way the result is plain text only.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const onInput = (e: ReactFormEvent<HTMLDivElement>) => {
    setDraft((e.currentTarget as HTMLDivElement).textContent ?? '');
  };

  const onBlur = () => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      return;
    }
    cancel();
  };

  return (
    <div
      className="group relative"
      data-testid="detail-panel-description-block"
      data-editing={isEditing ? 'true' : 'false'}
    >
      {isEditing ? (
        <>
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
            data-testid="detail-panel-description-editor"
            className="block w-full whitespace-pre-wrap break-words rounded-md border bg-background px-2 py-1.5 pr-8 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring"
            role="textbox"
            aria-multiline="true"
            aria-label="Edit description"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="absolute right-0.5 top-0.5 h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onMouseDown={() => {
              suppressBlurRef.current = true;
            }}
            onClick={commit}
            data-testid="detail-panel-description-save"
            aria-label="Save description"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <>
          <DescriptionMarkdown source={source} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="absolute right-0.5 top-0.5 h-6 w-6 p-0 text-muted-foreground opacity-30 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={enterEdit}
            data-testid="detail-panel-description-edit"
            aria-label="Edit description"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

export const NODE_SHORT_DESCRIPTION_MAX_LENGTH = 200;

// US-020: rendered-text + hover-pencil + contentEditable editor for a single
// metadata field. Mirrors EditableDescription's state machine — the input/
// textarea form controls are gone; this is the universal surface used by
// NodeMetadataEditor below for Label, Short description, and Description.
//
// Default view renders the value as plain text (or a muted-italic placeholder
// when empty). Hovering reveals the pencil in the top-right corner; clicking
// it swaps to a contentEditable div seeded from `value` and focuses with the
// full content selected so the user can immediately overtype. Save (check
// icon, same corner) commits via `onSave(nodeId, value)`; blur or Escape
// cancels. `suppressBlurRef` keeps the save click from being eaten by blur.
//
// `multiline: false` (Label, Short description) — Enter commits.
// `multiline: true` (Description) — Enter inserts a literal '\n' via
// execCommand so contentEditable on Firefox doesn't insert <br>/<div>.
//
// `maxLength` truncates inside `onInput` and re-collapses the caret to the
// end. The editor is uncontrolled (textContent is the source of truth) —
// React doesn't write children on every keystroke, so caret positioning and
// IME composition stay stable.
export function EditableMetadataField({
  nodeId,
  value,
  placeholder,
  multiline,
  maxLength,
  ariaLabel,
  testIdBase,
  onSave,
}: {
  nodeId: string;
  value: string;
  placeholder: string;
  multiline: boolean;
  maxLength?: number;
  ariaLabel: string;
  testIdBase: string;
  onSave?: (nodeId: string, value: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const editorRef = useRef<HTMLDivElement | null>(null);
  // Suppress the editor's onBlur cancel when focus is moving to the save
  // button (save's onClick fires AFTER blur). Mirrors EditableDescription.
  const suppressBlurRef = useRef(false);

  // When not editing, track external `value` changes (SSE echo, undo). When
  // editing, leave draft alone so an in-flight typing session isn't clobbered.
  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  // On enter-edit: seed textContent imperatively, focus, select-all. We seed
  // via DOM (not JSX children) because contentEditable + React children
  // fights React's reconciliation — see EditableDescription for the same
  // rationale.
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
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [isEditing, value]);

  const isEmpty = value === '';

  // Read-only mode: render plain text (or placeholder when empty) with no
  // pencil. Preserves the prior `readOnly={!callback}` UX of the input.
  if (!onSave) {
    return (
      <div
        data-testid={testIdBase}
        aria-label={ariaLabel}
        className={cn(
          'w-full whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-sm',
          isEmpty ? 'italic text-muted-foreground/50' : 'text-foreground',
        )}
      >
        {isEmpty ? placeholder : value}
      </div>
    );
  }

  const enterEdit = () => {
    setDraft(value);
    setIsEditing(true);
  };

  const commit = () => {
    // textContent is authoritative when the editor is mounted; `draft` is a
    // mirror updated via onInput (and the source of truth in test renderers
    // that don't have a real DOM).
    const text = editorRef.current?.textContent ?? draft;
    onSave(nodeId, text);
    setIsEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setIsEditing(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Stop the keystroke from bubbling to the canvas — Backspace/Delete on
    // the canvas would otherwise trigger node deletion (US-027). Cover the
    // native side too: window-level shortcuts listen for native events.
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (multiline) {
        // Firefox doesn't honor contentEditable='plaintext-only' — forcing
        // '\n' via execCommand keeps textContent free of stray <br>/<div>.
        document.execCommand('insertText', false, '\n');
      } else {
        commit();
      }
    }
  };

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    // plaintext-only forces paste-as-text on Chromium/Safari; Firefox needs
    // explicit preventDefault + insertText to strip rich-text from the
    // clipboard payload.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const onInput = (e: ReactFormEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    const text = el.textContent ?? '';
    if (maxLength !== undefined && text.length > maxLength) {
      const truncated = text.slice(0, maxLength);
      el.textContent = truncated;
      // Restore caret to the end so the next keystroke continues at the cap.
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setDraft(truncated);
      return;
    }
    setDraft(text);
  };

  const onBlur = () => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      return;
    }
    cancel();
  };

  return (
    <div
      className="group relative"
      data-testid={testIdBase}
      data-editing={isEditing ? 'true' : 'false'}
    >
      {isEditing ? (
        <>
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
              'block w-full whitespace-pre-wrap break-words rounded-md border bg-background px-2 py-1.5 pr-8 text-sm outline-none focus:ring-1 focus:ring-ring',
              multiline ? 'min-h-[3.5rem] leading-relaxed' : 'leading-normal',
            )}
            role="textbox"
            aria-multiline={multiline ? 'true' : 'false'}
            aria-label={ariaLabel}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="absolute right-0.5 top-0.5 h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onMouseDown={() => {
              suppressBlurRef.current = true;
            }}
            onClick={commit}
            data-testid={`${testIdBase}-save`}
            aria-label={`Save ${ariaLabel.toLowerCase()}`}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <>
          <div
            aria-label={ariaLabel}
            className={cn(
              'w-full whitespace-pre-wrap break-words rounded-md px-2 py-1.5 pr-8 text-sm',
              isEmpty ? 'italic text-muted-foreground/50' : 'text-foreground',
            )}
          >
            {isEmpty ? placeholder : value}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="absolute right-0.5 top-0.5 h-6 w-6 p-0 text-muted-foreground opacity-30 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={enterEdit}
            data-testid={`${testIdBase}-edit`}
            aria-label={`Edit ${ariaLabel.toLowerCase()}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

// US-020: side-panel metadata block. Pure layout shell — every editable field
// is an EditableMetadataField (rendered-text + hover-pencil + contentEditable).
// The input/textarea form controls and their *Draft / autosize / onBlur
// plumbing are gone; EditableMetadataField owns that state.
export function NodeMetadataEditor({
  nodeId,
  label,
  shortDescription,
  description,
  onLabelChange,
  onShortDescriptionChange,
  onMetaDescriptionChange,
}: {
  nodeId: string;
  /**
   * Optional Label row, surfaced ONLY when this prop is a defined string.
   * `undefined` (the default for shape/play/state/image/icon nodes today)
   * hides the row entirely; an empty string still renders the field with a
   * muted "Group label" placeholder so unlabeled groups have a place to
   * click.
   */
  label?: string;
  shortDescription: string;
  description: string;
  /**
   * Dispatch a new `data.label` value. When omitted, the label field is
   * read-only (rendered text + no pencil). Empty string clears the label on
   * disk (parity with the inline editor in group-node.tsx).
   */
  onLabelChange?: (nodeId: string, value: string) => void;
  onShortDescriptionChange?: (nodeId: string, value: string) => void;
  onMetaDescriptionChange?: (nodeId: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="detail-panel-metadata">
      {label !== undefined ? (
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium tracking-wide text-[10px] text-muted-foreground">Label</span>
          <EditableMetadataField
            nodeId={nodeId}
            value={label}
            placeholder="Group label"
            multiline={false}
            ariaLabel="Label"
            testIdBase="detail-panel-label"
            onSave={onLabelChange}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1 text-xs">
        <span className="font-medium tracking-wide text-[10px] text-muted-foreground">
          Short description
        </span>
        <EditableMetadataField
          nodeId={nodeId}
          value={shortDescription}
          placeholder="One-line caption"
          multiline={false}
          maxLength={NODE_SHORT_DESCRIPTION_MAX_LENGTH}
          ariaLabel="Short description"
          testIdBase="detail-panel-short-description"
          onSave={onShortDescriptionChange}
        />
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="font-medium tracking-wide text-[10px] text-muted-foreground">
          Description
        </span>
        <EditableMetadataField
          nodeId={nodeId}
          value={description}
          placeholder="Notes, context, anything…"
          multiline={true}
          ariaLabel="Description"
          testIdBase="detail-panel-description-meta"
          onSave={onMetaDescriptionChange}
        />
      </div>
    </div>
  );
}

// US-018: htmlNode detail section — surfaces the relative `data.htmlPath`
// and provides Open-in-editor + Reveal-in-file-manager shellout buttons.
// Both buttons POST to the project-scoped /files endpoint (US-003); on
// `ok: false` (EDITOR-unset, spawn failure, file missing) the helper falls
// back to copying the absolute path to the clipboard and surfacing an inline
// status line, so the user can paste it into their editor manually. No toast
// library is wired up — the inline status mirrors EmptyState's copy
// affordance (1.2s "Copied" indicator).
export function HtmlNodeSection({
  projectId,
  htmlPath,
}: {
  projectId: string;
  htmlPath: string;
}) {
  // status: idle (default), pending (spawn in flight), copied (path on
  // clipboard, ~1.2s), error (network/transport failure — distinct from the
  // soft-fail spawn case, which lands as `copied`).
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

function DynamicSection({
  state,
  onRefresh,
}: {
  state: ReturnType<typeof useNodeDetail>['state'];
  onRefresh: () => void;
}) {
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-xs"
      data-testid="detail-panel-dynamic"
      data-status={state.status}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium tracking-wide text-[10px] text-muted-foreground">
          Live detail
        </span>
        <div className="flex items-center gap-2">
          {state.status === 'success' && typeof state.result.status === 'number' ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {state.result.status}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={onRefresh}
            disabled={state.status === 'loading'}
            data-testid="detail-panel-refresh"
            aria-label="Refresh dynamic detail"
          >
            <RefreshCw className={`h-3 w-3 ${state.status === 'loading' ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {state.status === 'loading' || state.status === 'idle' ? (
        <DynamicSkeleton />
      ) : state.status === 'error' ? (
        <div className="rounded bg-rose-50 px-2 py-1.5 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          {state.message}
        </div>
      ) : state.result.error ? (
        <div className="rounded bg-rose-50 px-2 py-1.5 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          {state.result.error}
        </div>
      ) : (
        <div className="max-h-72 overflow-auto rounded bg-muted/40 p-2">
          <JsonTree value={state.result.body} />
        </div>
      )}
    </div>
  );
}

function DynamicSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" data-testid="detail-panel-dynamic-skeleton">
      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
    </div>
  );
}

function RecentEventsSection({ events }: { events: NodeEventLogEntry[] }) {
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-xs"
      data-testid="detail-panel-recent-events"
    >
      <div className="mb-2 font-medium tracking-wide text-[10px] text-muted-foreground">
        Recent events
      </div>
      <ul className="flex flex-col gap-1">
        {events.map((entry, idx) => (
          <li
            key={`${entry.ts}-${idx}`}
            className="flex items-center justify-between gap-2"
            data-testid="detail-panel-recent-event"
            data-status={entry.status}
          >
            <StatusPill status={entry.status} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatTimestamp(entry.ts)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

function RunSection({ run }: { run: NodeRunState }) {
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-xs"
      data-testid="detail-panel-run"
      data-status={run.status}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium tracking-wide text-[10px] text-muted-foreground">
          Last run
        </span>
        <div className="flex items-center gap-2">
          {typeof run.responseStatus === 'number' ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {run.responseStatus}
            </span>
          ) : null}
          <StatusPill status={run.status} />
        </div>
      </div>
      {run.status === 'error' && run.error ? (
        <div className="rounded bg-rose-50 px-2 py-1.5 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          {run.error}
        </div>
      ) : null}
      {run.body !== undefined ? (
        <div className="mt-1 max-h-72 overflow-auto rounded bg-muted/40 p-2">
          <JsonTree value={run.body} />
        </div>
      ) : null}
    </div>
  );
}
