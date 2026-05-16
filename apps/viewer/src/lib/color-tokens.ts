import type { CSSProperties } from 'react';
import type { ColorToken } from '../types';

const COLOR_MAP: Record<ColorToken, { border: string; background: string; edge: string }> = {
  default: {
    border: 'hsl(214.3, 31.8%, 91.4%)',
    background: '#ffffff',
    edge: 'hsl(215.4, 16.3%, 46.9%)',
  },
  slate: {
    border: 'hsl(215, 20%, 65%)',
    background: 'hsl(210, 40%, 96%)',
    edge: 'hsl(215, 16%, 47%)',
  },
  blue: {
    border: 'hsl(213, 94%, 68%)',
    background: 'hsl(214, 100%, 97%)',
    edge: 'hsl(217, 91%, 60%)',
  },
  green: {
    border: 'hsl(142, 69%, 58%)',
    background: 'hsl(138, 76%, 97%)',
    edge: 'hsl(142, 71%, 45%)',
  },
  amber: {
    border: 'hsl(43, 96%, 56%)',
    background: 'hsl(48, 100%, 96%)',
    edge: 'hsl(38, 92%, 50%)',
  },
  red: {
    border: 'hsl(0, 91%, 71%)',
    background: 'hsl(0, 86%, 97%)',
    edge: 'hsl(0, 84%, 60%)',
  },
  purple: {
    border: 'hsl(270, 95%, 75%)',
    background: 'hsl(270, 100%, 98%)',
    edge: 'hsl(271, 91%, 65%)',
  },
  pink: {
    border: 'hsl(330, 81%, 75%)',
    background: 'hsl(327, 73%, 97%)',
    edge: 'hsl(330, 81%, 60%)',
  },
};

export const NODE_DEFAULT_BG_WHITE = '#ffffff';

export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node',
): Pick<CSSProperties, 'borderColor' | 'backgroundColor'>;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'edge',
): Pick<CSSProperties, 'stroke'>;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'text',
): Pick<CSSProperties, 'color'>;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node' | 'edge' | 'text',
): CSSProperties {
  const resolved = token ?? 'default';
  const entry = COLOR_MAP[resolved];
  if (kind === 'edge') return { stroke: entry.edge };
  if (kind === 'text') return resolved === 'default' ? {} : { color: entry.edge };
  return { borderColor: entry.border, backgroundColor: entry.background };
}
