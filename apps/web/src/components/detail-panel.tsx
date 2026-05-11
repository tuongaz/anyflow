import { JsonTree } from '@/components/json-tree';
import { StatusPill } from '@/components/nodes/status-pill';
import type { NodeStylePatch } from '@/components/style-strip';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { useNodeDetail } from '@/hooks/use-node-detail';
import type { NodeEventLogEntry } from '@/hooks/use-node-events';
import type { NodeRunState } from '@/hooks/use-node-runs';
import type { ColorToken, Connector, DemoNode } from '@/lib/api';
import { COLOR_TOKENS } from '@/lib/color-tokens';
import {
  getStoredDetailPanelWidth,
  setStoredDetailPanelWidth,
  startResizeGesture,
} from '@/lib/detail-panel-width';
import { ICON_REGISTRY } from '@/lib/icon-registry';
import { cn } from '@/lib/utils';
import { Check, RefreshCw } from 'lucide-react';
import {
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface DetailPanelProps {
  /** Demo id — required so the dynamic-source proxy can find the node. */
  demoId: string | null;
  node: DemoNode | null;
  connector: Connector | null;
  filePath?: string;
  /** Current run state for the selected node, when known. */
  run?: NodeRunState;
  /** Last N node:* events for the selected node (newest first). */
  recentEvents?: NodeEventLogEntry[];
  /**
   * US-015: open the icon picker in replace mode against the selected
   * iconNode. Wired via demo-view's openIconPicker slice; absent when no
   * demo is loaded.
   */
  onChangeIcon?: (nodeId: string) => void;
  /**
   * US-015: apply a single-field patch to a node — used by the iconNode
   * detail section to edit color/strokeWidth/alt. Same channel the canvas
   * style strip uses, so optimistic preview + undo behaviour matches.
   */
  onStyleNode?: (nodeId: string, patch: NodeStylePatch) => void;
  onClose: () => void;
}

const ICON_PALETTE_TOKENS: ColorToken[] = [
  'default',
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
];
const ICON_FALLBACK_NAME = 'help-circle';
const DEFAULT_STROKE_WIDTH = 2;
const STROKE_MIN = 0.5;
const STROKE_MAX = 4;
const STROKE_STEP = 0.25;

export function DetailPanel({
  demoId,
  node,
  connector,
  filePath,
  run,
  recentEvents,
  onChangeIcon,
  onStyleNode,
  onClose,
}: DetailPanelProps) {
  // imageNode is decorative — clicking it must NOT open the detail panel
  // (US-007). iconNode used to be excluded too but now opens an iconNode
  // section (US-015). Selection / style-strip / resize handles still work for
  // imageNode because they live on the React Flow node, not the panel.
  const inspectableNode =
    node && node.type !== 'imageNode' && node.type !== 'iconNode' ? node : null;
  const iconNode = node && node.type === 'iconNode' ? node : null;
  const open = inspectableNode !== null || iconNode !== null || connector !== null;
  // Shape and image nodes are decorative — no detail/dynamicSource/run surface.
  const functionalNode =
    inspectableNode && inspectableNode.type !== 'shapeNode' ? inspectableNode : null;
  const detail = functionalNode?.data.detail;
  // ImageNodeData has no `label`; shape/play/state nodes do (optional or required).
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
              {detail?.description || detail?.summary ? (
                <DescriptionMarkdown source={detail.description ?? detail.summary ?? ''} />
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

              {filePath ? (
                <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                  <div className="font-medium tracking-wide text-[10px] mb-1">Demo file</div>
                  <div className="font-mono break-all">{filePath}</div>
                </div>
              ) : null}
            </div>
          </div>
        ) : iconNode ? (
          <IconNodeSection node={iconNode} onChangeIcon={onChangeIcon} onStyleNode={onStyleNode} />
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

// US-015: iconNode detail-panel section. Renders a preview tile + Change-icon
// button, a color swatch row, a stroke-width slider, and an alt-text input.
// All edits flow through `onStyleNode` (the same channel the canvas style
// strip uses), so optimistic preview + coalesced undo behaviour matches.
// Exported so unit tests can render it without standing up the Radix Sheet
// portal — Sheet/SheetContent are sub-components and would be captured as
// placeholders by the hook-shim renderer.
export function IconNodeSection({
  node,
  onChangeIcon,
  onStyleNode,
}: {
  node: Extract<DemoNode, { type: 'iconNode' }>;
  onChangeIcon?: (nodeId: string) => void;
  onStyleNode?: (nodeId: string, patch: NodeStylePatch) => void;
}) {
  const PreviewIcon = ICON_REGISTRY[node.data.icon] ?? ICON_REGISTRY[ICON_FALLBACK_NAME];
  const activeColor: ColorToken = node.data.color ?? 'default';
  const strokeWidth = node.data.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const [altLocal, setAltLocal] = useState<string>(node.data.alt ?? '');
  // Keep local alt in sync with upstream (e.g. SSE echo or undo) without
  // fighting in-flight typing — only re-sync when the upstream value changes.
  useEffect(() => {
    setAltLocal(node.data.alt ?? '');
  }, [node.data.alt]);
  const [strokeLocal, setStrokeLocal] = useState<number>(strokeWidth);
  useEffect(() => {
    setStrokeLocal(strokeWidth);
  }, [strokeWidth]);

  const onChangeIconClick = () => onChangeIcon?.(node.id);
  const onPickColor = (token: ColorToken) => {
    onStyleNode?.(node.id, { color: token });
  };
  const onCommitStrokeWidth = ([value]: number[]) => {
    const next = value ?? DEFAULT_STROKE_WIDTH;
    setStrokeLocal(next);
    onStyleNode?.(node.id, { strokeWidth: next });
  };
  const onAltChange = (e: ChangeEvent<HTMLInputElement>) => setAltLocal(e.target.value);
  const onAltCommit = () => {
    if (altLocal === (node.data.alt ?? '')) return;
    onStyleNode?.(node.id, { alt: altLocal });
  };
  const onAltKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="detail-panel-icon-node">
      <div className="flex flex-col gap-1">
        <SheetTitle data-testid="detail-panel-title">{node.data.icon}</SheetTitle>
        <SheetDescription className="font-mono text-[11px]">{node.id} · iconNode</SheetDescription>
      </div>

      <div className="mt-0 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div
            data-testid="detail-panel-icon-preview"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-foreground"
          >
            {PreviewIcon ? <PreviewIcon className="h-7 w-7" strokeWidth={2} /> : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onChangeIconClick}
            disabled={!onChangeIcon}
            data-testid="detail-panel-change-icon"
          >
            Change icon…
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Color
          </div>
          <div className="grid grid-cols-8 gap-1.5" data-testid="detail-panel-icon-color">
            {ICON_PALETTE_TOKENS.map((token) => {
              const isActive = activeColor === token;
              const palette = COLOR_TOKENS[token];
              const isDefault = token === 'default';
              return (
                <button
                  key={token}
                  type="button"
                  onClick={() => onPickColor(token)}
                  disabled={!onStyleNode}
                  data-testid={`detail-panel-icon-color-${token}`}
                  data-active={isActive}
                  aria-label={`icon color ${token}`}
                  aria-pressed={isActive}
                  title={token}
                  className={cn(
                    'relative flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all',
                    isActive
                      ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
                      : 'hover:scale-110',
                  )}
                  style={{ backgroundColor: palette.edge, borderColor: palette.edge }}
                >
                  {isDefault ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-full"
                      style={{
                        backgroundImage:
                          'linear-gradient(45deg, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%)',
                        color: 'hsl(var(--muted-foreground))',
                        opacity: 0.5,
                      }}
                    />
                  ) : null}
                  {isActive ? (
                    <Check
                      className="h-3 w-3 drop-shadow-sm"
                      style={{ color: 'hsl(var(--foreground))' }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Stroke width
            </div>
            <span
              data-testid="detail-panel-icon-stroke-value"
              className="font-mono text-[11px] tabular-nums text-muted-foreground"
            >
              {strokeLocal}
            </span>
          </div>
          <Slider
            min={STROKE_MIN}
            max={STROKE_MAX}
            step={STROKE_STEP}
            value={[strokeLocal]}
            onValueChange={([v]) => setStrokeLocal(v ?? DEFAULT_STROKE_WIDTH)}
            onValueCommit={onCommitStrokeWidth}
            disabled={!onStyleNode}
            data-testid="detail-panel-icon-stroke-slider"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`detail-panel-icon-alt-${node.id}`}
            className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Alt text
          </label>
          <input
            id={`detail-panel-icon-alt-${node.id}`}
            type="text"
            value={altLocal}
            onChange={onAltChange}
            onBlur={onAltCommit}
            onKeyDown={onAltKeyDown}
            disabled={!onStyleNode}
            placeholder="Describe the icon for screen readers"
            data-testid="detail-panel-icon-alt"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
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
