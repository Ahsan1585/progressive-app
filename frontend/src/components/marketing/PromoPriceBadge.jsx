// Hand-built badge matching a reference postcard design (yellow scalloped
// "limited time" banner over a red brush-stroke swatch). Built as inline SVG
// rather than a raster export so it stays crisp at any size and the price
// text can be edited without regenerating an image.
export function PromoPriceBadge({ className = '' }) {
  return (
    <svg
      viewBox="0 0 480 260"
      className={className}
      role="img"
      aria-label="Special promotion for a limited time. $19.99 per month."
    >
      {/* torn brush-stroke swatch — irregular spiky silhouette, not a clean shape */}
      <path
        d="M24 70
           L8 56 L30 48 L10 36 L34 28 L18 14 L46 16 L38 2 L64 10 L70 0
           L300 0 L330 8 L360 1 L368 14 L396 6 L390 20 L418 16 L406 32
           L434 30 L418 46 L444 48 L426 62
           L446 92
           L432 104 L450 118 L430 128 L448 144
           L428 156 L446 172 L424 182
           L440 204 L414 206 L428 222 L398 218 L406 236 L376 226
           L368 244 L344 228 L332 248 L312 230
           L70 230
           L52 246 L44 228 L18 240 L22 220 L-4 224 L8 206
           L-10 198 L10 182 L-6 168 L14 156
           L-4 138 L16 126 L0 108 L22 96
           L4 84 Z"
        fill="#E8352B"
      />
      <g transform="translate(66 22) rotate(-4)">
        <path
          d="M0 14 L-8 6 L8 2 L0 -6 L24 -2 L300 -2 L288 6 L304 2 L296 14
             L304 28 L288 24 L300 40 L276 34 L284 48 L8 48 L16 34 L-8 38 L0 24 L-10 16 Z"
          fill="#FFE100"
        />
        <text x="148" y="20" textAnchor="middle" fontFamily="'Manrope Variable', sans-serif" fontWeight="800" fontSize="15" letterSpacing="0.5" fill="#C21807">
          SPECIAL PROMOTION
        </text>
        <text x="148" y="40" textAnchor="middle" fontFamily="'Manrope Variable', sans-serif" fontWeight="800" fontSize="15" letterSpacing="0.5" fill="#C21807">
          FOR A LIMITED TIME
        </text>
      </g>
      <text x="240" y="168" textAnchor="middle" fontFamily="'Manrope Variable', sans-serif" fontWeight="800" fontSize="74" fill="#fff">
        $19.99
      </text>
      <text x="240" y="208" textAnchor="middle" fontFamily="'Manrope Variable', sans-serif" fontWeight="700" fontSize="26" fill="#fff">
        per month
      </text>
    </svg>
  );
}
