// The app's real logo — the IZAYA wordmark as paths (chevron, I, Z, two A's,
// Y), unchanged from what the site used before. Renders crisply at any size
// without shipping a raster asset.
export function IzayaWordmark({ className }) {
  return (
    <svg className={className} viewBox="0 0 460 130" role="img" aria-label="IZAYA">
      <path className="ilg-m" d="M22 32 L60 63 L22 94" />
      <path className="ilg-n" d="M96 28 L96 98" />
      <path className="ilg-n" d="M130 28 L196 28" />
      <path className="ilg-m" d="M196 28 L130 98" />
      <path className="ilg-n" d="M130 98 L196 98" />
      <path className="ilg-n" d="M216 98 L248 28 L280 98" />
      <path className="ilg-n" d="M230 74 L266 74" />
      <path className="ilg-n" d="M300 28 L332 64" />
      <path className="ilg-n" d="M364 28 L332 64" />
      <path className="ilg-n" d="M332 64 L332 98" />
      <path className="ilg-n" d="M384 98 L416 28 L448 98" />
      <path className="ilg-n" d="M398 74 L434 74" />
      <circle className="ilg-node" cx="248" cy="28" r="13" />
      <circle className="ilg-node" cx="332" cy="64" r="13" />
      <circle className="ilg-node" cx="416" cy="28" r="13" />
    </svg>
  );
}

export function MarketingBrand({ className }) {
  return (
    <span className={className} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IzayaWordmark className="mk-nav-logo" />
        <span className="mk-nav-eis">EIS</span>
      </span>
      <span className="mk-nav-slogan">Early Intervention Simplified</span>
    </span>
  );
}
