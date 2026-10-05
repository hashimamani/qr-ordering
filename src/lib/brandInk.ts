/**
 * Darkens a restaurant's brand colour until it is readable as text on
 * white paper.
 *
 * Brand colours are chosen to look good on a screen behind white text,
 * not to *be* text. A pale yellow or mint that works as a button
 * background is effectively invisible printed on white, so using the raw
 * value on a receipt would produce a document whose headings cannot be
 * read -- on the cheap thermal or inkjet paper this is most likely to
 * meet, worse still.
 *
 * So the hue is kept and the lightness is lowered until the contrast
 * ratio against white clears WCAG AA for body text (4.5:1). The result
 * still reads as the brand; it is just dark enough to survive printing.
 *
 * A mirror of the frontend's brandPalette, deliberately not shared: the
 * frontend ships to a browser and this runs in a Lambda, and the one
 * thing they have in common is a formula short enough to state twice.
 */

const WHITE_LUMINANCE = 1;
const AA_CONTRAST = 4.5;
const FALLBACK_INK = '#111827';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseHex(hex: string): { r: number; g: number; b: number } | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Relative luminance, per WCAG. */
export function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastWithWhite(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 1;
  return (WHITE_LUMINANCE + 0.05) / (luminance(rgb) + 0.05);
}

/**
 * Returns a hex colour based on `hex` that clears AA against white.
 * Falls back to near-black for an unparseable or missing brand colour,
 * which is what the receipt used before brand colours existed.
 */
export function readableBrandInk(hex: string | null | undefined): string {
  if (!hex) return FALLBACK_INK;
  const rgb = parseHex(hex);
  if (!rgb) return FALLBACK_INK;

  // Scale all three channels toward black in small steps. Scaling
  // preserves the ratios between channels, so the hue survives -- which
  // is the whole point of using the brand colour rather than a generic
  // dark grey.
  let { r, g, b } = rgb;
  for (let i = 0; i < 40; i += 1) {
    if (contrastWithWhite(toHex({ r, g, b })) >= AA_CONTRAST) break;
    r *= 0.9;
    g *= 0.9;
    b *= 0.9;
  }
  const out = toHex({ r, g, b });
  // If even near-black somehow failed, prefer the known-good fallback.
  return contrastWithWhite(out) >= AA_CONTRAST ? out : FALLBACK_INK;
}
