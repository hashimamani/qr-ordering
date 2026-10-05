import { describe, it, expect } from 'vitest';
import { readableBrandInk, contrastWithWhite, parseHex } from './brandInk';

/**
 * The failure this guards against is a receipt whose headings are
 * invisible: a pale brand colour printed as text on white paper. Every
 * case below is checked by measuring real contrast rather than eyeballing
 * the hex.
 */
describe('brand ink on white paper', () => {
  const BRANDS = [
    '#7c3aed', // the current default violet
    '#facc15', // pale yellow -- unreadable raw
    '#a7f3d0', // pale mint
    '#ffffff', // white on white
    '#111827', // already near-black
    '#ff0000',
    '#00ff00',
  ];

  it('always returns something readable on white', () => {
    for (const brand of BRANDS) {
      expect(contrastWithWhite(readableBrandInk(brand))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('leaves an already-dark brand essentially alone', () => {
    expect(readableBrandInk('#111827')).toBe('#111827');
  });

  // The point of darkening rather than substituting grey: it still looks
  // like the brand.
  it('keeps the hue when darkening a pale colour', () => {
    const out = parseHex(readableBrandInk('#facc15'))!;
    expect(out.r).toBeGreaterThan(out.b);
    expect(out.g).toBeGreaterThan(out.b);
  });

  it('falls back to near-black for a missing or malformed colour', () => {
    for (const bad of [null, undefined, '', 'rebeccapurple', '#12345', 'nonsense']) {
      expect(readableBrandInk(bad as never)).toBe('#111827');
    }
  });

  it('accepts a colour with or without the leading hash', () => {
    expect(readableBrandInk('7c3aed')).toBe(readableBrandInk('#7c3aed'));
  });
});
