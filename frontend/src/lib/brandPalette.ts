/**
 * Derives the seven --brand-* stops styles.css uses from a single accent
 * colour, so onboarding asks for one field instead of a whole palette.
 * Hand-rolled HSL rather than a colour library, consistent with the
 * hand-drawn icons (components/icons.tsx) and the hand-rolled revenue
 * chart -- this is ~60 lines and adds nothing to the bundle.
 */

/** The Tab default (teal-500), used whenever a restaurant has no colour set. */
export const TAB_BRAND_COLOR = '#14b8a6';

export type BrandStop = 50 | 100 | 200 | 500 | 600 | 700 | 800;
export type BrandPalette = Record<BrandStop, string>;

const HEX = /^#[0-9a-f]{6}$/i;

export function isValidBrandColor(value: string): boolean {
  return HEX.test(value);
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;

  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const toByte = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(rgb[0])}${toByte(rgb[1])}${toByte(rgb[2])}`;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Fixed lightness targets rather than ratios of the input's own
 * lightness. That distinction is load-bearing, not stylistic: 600/700/800
 * carry white text (.admin-nav a.active, .station-advance:hover, the
 * header nav), and scaling relative to a pale accent -- a yellow, say --
 * would derive a "dark" stop that is still far too light to read white on.
 * Pinning the dark end to absolute lightness ceilings means any accent,
 * however pale, still yields a usable palette.
 *
 * The light end (50/100/200) is capped in saturation too, so a vivid
 * accent doesn't produce a tinted background that fights the content.
 */
const STOPS: { stop: BrandStop; l: number; maxS?: number }[] = [
  { stop: 50, l: 0.97, maxS: 0.76 },
  { stop: 100, l: 0.9, maxS: 0.85 },
  { stop: 200, l: 0.79, maxS: 0.84 },
  { stop: 600, l: 0.32 },
  { stop: 700, l: 0.26 },
  { stop: 800, l: 0.22 },
];

export function derivePalette(input: string): BrandPalette {
  // Falls back rather than throwing: this runs on every keystroke behind
  // the hex fields in the onboarding and Branding forms, where the value
  // is briefly invalid as someone types it.
  const hex = isValidBrandColor(input) ? input : TAB_BRAND_COLOR;
  const base = hexToHsl(hex);
  // A near-grey accent would otherwise derive a palette of flat greys with
  // no usable accent at all; floor the saturation so the scale stays
  // visibly a colour.
  const s = clamp(base.s, 0.18, 1);

  const palette = { 500: hex.toLowerCase() } as BrandPalette;
  for (const { stop, l, maxS } of STOPS) {
    palette[stop] = hslToHex({ h: base.h, s: maxS ? Math.min(s, maxS) : s, l });
  }
  return palette;
}

/** Relative luminance per WCAG, used to verify white-on-brand contrast. */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Contrast ratio against white, per WCAG. 4.5 is the AA threshold for body text. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}
