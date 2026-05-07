import { JsonTree } from '@/components/json-tree';
import { StatusPill } from '@/components/nodes/status-pill';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNodeDetail } from '@/hooks/use-node-detail';
import type { NodeEventLogEntry } from '@/hooks/use-node-events';
import type { NodeRunState } from '@/hooks/use-node-runs';
import type {
  ColorToken,
  Connector,
  ConnectorDirection,
  ConnectorStyle,
  DemoNode,
} from '@/lib/api';
import { COLOR_TOKENS } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { ArrowLeftRight, ArrowRight, Check, MoveLeft, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

// Curated palette order — surfaced once so swatch rows stay visually consistent
// and per-token data-testids match the PRD ('style-tab-border-color-blue' etc).
const PALETTE_TOKENS: ColorToken[] = [
  'default',
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
];

export interface NodeStylePatch {
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
}

export interface ConnectorStylePatch {
  color?: ColorToken;
  style?: ConnectorStyle;
  direction?: ConnectorDirection;
  borderSize?: number;
}

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
  /** Apply a Style-tab edit to the selected node (border / background). */
  onStyleNode?: (nodeId: string, patch: NodeStylePatch) => void;
  /** Apply a Style-tab edit to the selected connector (color / style / direction). */
  onStyleConnector?: (connId: string, patch: ConnectorStylePatch) => void;
  /** Delete the selected node (cascade-removes adjacent connectors server-side). */
  onDeleteNode?: (nodeId: string) => void;
  /** Delete the selected connector. */
  onDeleteConnector?: (connId: string) => void;
  onClose: () => void;
}

type TabKey = 'detail' | 'style';

export function DetailPanel({
  demoId,
  node,
  connector,
  filePath,
  run,
  recentEvents,
  onStyleNode,
  onStyleConnector,
  onDeleteNode,
  onDeleteConnector,
  onClose,
}: DetailPanelProps) {
  const open = node !== null || connector !== null;
  // Shape nodes are decorative — no detail/dynamicSource/run surface.
  const functionalNode = node && node.type !== 'shapeNode' ? node : null;
  const detail = functionalNode?.data.detail;
  const hasDynamicSource = !!detail?.dynamicSource;

  const { state: dynamicState, refresh: refreshDynamic } = useNodeDetail(
    demoId,
    node?.id ?? null,
    hasDynamicSource,
  );

  // Active tab persists during a single selection (per US-024 AC). Reset to
  // 'detail' whenever the selected entity id changes — keying off the id
  // means tab state is preserved across SSE-driven re-renders that keep the
  // same selection.
  const selectionId = node?.id ?? connector?.id ?? null;
  const [tab, setTab] = useState<TabKey>('detail');
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on new selection.
  useEffect(() => {
    setTab('detail');
  }, [selectionId]);

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
        className="!w-[380px] sm:!max-w-[380px] overflow-y-auto"
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
          // Style-tab color popovers (US-032) render their content into a
          // portal outside the SheetContent. A click inside the popover (or
          // on its trigger via Radix's outside-pointer detection) would
          // otherwise close the Sheet. Keep it open.
          if (target?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
          // Clicks inside a React Flow node are part of the inspector's UX —
          // selecting another node, double-clicking a label to inline-edit,
          // hitting the Play button, etc. The panel must NOT close on those.
          // Clicks on the pane (no .react-flow__node ancestor) still fall
          // through and trigger the default close.
          if (target?.closest('.react-flow__node')) e.preventDefault();
        }}
      >
        {node ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <SheetTitle data-testid="detail-panel-title">{node.data.label}</SheetTitle>
                <SheetDescription className="font-mono text-[11px]">
                  {node.id} · {node.type}
                </SheetDescription>
              </div>

              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="detail" data-testid="detail-panel-tab-detail">
                  Detail
                </TabsTrigger>
                <TabsTrigger value="style" data-testid="detail-panel-tab-style">
                  Style
                </TabsTrigger>
              </TabsList>

              <TabsContent value="detail" className="mt-0 flex flex-col gap-3">
                {detail?.summary ? (
                  <p className="text-sm text-foreground/90 leading-relaxed">{detail.summary}</p>
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
              </TabsContent>

              <TabsContent value="style" className="mt-0" data-testid="detail-panel-style-content">
                <NodeStyleTab node={node} onApply={(patch) => onStyleNode?.(node.id, patch)} />
              </TabsContent>
            </div>
          </Tabs>
        ) : connector ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <SheetTitle data-testid="detail-panel-title">
                  {connector.label ?? 'Connector'}
                </SheetTitle>
                <SheetDescription className="font-mono text-[11px]">
                  {connector.id} · {connector.kind}
                </SheetDescription>
              </div>

              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="detail" data-testid="detail-panel-tab-detail">
                  Detail
                </TabsTrigger>
                <TabsTrigger value="style" data-testid="detail-panel-tab-style">
                  Style
                </TabsTrigger>
              </TabsList>

              <TabsContent value="detail" className="mt-0 flex flex-col gap-3">
                <ConnectorSummary connector={connector} />
              </TabsContent>

              <TabsContent value="style" className="mt-0" data-testid="detail-panel-style-content">
                <ConnectorStyleTab
                  connector={connector}
                  onApply={(patch) => onStyleConnector?.(connector.id, patch)}
                  onDelete={onDeleteConnector ? () => onDeleteConnector(connector.id) : undefined}
                />
              </TabsContent>
            </div>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function NodeStyleTab({
  node,
  onApply,
}: {
  node: DemoNode;
  onApply: (patch: NodeStylePatch) => void;
}) {
  const borderActive = (node.data.borderColor ?? 'default') as ColorToken;
  const backgroundActive = (node.data.backgroundColor ?? 'default') as ColorToken;
  const borderStyleActive = (node.data.borderStyle ?? 'solid') as 'solid' | 'dashed' | 'dotted';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row gap-6">
        <SwatchPicker
          label="Border"
          active={borderActive}
          onSelect={(token) => onApply({ borderColor: token })}
          triggerTestId="style-tab-border-color-trigger"
          tokenTestIdPrefix="style-tab-border-color"
          previewKind="border"
        />
        <SwatchPicker
          label="Background"
          active={backgroundActive}
          onSelect={(token) => onApply({ backgroundColor: token })}
          triggerTestId="style-tab-background-color-trigger"
          tokenTestIdPrefix="style-tab-background-color"
          previewKind="background"
        />
      </div>
      <SizeInput
        label="Border size"
        testId="style-tab-border-size"
        value={node.data.borderSize}
        onChange={(n) => onApply({ borderSize: n })}
      />
      <BorderStyleSelect active={borderStyleActive} onSelect={(s) => onApply({ borderStyle: s })} />
      <SizeInput
        label="Font size"
        testId="style-tab-font-size"
        min={10}
        max={32}
        value={node.data.fontSize}
        onChange={(n) => onApply({ fontSize: n })}
      />
    </div>
  );
}

// Three-option select used by both NodeStyleTab and ConnectorStyleTab. The
// connector variant has an extra 'auto' option (clears the override) so it
// stays a separate inline select; this control is node-only.
function BorderStyleSelect({
  active,
  onSelect,
}: {
  active: 'solid' | 'dashed' | 'dotted';
  onSelect: (s: 'solid' | 'dashed' | 'dotted') => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
        Border style
      </span>
      <select
        data-testid="style-tab-border-style"
        className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={active}
        onChange={(e) => onSelect(e.target.value as 'solid' | 'dashed' | 'dotted')}
      >
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
    </div>
  );
}

// Numeric stepper used by NodeStyleTab (Border size, Font size) and
// ConnectorStyleTab (Stroke width). Local string state allows the input to be
// empty while typing; committed value is parsed on every change — empty / NaN
// / out-of-range collapses to undefined (the "clear override" signal). Range
// is configurable via min/max props (default 1-8 px for stroke widths).
function SizeInput({
  label,
  testId,
  value,
  onChange,
  min = 1,
  max = 8,
}: {
  label: string;
  testId: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState<string>(value === undefined ? '' : String(value));
  // Sync local state when the upstream value changes from somewhere else (e.g.
  // selecting a different node/connector while the panel is open).
  useEffect(() => {
    setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        data-testid={testId}
        className="h-9 w-20 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next === '') {
            onChange(undefined);
            return;
          }
          const n = Number.parseInt(next, 10);
          if (!Number.isFinite(n) || n < min || n > max) {
            onChange(undefined);
            return;
          }
          onChange(n);
        }}
      />
    </div>
  );
}

function ConnectorStyleTab({
  connector,
  onApply,
  onDelete,
}: {
  connector: Connector;
  onApply: (patch: ConnectorStylePatch) => void;
  onDelete?: () => void;
}) {
  const colorActive = (connector.color ?? 'default') as ColorToken;
  const styleActive = (connector.style ?? 'auto') as ConnectorStyle | 'auto';
  const directionActive = (connector.direction ?? 'forward') as ConnectorDirection;
  return (
    <div className="flex flex-col gap-4">
      <SwatchPicker
        label="Color"
        active={colorActive}
        onSelect={(token) => onApply({ color: token })}
        triggerTestId="style-tab-edge-color-trigger"
        tokenTestIdPrefix="style-tab-color"
        previewKind="edge"
      />

      <SizeInput
        label="Stroke width"
        testId="style-tab-edge-size"
        value={connector.borderSize}
        onChange={(n) => onApply({ borderSize: n })}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
          Border style
        </span>
        <select
          data-testid="style-tab-edge-style"
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={styleActive}
          onChange={(e) => {
            const v = e.target.value as ConnectorStyle | 'auto';
            // 'Auto' clears the explicit style override so the edge falls back
            // to the kind-derived default (per US-017 connectorToEdge logic).
            onApply({ style: v === 'auto' ? undefined : v });
          }}
        >
          <option value="auto">Auto ({connector.kind})</option>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
          Direction
        </span>
        <DirectionToggle active={directionActive} onSelect={(d) => onApply({ direction: d })} />
      </div>

      <DeleteButton onDelete={onDelete} entity="connector" />
    </div>
  );
}

type SwatchPreviewKind = 'border' | 'background' | 'edge';

function swatchPreviewStyle(token: ColorToken, kind: SwatchPreviewKind) {
  const palette = COLOR_TOKENS[token];
  // Each preview kind picks the most readable face of the token:
  //   • border    → ring of the border color over a card-tinted disc
  //   • background → solid disc of the background color
  //   • edge      → solid disc of the edge stroke color
  if (kind === 'background')
    return { backgroundColor: palette.background, borderColor: palette.border };
  if (kind === 'edge') return { backgroundColor: palette.edge, borderColor: palette.edge };
  return { borderColor: palette.border, backgroundColor: palette.background };
}

// Trigger swatch is borderless — we want a single solid disc that reads as
// "this is the active color" at a glance. Picks the user-visible face per kind:
//   • border     → the border color (what they'd see as the node's ring)
//   • background → the background fill
//   • edge       → the edge stroke color
function swatchTriggerFillStyle(token: ColorToken, kind: SwatchPreviewKind) {
  const palette = COLOR_TOKENS[token];
  if (kind === 'background') return { backgroundColor: palette.background };
  if (kind === 'edge') return { backgroundColor: palette.edge };
  return { backgroundColor: palette.border };
}

function SwatchPicker({
  label,
  active,
  onSelect,
  triggerTestId,
  tokenTestIdPrefix,
  previewKind,
}: {
  label: string;
  active: ColorToken;
  onSelect: (token: ColorToken) => void;
  triggerTestId: string;
  tokenTestIdPrefix: string;
  previewKind: SwatchPreviewKind;
}) {
  const [open, setOpen] = useState(false);
  const isUnset = active === 'default';
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={triggerTestId}
            data-active-token={active}
            aria-label={`${label}: ${active}`}
            title={active}
            className={cn(
              'relative h-7 w-7 self-start rounded-full transition-all',
              'hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
            style={swatchTriggerFillStyle(active, previewKind)}
          >
            {isUnset ? (
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
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto p-2"
          data-testid={`${triggerTestId}-popover`}
        >
          <div className="grid grid-cols-4 gap-1.5">
            {PALETTE_TOKENS.map((token) => {
              const isActive = active === token;
              return (
                <button
                  key={token}
                  type="button"
                  onClick={() => {
                    onSelect(token);
                    setOpen(false);
                  }}
                  data-testid={`${tokenTestIdPrefix}-${token}`}
                  data-active={isActive}
                  aria-label={`${label} ${token}`}
                  aria-pressed={isActive}
                  title={token}
                  className={cn(
                    'relative flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all',
                    isActive
                      ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
                      : 'hover:scale-110',
                  )}
                  style={swatchPreviewStyle(token, previewKind)}
                >
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
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DirectionToggle({
  active,
  onSelect,
}: {
  active: ConnectorDirection;
  onSelect: (d: ConnectorDirection) => void;
}) {
  const options: Array<{ value: ConnectorDirection; icon: typeof ArrowRight; label: string }> = [
    { value: 'forward', icon: ArrowRight, label: 'Forward' },
    { value: 'backward', icon: MoveLeft, label: 'Backward' },
    { value: 'both', icon: ArrowLeftRight, label: 'Both' },
  ];
  return (
    <div className="inline-flex gap-0 rounded-md border border-input bg-background p-0.5">
      {options.map(({ value, icon: Icon, label }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            data-testid={`style-tab-direction-${value}`}
            data-active={isActive}
            aria-label={`Direction: ${label}`}
            title={label}
            className={cn(
              'flex h-7 w-9 items-center justify-center rounded transition-colors',
              isActive
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

function DeleteButton({
  onDelete,
  entity,
}: {
  onDelete?: () => void;
  entity: 'node' | 'connector';
}) {
  if (!onDelete) return null;
  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      onClick={onDelete}
      data-testid="style-tab-delete"
      className="mt-2 self-start"
    >
      Delete {entity}
    </Button>
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
