import { useEffect } from 'react';
import { derivePalette, isValidBrandColor } from '../lib/brandPalette';

const STOPS = [50, 100, 200, 500, 600, 700, 800] as const;

/**
 * Applies a restaurant's accent colour by overriding the --brand-* custom
 * properties on :root, which is all styles.css reads -- so every surface
 * repaints without any component knowing about theming.
 *
 * Passing null (or an invalid value) clears the overrides and falls back
 * to the Tab default defined in styles.css. Clearing on unmount is what
 * keeps the platform-admin console Tab-teal: it never calls this hook, so
 * navigating there from a branded page restores the default rather than
 * inheriting the last restaurant's colour.
 */
export function useBrandColor(hex: string | null | undefined): void {
  useEffect(() => {
    if (!hex || !isValidBrandColor(hex)) return;

    const root = document.documentElement;
    const palette = derivePalette(hex);
    for (const stop of STOPS) {
      root.style.setProperty(`--brand-${stop}`, palette[stop]);
    }

    return () => {
      for (const stop of STOPS) {
        root.style.removeProperty(`--brand-${stop}`);
      }
    };
  }, [hex]);
}
