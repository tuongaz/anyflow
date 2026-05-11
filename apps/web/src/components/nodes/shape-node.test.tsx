import { describe, expect, it } from 'bun:test';
import { SHAPE_CLASS, shapeChromeClass, shapeChromeStyle } from '@/components/nodes/shape-node';
import { COLOR_TOKENS } from '@/lib/color-tokens';

// US-009: the drag-create ghost in demo-canvas.tsx (`canvas-draw-ghost`) MUST
// render with the same chrome as the committed node so the preview is
// WYSIWYG. The ghost reuses these helpers verbatim, so any drift between the
// helper output and the committed node would break the contract — these tests
// pin both halves to the documented values.
describe('shape-node chrome helpers', () => {
  describe('shapeChromeClass', () => {
    it('returns the documented Tailwind chrome string for each shape', () => {
      expect(shapeChromeClass('rectangle')).toBe(SHAPE_CLASS.rectangle);
      expect(shapeChromeClass('ellipse')).toBe(SHAPE_CLASS.ellipse);
      expect(shapeChromeClass('sticky')).toBe(SHAPE_CLASS.sticky);
      expect(shapeChromeClass('text')).toBe(SHAPE_CLASS.text);
    });

    it('keeps sticky-specific tilt + shadow in the class so the ghost matches the placed sticky', () => {
      // The ghost is the only consumer outside ShapeNode that reads this
      // class; if a future change removes the tilt the ghost drops it too,
      // and the WYSIWYG promise breaks unless this test is updated.
      expect(SHAPE_CLASS.sticky).toContain('-rotate-1');
      expect(SHAPE_CLASS.sticky).toContain('shadow-md');
    });
  });

  describe('shapeChromeStyle', () => {
    it('rectangle/ellipse default to theme border + transparent background (no override)', () => {
      const rect = shapeChromeStyle('rectangle');
      expect(rect.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(rect.backgroundColor).toBeUndefined();
      expect(rect.borderWidth).toBeUndefined();
      expect(rect.borderRadius).toBeUndefined();

      const ellipse = shapeChromeStyle('ellipse');
      expect(ellipse.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(ellipse.backgroundColor).toBeUndefined();
    });

    it('sticky defaults to the amber palette (border + background) so the ghost previews yellow, not primary', () => {
      const sticky = shapeChromeStyle('sticky');
      expect(sticky.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(sticky.backgroundColor).toBe(COLOR_TOKENS.amber.background);
    });

    it('text returns an empty style — chromeless on commit', () => {
      // The ghost compensates with a faint dashed outline (added in
      // demo-canvas.tsx); the placed text node still has no chrome.
      expect(shapeChromeStyle('text')).toEqual({});
    });

    it('honours explicit author overrides for color, border size/style, and corner radius', () => {
      const styled = shapeChromeStyle('rectangle', {
        borderColor: 'blue',
        backgroundColor: 'green',
        borderSize: 5,
        borderStyle: 'dashed',
        cornerRadius: 12,
      });
      expect(styled.borderColor).toBe(COLOR_TOKENS.blue.border);
      expect(styled.backgroundColor).toBe(COLOR_TOKENS.green.background);
      expect(styled.borderWidth).toBe(5);
      expect(styled.borderStyle).toBe('dashed');
      expect(styled.borderRadius).toBe(12);
    });

    it('ignores cornerRadius for ellipse (rounded-full owns the shape)', () => {
      const ellipse = shapeChromeStyle('ellipse', { cornerRadius: 20 });
      expect(ellipse.borderRadius).toBeUndefined();
    });

    it('ignores cornerRadius for text (no border to round)', () => {
      const text = shapeChromeStyle('text', { cornerRadius: 8 });
      expect(text).toEqual({});
    });
  });
});
