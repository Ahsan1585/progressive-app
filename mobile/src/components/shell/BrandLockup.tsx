import type { CSSProperties } from "react";

const IZAYA_NAVY = "#132A3E";
const IZAYA_MINT = "#2FBF9F";

// Same wordmark path data as frontend/src/components/marketing/IzayaMark.jsx —
// duplicated here (not imported) because mobile is a separate Vite app with
// no access to frontend/src. Keep the two in sync if the mark ever changes.
function IzayaWordmark({ className }: { className?: string }) {
  const navy = { fill: "none", stroke: IZAYA_NAVY, strokeWidth: 13, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const mint = { fill: "none", stroke: IZAYA_MINT, strokeWidth: 13, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className={className} viewBox="0 0 460 130" role="img" aria-label="IZAYA">
      <path style={mint} d="M22 32 L60 63 L22 94" />
      <path style={navy} d="M96 28 L96 98" />
      <path style={navy} d="M130 28 L196 28" />
      <path style={mint} d="M196 28 L130 98" />
      <path style={navy} d="M130 98 L196 98" />
      <path style={navy} d="M216 98 L248 28 L280 98" />
      <path style={navy} d="M230 74 L266 74" />
      <path style={navy} d="M300 28 L332 64" />
      <path style={navy} d="M364 28 L332 64" />
      <path style={navy} d="M332 64 L332 98" />
      <path style={navy} d="M384 98 L416 28 L448 98" />
      <path style={navy} d="M398 74 L434 74" />
      <circle style={{ fill: IZAYA_MINT }} cx="248" cy="28" r="13" />
      <circle style={{ fill: IZAYA_MINT }} cx="332" cy="64" r="13" />
      <circle style={{ fill: IZAYA_MINT }} cx="416" cy="28" r="13" />
    </svg>
  );
}

// Mirrors frontend/src/components/BrandLockup.jsx's two size presets. Mobile
// has no Sora Variable font loaded (only Geist Variable), so "EIS" falls back
// to Geist at a heavy weight to approximate the same display weight.
const SIZES = {
  sm: { wordmarkClassName: "h-5 w-auto", eisFontSize: 15, taglineFontSize: 8, gap: 1 },
  lg: { wordmarkClassName: "h-9 w-auto", eisFontSize: 24, taglineFontSize: 11, gap: 3 },
} as const;

export function BrandLockup({
  size = "sm",
  align = "flex-start",
  className = "",
}: {
  size?: keyof typeof SIZES;
  align?: CSSProperties["alignItems"];
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", alignItems: align, gap: s.gap }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <IzayaWordmark className={s.wordmarkClassName} />
        <span
          style={{
            fontFamily: "'Geist Variable', sans-serif",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: IZAYA_MINT,
            fontSize: s.eisFontSize,
            lineHeight: 1,
          }}
        >
          EIS
        </span>
      </span>
      <span
        style={{
          fontSize: s.taglineFontSize,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#5C6B73",
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        Early Intervention Simplified
      </span>
    </div>
  );
}
