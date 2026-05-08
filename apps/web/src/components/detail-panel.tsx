import { JsonTree } from '@/components/json-tree';
import { StatusPill } from '@/components/nodes/status-pill';
import { Button } from '@/components/ui/button';
import { IconToggleGroup, type IconToggleOption } from '@/components/ui/icon-toggle-group';
import {
  LineDashedIcon,
  LineDottedIcon,
  LineSolidIcon,
  PathCurveIcon,
  PathStepIcon,
} from '@/components/ui/line-style-icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNodeDetail } from '@/hooks/use-node-detail';
import type { NodeEventLogEntry } from '@/hooks/use-node-events';
import type { NodeRunState } from '@/hooks/use-node-runs';
import type {
  ColorToken,
  Connector,
  ConnectorDirection,
  ConnectorPath,
  ConnectorStyle,
  DemoNode,
} from '@/lib/api';
import { COLOR_TOKENS } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { ArrowLeftRight, ArrowRight, Check, MoveLeft, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

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
  path?: ConnectorPath;
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
  /** Live preview during a slider drag — optimistic override only, no PATCH/undo. */
  onStyleNodePreview?: (nodeId: string, patch: NodeStylePatch) => void;
  /** Apply a Style-tab edit to the selected connector (color / style / direction). */
  onStyleConnector?: (connId: string, patch: ConnectorStylePatch) => void;
  /** Live preview during a slider drag — optimistic override only, no PATCH/undo. */
  onStyleConnectorPreview?: (connId: string, patch: ConnectorStylePatch) => void;
  /** Delete the selected node (cascade-removes adjacent connectors server-side). */
  onDeleteNode?: (nodeId: string) => void;
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
  onStyleNodePreview,
  onStyleConnector,
  onStyleConnectorPreview,
  onDeleteNode,
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
          // Same treatment for connectors: clicking another edge swaps the
          // selection, and grabbing the selected edge's endpoint to drag
          // (.react-flow__edgeupdater) starts a reconnect gesture. Neither
          // should close the panel.
          if (target?.closest('.react-flow__edge')) e.preventDefault();
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
                <NodeStyleTab
                  node={node}
                  onApply={(patch) => onStyleNode?.(node.id, patch)}
                  onPreview={
                    onStyleNodePreview ? (patch) => onStyleNodePreview(node.id, patch) : undefined
                  }
                />
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
                  onPreview={
                    onStyleConnectorPreview
                      ? (patch) => onStyleConnectorPreview(connector.id, patch)
                      : undefined
                  }
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
  onPreview,
}: {
  node: DemoNode;
  onApply: (patch: NodeStylePatch) => void;
  onPreview?: (patch: NodeStylePatch) => void;
}) {
  const borderActive = (node.data.borderColor ?? 'default') as ColorToken;
  const backgroundActive = (node.data.backgroundColor ?? 'default') as ColorToken;
  const borderStyleActive = (node.data.borderStyle ?? 'solid') as 'solid' | 'dashed' | 'dotted';
  // Text shapes are chromeless — no border, no background. The `borderColor`
  // field is repurposed as the text color for these shapes (see
  // shape-node.tsx) so the same control is exposed but relabeled.
  const isTextShape = node.type === 'shapeNode' && node.data.shape === 'text';
  return (
    <div className="flex flex-col gap-3">
      {isTextShape ? (
        <StyleRow label="Color">
          <SwatchPicker
            label="color"
            active={borderActive}
            onSelect={(token) => onApply({ borderColor: token })}
            triggerTestId="style-tab-color-trigger"
            tokenTestIdPrefix="style-tab-color"
            previewKind="edge"
          />
        </StyleRow>
      ) : (
        <>
          <StyleRow label="Border">
            <SwatchPicker
              label="border"
              active={borderActive}
              onSelect={(token) => onApply({ borderColor: token })}
              triggerTestId="style-tab-border-color-trigger"
              tokenTestIdPrefix="style-tab-border-color"
              previewKind="border"
            />
          </StyleRow>
          <StyleRow label="Style">
            <IconToggleGroup<'solid' | 'dashed' | 'dotted'>
              ariaLabel="Border style"
              value={borderStyleActive}
              onChange={(s) => onApply({ borderStyle: s })}
              options={BORDER_STYLE_OPTIONS}
            />
          </StyleRow>
          <StyleRow label="Width">
            <SliderControl
              value={node.data.borderSize}
              defaultValue={DEFAULT_BORDER_SIZE}
              min={1}
              max={8}
              suffix="px"
              onPreview={onPreview ? (n) => onPreview({ borderSize: n }) : undefined}
              onCommit={(n) => onApply({ borderSize: n })}
              testId="style-tab-border-size-slider"
            />
          </StyleRow>
          <StyleRow label="Background">
            <SwatchPicker
              label="background"
              active={backgroundActive}
              onSelect={(token) => onApply({ backgroundColor: token })}
              triggerTestId="style-tab-background-color-trigger"
              tokenTestIdPrefix="style-tab-background-color"
              previewKind="background"
            />
          </StyleRow>
          <StyleSeparator />
        </>
      )}
      <StyleRow label="Font size">
        <SliderControl
          value={node.data.fontSize}
          defaultValue={NODE_FONT_SIZE_DEFAULT}
          min={10}
          max={32}
          suffix="px"
          onPreview={onPreview ? (n) => onPreview({ fontSize: n }) : undefined}
          onCommit={(n) => onApply({ fontSize: n })}
          testId="style-tab-font-size-slider"
        />
      </StyleRow>
    </div>
  );
}

// Implicit body font size baked into shape-node.tsx (line 63 / 104). Mirrored
// here so the Style-tab font slider has a meaningful default position when
// the user has not set a per-node override.
const NODE_FONT_SIZE_DEFAULT = 22;
const DEFAULT_BORDER_SIZE = 3;

const BORDER_STYLE_OPTIONS: IconToggleOption<'solid' | 'dashed' | 'dotted'>[] = [
  { value: 'solid', icon: LineSolidIcon, label: 'Solid', testId: 'style-tab-border-style-solid' },
  {
    value: 'dashed',
    icon: LineDashedIcon,
    label: 'Dashed',
    testId: 'style-tab-border-style-dashed',
  },
  {
    value: 'dotted',
    icon: LineDottedIcon,
    label: 'Dotted',
    testId: 'style-tab-border-style-dotted',
  },
];

// Single-row style control: label on the left, control on the right. Keeps
// the inspector readable at panel widths down to ~280px without breaking the
// "every option on its own line" rule.
function StyleRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-1 items-center justify-end gap-2 min-w-0">{children}</div>
    </div>
  );
}

function StyleSeparator() {
  return <hr aria-hidden className="border-border/60" />;
}

// Slider with a live numeric badge to the right. Two callbacks:
// - `onPreview` fires on every drag tick so the canvas updates live (it
//   should only update the optimistic override — no PATCH, no undo push).
// - `onCommit` fires once on pointer release for persistence (PATCH + undo).
// Sync local state when the upstream value changes from elsewhere (e.g.
// selecting a different node while the panel is open).
function SliderControl({
  value,
  defaultValue,
  min,
  max,
  suffix,
  onPreview,
  onCommit,
  testId,
}: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  suffix?: string;
  onPreview?: (n: number) => void;
  onCommit: (n: number) => void;
  testId: string;
}) {
  const upstream = value ?? defaultValue;
  const [local, setLocal] = useState<number>(upstream);
  useEffect(() => {
    setLocal(upstream);
  }, [upstream]);
  return (
    <>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[local]}
        onValueChange={([v]) => {
          const next = v ?? min;
          setLocal(next);
          onPreview?.(next);
        }}
        onValueCommit={([v]) => onCommit(v ?? min)}
        data-testid={testId}
        className="flex-1"
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {local}
        {suffix}
      </span>
    </>
  );
}

function ConnectorStyleTab({
  connector,
  onApply,
  onPreview,
}: {
  connector: Connector;
  onApply: (patch: ConnectorStylePatch) => void;
  onPreview?: (patch: ConnectorStylePatch) => void;
}) {
  const colorActive = (connector.color ?? 'default') as ColorToken;
  // The connector style is a tri-value enum, but we also support an "auto"
  // state where the kind-derived default applies. The icon-toggle group can
  // only show the three real values, so the Auto state is surfaced as a
  // separate reset link (rendered only when an override is present).
  const styleActive = connector.style;
  const directionActive = (connector.direction ?? 'forward') as ConnectorDirection;
  const pathActive = (connector.path ?? 'curve') as ConnectorPath;
  return (
    <div className="flex flex-col gap-3">
      <StyleRow label="Color">
        <SwatchPicker
          label="color"
          active={colorActive}
          onSelect={(token) => onApply({ color: token })}
          triggerTestId="style-tab-edge-color-trigger"
          tokenTestIdPrefix="style-tab-color"
          previewKind="edge"
        />
      </StyleRow>
      <StyleRow label="Width">
        <SliderControl
          value={connector.borderSize}
          defaultValue={DEFAULT_STROKE_WIDTH}
          min={1}
          max={8}
          suffix="px"
          onPreview={onPreview ? (n) => onPreview({ borderSize: n }) : undefined}
          onCommit={(n) => onApply({ borderSize: n })}
          testId="style-tab-stroke-width-slider"
        />
      </StyleRow>
      <StyleRow label="Style">
        <IconToggleGroup<ConnectorStyle>
          ariaLabel="Connector style"
          value={(styleActive ?? KIND_DEFAULT_STYLE[connector.kind]) as ConnectorStyle}
          onChange={(s) => onApply({ style: s })}
          options={CONNECTOR_STYLE_OPTIONS}
        />
      </StyleRow>
      <StyleRow label="Path">
        <IconToggleGroup<ConnectorPath>
          ariaLabel="Connector path"
          value={pathActive}
          onChange={(p) => onApply({ path: p })}
          options={PATH_OPTIONS}
        />
      </StyleRow>
      <StyleRow label="Direction">
        <IconToggleGroup<ConnectorDirection>
          ariaLabel="Connector direction"
          value={directionActive}
          onChange={(d) => onApply({ direction: d })}
          options={DIRECTION_OPTIONS}
        />
      </StyleRow>
    </div>
  );
}

const DEFAULT_STROKE_WIDTH = 2;

// Mirrors connector-to-edge.ts STYLE_BY_KIND so the "Auto" highlight on the
// border-style toggle visually matches the rendered edge before the user has
// set an explicit override.
const KIND_DEFAULT_STYLE: Record<Connector['kind'], ConnectorStyle> = {
  http: 'solid',
  event: 'dashed',
  queue: 'dotted',
  default: 'solid',
};

const CONNECTOR_STYLE_OPTIONS: IconToggleOption<ConnectorStyle>[] = [
  { value: 'solid', icon: LineSolidIcon, label: 'Solid', testId: 'style-tab-edge-style-solid' },
  { value: 'dashed', icon: LineDashedIcon, label: 'Dashed', testId: 'style-tab-edge-style-dashed' },
  { value: 'dotted', icon: LineDottedIcon, label: 'Dotted', testId: 'style-tab-edge-style-dotted' },
];

const PATH_OPTIONS: IconToggleOption<ConnectorPath>[] = [
  { value: 'curve', icon: PathCurveIcon, label: 'Curve', testId: 'style-tab-edge-path-curve' },
  { value: 'step', icon: PathStepIcon, label: 'Zigzag', testId: 'style-tab-edge-path-step' },
];

const DIRECTION_OPTIONS: IconToggleOption<ConnectorDirection>[] = [
  { value: 'backward', icon: MoveLeft, label: 'Backward', testId: 'style-tab-direction-backward' },
  { value: 'forward', icon: ArrowRight, label: 'Forward', testId: 'style-tab-direction-forward' },
  { value: 'both', icon: ArrowLeftRight, label: 'Both', testId: 'style-tab-direction-both' },
];

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
  // The `label` prop is consumed only by the trigger's aria-label / title now —
  // StyleRow renders the visible label, so the picker is just the swatch.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={triggerTestId}
          data-active-token={active}
          aria-label={`${label}: ${active}`}
          title={active}
          // ring-1 ring-border (US-003) gives the swatch an always-visible
          // outline so it reads as a clickable control rather than a flat
          // color block — important for the 'default' token where the
          // diagonal-stripe pattern can blend into surrounding chrome.
          className={cn(
            'relative h-7 w-7 rounded-full ring-1 ring-border transition-all',
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
      <PopoverContent align="start" className="w-auto p-2" data-testid={`${triggerTestId}-popover`}>
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
