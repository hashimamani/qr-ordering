import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../api/client';
import type { RestaurantBranding } from '../../../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../components/ToastProvider';
import { TAB_BRAND_COLOR, derivePalette, isValidBrandColor } from '../../../lib/brandPalette';

export function BrandingTab() {
  const { updateBranding } = useAuth();
  const showToast = useToast();
  const [branding, setBranding] = useState<RestaurantBranding | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAB_BRAND_COLOR);
  const [usesDefault, setUsesDefault] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiFetch<RestaurantBranding>('/admin/restaurant', { auth: true })
      .then((data) => {
        setBranding(data);
        setName(data.name);
        setColor(data.brand_color ?? TAB_BRAND_COLOR);
        setUsesDefault(data.brand_color === null);
      })
      .catch((err: ApiError) => setLoadError(err.message));
  }, []);

  useEffect(load, [load]);

  async function save() {
    if (!name.trim()) {
      showToast('Restaurant name cannot be empty.');
      return;
    }
    if (!usesDefault && !isValidBrandColor(color)) {
      showToast('Pick a valid colour.');
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<RestaurantBranding>('/admin/restaurant', {
        method: 'PATCH',
        auth: true,
        // null is meaningful here, not a missing value -- it's how the
        // admin resets to the Tab default.
        body: { name: name.trim(), brand_color: usesDefault ? null : color },
      });
      setBranding(updated);
      // Push it into the live session so the sidebar and accent repaint
      // now, rather than on next login.
      updateBranding(updated.name, updated.brand_color);
      showToast('Branding updated.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  const preview = derivePalette(isValidBrandColor(color) ? color : TAB_BRAND_COLOR);

  return (
    <>
      {loadError && <div className="error-banner">{loadError}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Restaurant identity</h3>
        <p className="sub">
          Your name and colour appear on the customer ordering page, the order tracking page, and every staff
          screen.
        </p>

        <label htmlFor="brand-name">Restaurant name</label>
        <input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />

        <label htmlFor="brand-slug">Web address</label>
        <input id="brand-slug" value={branding?.slug ?? ''} readOnly disabled />
        <p className="sub" style={{ marginTop: 4 }}>
          Fixed — it's encoded in every QR code you've already printed, so changing it would stop those codes
          working.
        </p>

        <label className="filter-toggle" style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            checked={usesDefault}
            onChange={(e) => setUsesDefault(e.target.checked)}
          />
          Use the default Tab colour
        </label>

        {!usesDefault && (
          <>
            <label htmlFor="brand-color" style={{ marginTop: 16 }}>
              Accent colour
            </label>
            <div className="brand-color-row">
              <input
                id="brand-color"
                type="color"
                className="brand-color-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <input
                aria-label="Accent colour hex"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                spellCheck={false}
                maxLength={7}
              />
            </div>
          </>
        )}

        <div className="brand-preview" aria-label="Colour preview">
          {([50, 100, 200, 500, 600, 700, 800] as const).map((stop) => (
            <span key={stop} className="brand-swatch" style={{ background: preview[stop] }} title={`${stop}`} />
          ))}
        </div>
        <p className="sub">
          The shades either side are derived from your colour automatically — the darker ones are kept dark
          enough for white text to stay readable.
        </p>

        <button className="primary" onClick={save} disabled={saving} style={{ marginTop: 8 }}>
          {saving ? 'Saving…' : 'Save branding'}
        </button>
      </div>
    </>
  );
}
