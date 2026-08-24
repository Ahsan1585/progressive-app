import { BrandWordmarkRow } from '@/components/marketing/IzayaMark';

// Shared logo lockup for every authenticated-app header (AdminDashboard,
// the practitioner dashboard, AuthLayout's pre/post-login screens,
// PlatformAdmin) — same design as the marketing site's nav (MarketingBrand
// in IzayaMark.jsx), just usable outside the `.mk-page`-scoped marketing
// stylesheet those pages don't load. `size` picks a preset scale rather
// than exposing every dimension, since every caller so far only needs
// "small header" or "large centered" — add a preset here rather than a
// one-off inline override if a third size is ever needed.
const SIZES = {
  sm: { wordmarkClassName: 'h-5 w-auto', eisFontSize: 15, taglineFontSize: 8, gap: 1 },
  lg: { wordmarkClassName: 'h-9 w-auto', eisFontSize: 27, taglineFontSize: 11, gap: 3 },
};

export function BrandLockup({ size = 'sm', align = 'flex-start', className = '' }) {
  const s = SIZES[size];
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: s.gap }}>
      <BrandWordmarkRow wordmarkClassName={s.wordmarkClassName} eisFontSize={s.eisFontSize} />
      <span style={{ fontSize: s.taglineFontSize, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5C6B73', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
        Early Intervention Simplified
      </span>
    </div>
  );
}
