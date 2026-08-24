// Brand colors as plain constants, not just marketing.css custom
// properties — IzayaWordmark below applies them as inline SVG attributes
// (not the `.ilg-*` classes alone) so the mark renders correctly anywhere
// in the app, including pages outside the `.mk-page`-scoped marketing
// stylesheet (AdminDashboard, the practitioner dashboard, AuthLayout,
// PlatformAdmin) — those previously had to fall back to a raster PNG, or
// (PlatformAdmin) inject their own one-off scoped <style> to reproduce
// these same two colors.
export const IZAYA_NAVY = '#132A3E';
export const IZAYA_MINT = '#2FBF9F';

// The app's real logo — the IZAYA wordmark as paths (chevron, I, Z, two A's,
// Y), unchanged from what the site used before. Renders crisply at any size
// without shipping a raster asset. Colors are inline (see above), so the
// `.ilg-*` classNames below are kept only for any existing external
// selectors that might target them — they're no longer load-bearing.
export function IzayaWordmark({ className }) {
  const navy = { fill: 'none', stroke: IZAYA_NAVY, strokeWidth: 13, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const mint = { fill: 'none', stroke: IZAYA_MINT, strokeWidth: 13, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg className={className} viewBox="0 0 460 130" role="img" aria-label="IZAYA">
      <path className="ilg-m" style={mint} d="M22 32 L60 63 L22 94" />
      <path className="ilg-n" style={navy} d="M96 28 L96 98" />
      <path className="ilg-n" style={navy} d="M130 28 L196 28" />
      <path className="ilg-m" style={mint} d="M196 28 L130 98" />
      <path className="ilg-n" style={navy} d="M130 98 L196 98" />
      <path className="ilg-n" style={navy} d="M216 98 L248 28 L280 98" />
      <path className="ilg-n" style={navy} d="M230 74 L266 74" />
      <path className="ilg-n" style={navy} d="M300 28 L332 64" />
      <path className="ilg-n" style={navy} d="M364 28 L332 64" />
      <path className="ilg-n" style={navy} d="M332 64 L332 98" />
      <path className="ilg-n" style={navy} d="M384 98 L416 28 L448 98" />
      <path className="ilg-n" style={navy} d="M398 74 L434 74" />
      <circle className="ilg-node" style={{ fill: IZAYA_MINT }} cx="248" cy="28" r="13" />
      <circle className="ilg-node" style={{ fill: IZAYA_MINT }} cx="332" cy="64" r="13" />
      <circle className="ilg-node" style={{ fill: IZAYA_MINT }} cx="416" cy="28" r="13" />
    </svg>
  );
}

// The "EIS" mark + tagline, in the same inline-safe style — reused by
// MarketingBrand below (marketing site, wrapped in .mk-page) and by
// BrandLockup.jsx (every other authenticated-app header, not wrapped in
// .mk-page). "EIS" uses the logo's own mint green (IZAYA_MINT, the
// chevron/node accent), not a different accent color, so it reads as part
// of the mark itself.
// `eisClassName` lets a caller hand sizing over to CSS (so it can add
// responsive breakpoints, e.g. MarketingBrand's mk-eis-text below) instead
// of the fixed `eisFontSize` px value — when given, fontSize is left off
// the inline style so the class (and its media queries) actually wins.
export function BrandWordmarkRow({ wordmarkClassName, eisFontSize = 27, eisClassName }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <IzayaWordmark className={wordmarkClassName} />
      <span
        className={eisClassName}
        style={{
          fontFamily: "'Sora Variable', sans-serif",
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: IZAYA_MINT,
          lineHeight: 1,
          ...(eisClassName ? {} : { fontSize: eisFontSize }),
        }}
      >
        EIS
      </span>
    </span>
  );
}

export function MarketingBrand({ className }) {
  return (
    <span className={className} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <BrandWordmarkRow wordmarkClassName="mk-nav-logo" eisClassName="mk-eis-text" />
      <span className="mk-nav-slogan">Early Intervention Simplified</span>
    </span>
  );
}
