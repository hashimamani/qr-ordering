import { describe, it, expect } from 'vitest';
import {
  derivePalette,
  contrastWithWhite,
  isValidBrandColor,
  TAB_BRAND_COLOR,
} from './brandPalette';

describe('isValidBrandColor', () => {
  it('accepts 6-digit hex in either case', () => {
    expect(isValidBrandColor('#14b8a6')).toBe(true);
    expect(isValidBrandColor('#7C3AED')).toBe(true);
  });

  it('rejects shorthand, missing hash, and non-hex', () => {
    expect(isValidBrandColor('#fff')).toBe(false);
    expect(isValidBrandColor('14b8a6')).toBe(false);
    expect(isValidBrandColor('#zzzzzz')).toBe(false);
    expect(isValidBrandColor('red')).toBe(false);
  });
});

describe('derivePalette', () => {
  it('uses the supplied colour as the 500 stop verbatim', () => {
    expect(derivePalette('#7C3AED')[500]).toBe('#7c3aed');
  });

  it('returns all seven stops styles.css references', () => {
    const p = derivePalette(TAB_BRAND_COLOR);
    for (const stop of [50, 100, 200, 500, 600, 700, 800] as const) {
      expect(p[stop]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('orders the scale light to dark', () => {
    const p = derivePalette('#7C3AED');
    // Contrast against white rises monotonically as the stops darken.
    expect(contrastWithWhite(p[50])).toBeLessThan(contrastWithWhite(p[200]));
    expect(contrastWithWhite(p[200])).toBeLessThan(contrastWithWhite(p[600]));
    expect(contrastWithWhite(p[600])).toBeLessThan(contrastWithWhite(p[700]));
    expect(contrastWithWhite(p[700])).toBeLessThan(contrastWithWhite(p[800]));
  });

  it('reproduces roughly the existing Tab teal scale', () => {
    const p = derivePalette(TAB_BRAND_COLOR);
    // Not exact -- the originals are Tailwind's hand-tuned teal -- but the
    // light end must stay near-white and the dark end near the original.
    expect(contrastWithWhite(p[50])).toBeLessThan(1.2);
    expect(contrastWithWhite(p[700])).toBeGreaterThan(4.5);
  });

  // The reason the dark stops use absolute lightness targets instead of
  // ratios of the input: every one of these accents must still yield a
  // 600/700/800 that white text is readable on.
  it.each([
    ['pale yellow', '#fef08a'],
    ['near-white', '#fafafa'],
    ['vivid lime', '#a3e635'],
    ['hot pink', '#ec4899'],
    ['near-black', '#0a0a0a'],
    ['mid grey', '#808080'],
    ['saturated cyan', '#06b6d4'],
  ])('keeps white text readable on 700 and 800 for %s', (_label, hex) => {
    const p = derivePalette(hex);
    expect(contrastWithWhite(p[700])).toBeGreaterThanOrEqual(4.5);
    expect(contrastWithWhite(p[800])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['pale yellow', '#fef08a'],
    ['near-white', '#fafafa'],
    ['near-black', '#0a0a0a'],
  ])('keeps the light stops light enough to read dark text on for %s', (_label, hex) => {
    const p = derivePalette(hex);
    // .station-column and the stat tiles put ink-900 text on these.
    expect(contrastWithWhite(p[50])).toBeLessThan(1.35);
  });

  it('keeps a near-grey accent visibly coloured rather than flat grey', () => {
    const p = derivePalette('#7f7f80');
    // If saturation were left at ~0 every stop would be an identical grey.
    expect(p[200]).not.toBe(p[50]);
    expect(p[700]).not.toBe(p[800]);
  });
});
