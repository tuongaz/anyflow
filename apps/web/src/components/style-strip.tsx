import { IconToggleGroup, type IconToggleOption } from '@/components/ui/icon-toggle-group';
import {
  LineDashedIcon,
  LineDottedIcon,
  LineSolidIcon,
  PathCurveIcon,
  PathStepIcon,
} from '@/components/ui/line-style-icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { ArrowLeftRight, ArrowRight, Check, MoveLeft, Squircle, Type } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

export interface NodeStylePatch {
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  cornerRadius?: number;
}

export interface ConnectorStylePatch {
  color?: ColorToken;
  style?: ConnectorStyle;
  direction?: ConnectorDirection;
  borderSize?: number;
  path?: ConnectorPath;
}

export interface StyleStripProps {
  /** Currently selected nodes (with optimistic overrides applied). */
  nodes: DemoNode[];
  /** Currently selected connectors (with optimistic overrides applied). */
  connectors: Connector[];
  onStyleNode: (nodeId: string, patch: NodeStylePatch) => void;
  onStyleNodePreview?: (nodeId: string, patch: NodeStylePatch) => void;
  /**
   * US-008: atomic multi-node apply. When present and a multi-node selection is
   * active, the strip routes the user's pick through this single call so the
   * caller can commit the batch as one undo-stack entry. Falls back to a
   * per-node loop over `onStyleNode` when omitted (legacy behaviour).
   */
  onStyleNodes?: (nodeIds: string[], patch: NodeStylePatch) => void;
  /** US-008: atomic multi-node live preview during a slider drag. */
  onStyleNodesPreview?: (nodeIds: string[], patch: NodeStylePatch) => void;
  onStyleConnector: (connId: string, patch: ConnectorStylePatch) => void;
  onStyleConnectorPreview?: (connId: string, patch: ConnectorStylePatch) => void;
}

// Mirror detail-panel.tsx defaults so slider start positions stay consistent.
const NODE_FONT_SIZE_DEFAULT = 22;
const DEFAULT_BORDER_SIZE = 3;
const DEFAULT_STROKE_WIDTH = 2;
// US-005: opt-in default for the Corners slider when a node has no
// `cornerRadius` set yet — picked to feel like a soft rounded-rect rather
// than the harsher 0px the schema would imply.
const DEFAULT_CORNER_RADIUS = 8;

// Mirrors connector-to-edge.ts STYLE_BY_KIND so the active highlight matches
// the rendered edge before the user has set an explicit override.
const KIND_DEFAULT_STYLE: Record<Connector['kind'], ConnectorStyle> = {
  http: 'solid',
  event: 'dashed',
  queue: 'dotted',
  default: 'solid',
};

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

export function StyleStrip({
  nodes,
  connectors,
  onStyleNode,
  onStyleNodePreview,
  onStyleNodes,
  onStyleNodesPreview,
  onStyleConnector,
  onStyleConnectorPreview,
}: StyleStripProps) {
  const hasNodes = nodes.length > 0;
  const hasConnectors = connectors.length > 0;
  if (!hasNodes && !hasConnectors) return null;

  const pureNode = hasNodes && !hasConnectors;
  const pureConnector = !hasNodes && hasConnectors;

  // Single-item helpers — for previewing the active state on each strip
  // trigger. Multi-item selections (US-019) collapse to the first item's
  // value; the value is purely cosmetic for the trigger swatch/icon.
  const firstNode = nodes[0];
  const firstConnector = connectors[0];
  // Text-shape simplification only applies to pure-node selections of a single
  // text shape. Mixed selections (text-shape node + connector) still need the
  // shared border controls visible, so the guard is gated on `pureNode`.
  const isTextShape =
    pureNode && firstNode?.type === 'shapeNode' && firstNode.data.shape === 'text';

  // Resolve current visual state. For pure-connector selections, the
  // border-color trigger reflects the connector's color; for pure-node
  // selections, the node's borderColor.
  const borderColorActive: ColorToken =
    (pureConnector ? firstConnector?.color : firstNode?.data.borderColor) ?? 'default';
  const backgroundActive: ColorToken = firstNode?.data.backgroundColor ?? 'default';
  const borderStyleActiveNode = (firstNode?.data.borderStyle ?? 'solid') as
    | 'solid'
    | 'dashed'
    | 'dotted';
  const connectorStyleActive: ConnectorStyle = firstConnector
    ? (firstConnector.style ?? KIND_DEFAULT_STYLE[firstConnector.kind])
    : 'solid';
  const directionActive = (firstConnector?.direction ?? 'forward') as ConnectorDirection;
  const pathActive = (firstConnector?.path ?? 'curve') as ConnectorPath;

  // Apply helpers — fan out a single user pick to every selected entity.
  // For "shared" properties on mixed selections, both fan-outs run.
  const applyBorderColor = (token: ColorToken) => {
    for (const n of nodes) onStyleNode(n.id, { borderColor: token });
    for (const c of connectors) onStyleConnector(c.id, { color: token });
  };
  const applyBackgroundColor = (token: ColorToken) => {
    for (const n of nodes) onStyleNode(n.id, { backgroundColor: token });
  };
  const applyBorderStyle = (style: 'solid' | 'dashed' | 'dotted') => {
    for (const n of nodes) onStyleNode(n.id, { borderStyle: style });
    for (const c of connectors) onStyleConnector(c.id, { style });
  };
  const applyBorderSize = (n: number) => {
    for (const node of nodes) onStyleNode(node.id, { borderSize: n });
    for (const c of connectors) onStyleConnector(c.id, { borderSize: n });
  };
  const previewBorderSize = (n: number) => {
    for (const node of nodes) onStyleNodePreview?.(node.id, { borderSize: n });
    for (const c of connectors) onStyleConnectorPreview?.(c.id, { borderSize: n });
  };
  // US-008: prefer the atomic batch API for multi-node selections so the apply
  // commits as a single undo-stack entry. Single-node selections still go
  // through the per-node API (behaviour unchanged).
  const applyFontSize = (n: number) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((node) => node.id),
        { fontSize: n },
      );
    } else {
      for (const node of nodes) onStyleNode(node.id, { fontSize: n });
    }
  };
  const previewFontSize = (n: number) => {
    if (nodes.length > 1 && onStyleNodesPreview) {
      onStyleNodesPreview(
        nodes.map((node) => node.id),
        { fontSize: n },
      );
    } else {
      for (const node of nodes) onStyleNodePreview?.(node.id, { fontSize: n });
    }
  };
  // US-008: detect mixed font sizes across the selection so the slider can
  // render an indeterminate placeholder until the user picks a value. Treat
  // unset (undefined) as the default so a node with explicit 22 and one
  // without are considered equal.
  const fontSizeIndeterminate =
    nodes.length > 1 &&
    new Set(nodes.map((n) => n.data.fontSize ?? NODE_FONT_SIZE_DEFAULT)).size > 1;
  // US-005: corner-radius apply/preview. Mirrors the borderSize fan-out
  // (per-node loop) so multi-select drags update every selected node and
  // the live preview surfaces optimistic overrides during the drag.
  const applyCornerRadius = (n: number) => {
    for (const node of nodes) onStyleNode(node.id, { cornerRadius: n });
  };
  const previewCornerRadius = (n: number) => {
    for (const node of nodes) onStyleNodePreview?.(node.id, { cornerRadius: n });
  };
  const cornerRadiusIndeterminate =
    nodes.length > 1 &&
    new Set(nodes.map((n) => n.data.cornerRadius ?? DEFAULT_CORNER_RADIUS)).size > 1;
  const applyConnectorPath = (path: ConnectorPath) => {
    for (const c of connectors) onStyleConnector(c.id, { path });
  };
  const applyConnectorDirection = (direction: ConnectorDirection) => {
    for (const c of connectors) onStyleConnector(c.id, { direction });
  };

  // Width slider source value: connector borderSize for pure-connector,
  // node borderSize otherwise (mixed selections fall back to the node's
  // value since "border width" applies to both).
  const widthCurrent = pureConnector
    ? (firstConnector?.borderSize ?? DEFAULT_STROKE_WIDTH)
    : (firstNode?.data.borderSize ?? DEFAULT_BORDER_SIZE);
  const widthDefault = pureConnector ? DEFAULT_STROKE_WIDTH : DEFAULT_BORDER_SIZE;

  const colorTriggerKind: SwatchPreviewKind = pureConnector ? 'edge' : 'border';
  const colorTooltip = pureConnector ? 'Connector color' : isTextShape ? 'Color' : 'Border color';
  const colorAriaLabel = pureConnector ? 'connector color' : isTextShape ? 'color' : 'border color';
  const colorInnerTestId = pureConnector
    ? 'style-tab-edge-color-trigger'
    : isTextShape
      ? 'style-tab-color-trigger'
      : 'style-tab-border-color-trigger';
  const colorTokenPrefix =
    pureConnector || isTextShape ? 'style-tab-color' : 'style-tab-border-color';

  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-testid="canvas-style-strip"
        className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur"
      >
        <SwatchButton
          testId="style-strip-border-color"
          tooltip={colorTooltip}
          ariaLabel={colorAriaLabel}
          activeToken={borderColorActive}
          previewKind={colorTriggerKind}
          tokenTestIdPrefix={colorTokenPrefix}
          innerTestId={colorInnerTestId}
          onSelect={applyBorderColor}
        />

        {pureNode && !isTextShape ? (
          <SwatchButton
            testId="style-strip-fill"
            tooltip="Fill"
            ariaLabel="fill"
            activeToken={backgroundActive}
            previewKind="background"
            tokenTestIdPrefix="style-tab-background-color"
            innerTestId="style-tab-background-color-trigger"
            onSelect={applyBackgroundColor}
          />
        ) : null}

        {!isTextShape ? (
          <PopoverButton
            testId="style-strip-border-style"
            tooltip={pureConnector ? 'Connector style' : 'Border style'}
            ariaLabel={pureConnector ? 'connector style' : 'border style'}
            renderIcon={() => {
              const Icon =
                (pureConnector
                  ? CONNECTOR_STYLE_OPTIONS.find((o) => o.value === connectorStyleActive)?.icon
                  : BORDER_STYLE_OPTIONS.find((o) => o.value === borderStyleActiveNode)?.icon) ??
                LineSolidIcon;
              return <Icon className="h-4 w-4" />;
            }}
          >
            {pureConnector ? (
              <IconToggleGroup<ConnectorStyle>
                ariaLabel="Connector style"
                value={connectorStyleActive}
                onChange={(s) => applyBorderStyle(s)}
                options={CONNECTOR_STYLE_OPTIONS}
              />
            ) : (
              <IconToggleGroup<'solid' | 'dashed' | 'dotted'>
                ariaLabel="Border style"
                value={borderStyleActiveNode}
                onChange={(s) => applyBorderStyle(s)}
                options={BORDER_STYLE_OPTIONS}
              />
            )}
          </PopoverButton>
        ) : null}

        {!isTextShape ? (
          <PopoverButton
            testId="style-strip-border-size"
            tooltip={pureConnector ? 'Connector width' : 'Border width'}
            ariaLabel={pureConnector ? 'connector width' : 'border width'}
            renderIcon={() => (
              <span className="font-mono text-[10px] tabular-nums">{widthCurrent}</span>
            )}
          >
            <SliderControl
              value={widthCurrent}
              defaultValue={widthDefault}
              min={1}
              max={8}
              suffix="px"
              onPreview={previewBorderSize}
              onCommit={applyBorderSize}
              testId={
                pureConnector ? 'style-tab-stroke-width-slider' : 'style-tab-border-size-slider'
              }
            />
          </PopoverButton>
        ) : null}

        {pureNode ? (
          <PopoverButton
            testId="style-strip-font-size"
            tooltip="Font size"
            ariaLabel="font size"
            renderIcon={() => <Type className="h-4 w-4" />}
          >
            <SliderControl
              value={firstNode?.data.fontSize}
              defaultValue={NODE_FONT_SIZE_DEFAULT}
              min={10}
              max={32}
              suffix="px"
              indeterminate={fontSizeIndeterminate}
              onPreview={previewFontSize}
              onCommit={applyFontSize}
              testId="style-tab-font-size-slider"
            />
          </PopoverButton>
        ) : null}

        {hasNodes && !isTextShape ? (
          <PopoverButton
            testId="style-strip-corner-radius"
            tooltip="Corners"
            ariaLabel="corner radius"
            renderIcon={() => <Squircle className="h-4 w-4" />}
          >
            <SliderControl
              value={firstNode?.data.cornerRadius}
              defaultValue={DEFAULT_CORNER_RADIUS}
              min={0}
              max={32}
              suffix="px"
              indeterminate={cornerRadiusIndeterminate}
              onPreview={previewCornerRadius}
              onCommit={applyCornerRadius}
              testId="style-tab-corner-radius-slider"
            />
          </PopoverButton>
        ) : null}

        {pureConnector ? (
          <PopoverButton
            testId="style-strip-path"
            tooltip="Connector path"
            ariaLabel="connector path"
            renderIcon={() => {
              const Icon = PATH_OPTIONS.find((o) => o.value === pathActive)?.icon ?? PathCurveIcon;
              return <Icon className="h-4 w-4" />;
            }}
          >
            <IconToggleGroup<ConnectorPath>
              ariaLabel="Connector path"
              value={pathActive}
              onChange={applyConnectorPath}
              options={PATH_OPTIONS}
            />
          </PopoverButton>
        ) : null}

        {pureConnector ? (
          <PopoverButton
            testId="style-strip-direction"
            tooltip="Direction"
            ariaLabel="direction"
            renderIcon={() => {
              const Icon =
                DIRECTION_OPTIONS.find((o) => o.value === directionActive)?.icon ?? ArrowRight;
              return <Icon className="h-4 w-4" />;
            }}
          >
            <IconToggleGroup<ConnectorDirection>
              ariaLabel="Connector direction"
              value={directionActive}
              onChange={applyConnectorDirection}
              options={DIRECTION_OPTIONS}
            />
          </PopoverButton>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

type SwatchPreviewKind = 'border' | 'background' | 'edge';

function swatchPreviewStyle(token: ColorToken, kind: SwatchPreviewKind) {
  const palette = COLOR_TOKENS[token];
  if (kind === 'background')
    return { backgroundColor: palette.background, borderColor: palette.border };
  if (kind === 'edge') return { backgroundColor: palette.edge, borderColor: palette.edge };
  return { borderColor: palette.border, backgroundColor: palette.background };
}

function swatchTriggerFillStyle(token: ColorToken, kind: SwatchPreviewKind) {
  const palette = COLOR_TOKENS[token];
  if (kind === 'background') return { backgroundColor: palette.background };
  if (kind === 'edge') return { backgroundColor: palette.edge };
  return { backgroundColor: palette.border };
}

// One strip button that opens a swatch palette in a popover. Mirrors the
// SwatchPicker in detail-panel.tsx but with the strip-friendly h-8 w-8 chrome
// and a right-side tooltip / popover anchor (the strip is a left-edge column).
function SwatchButton({
  testId,
  tooltip,
  ariaLabel,
  activeToken,
  previewKind,
  tokenTestIdPrefix,
  innerTestId,
  onSelect,
}: {
  testId: string;
  tooltip: string;
  ariaLabel: string;
  activeToken: ColorToken;
  previewKind: SwatchPreviewKind;
  tokenTestIdPrefix: string;
  innerTestId: string;
  onSelect: (token: ColorToken) => void;
}) {
  const [open, setOpen] = useState(false);
  const isUnset = activeToken === 'default';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid={testId}
              data-active-token={activeToken}
              aria-label={`${ariaLabel}: ${activeToken}`}
              title={tooltip}
              className={cn(
                'group relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              )}
            >
              {/*
                Inner test id mirrors the previous panel's swatch trigger so
                older Playwright snapshots that target it still resolve.
              */}
              <span
                data-testid={innerTestId}
                className="relative h-5 w-5 rounded-full ring-1 ring-border"
                style={swatchTriggerFillStyle(activeToken, previewKind)}
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
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" className="px-2 py-1 text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        className="w-auto p-2"
        data-testid={`${innerTestId}-popover`}
      >
        <div className="grid grid-cols-4 gap-1.5">
          {PALETTE_TOKENS.map((token) => {
            const isActive = activeToken === token;
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
                aria-label={`${ariaLabel} ${token}`}
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

// Generic icon button that opens a popover containing the full picker control.
function PopoverButton({
  testId,
  tooltip,
  ariaLabel,
  renderIcon,
  children,
}: {
  testId: string;
  tooltip: string;
  ariaLabel: string;
  renderIcon: () => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid={testId}
              aria-label={ariaLabel}
              title={tooltip}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              )}
            >
              {renderIcon()}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" className="px-2 py-1 text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="start" className="w-auto p-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// Mirrors detail-panel.tsx SliderControl so the strip's slider behaves
// identically (live optimistic preview + commit on release). Same testIds on
// the slider element so older Playwright snapshots keep working.
//
// US-008: when `indeterminate` is true (mixed values across a multi-node
// selection), the readout shows "Mixed" until the user moves the slider, at
// which point the slider transitions to determinate and fans out the picked
// value to every selected node.
function SliderControl({
  value,
  defaultValue,
  min,
  max,
  suffix,
  indeterminate,
  onPreview,
  onCommit,
  testId,
}: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  suffix?: string;
  indeterminate?: boolean;
  onPreview?: (n: number) => void;
  onCommit: (n: number) => void;
  testId: string;
}) {
  const upstream = value ?? defaultValue;
  const [local, setLocal] = useState<number>(upstream);
  // Tracks whether the user has touched the slider in the current open cycle.
  // Indeterminate mode resets this back to false when the upstream selection
  // changes (different mixed set → re-show the placeholder).
  const [picked, setPicked] = useState<boolean>(false);
  useEffect(() => {
    setLocal(upstream);
    setPicked(false);
  }, [upstream]);
  const showPlaceholder = indeterminate && !picked;
  return (
    <div className="flex w-48 items-center gap-3">
      <Slider
        min={min}
        max={max}
        step={1}
        value={[local]}
        onValueChange={([v]) => {
          const next = v ?? min;
          setLocal(next);
          setPicked(true);
          onPreview?.(next);
        }}
        onValueCommit={([v]) => onCommit(v ?? min)}
        data-testid={testId}
        data-indeterminate={showPlaceholder ? 'true' : undefined}
        className={cn('flex-1', showPlaceholder && 'opacity-60')}
      />
      <span
        data-testid={`${testId}-value`}
        className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
      >
        {showPlaceholder ? (
          'Mixed'
        ) : (
          <>
            {local}
            {suffix}
          </>
        )}
      </span>
    </div>
  );
}
