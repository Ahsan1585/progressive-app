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
      {/* brush-stroke swatch — soft, uneven wave edges rather than a clean
          rectangle, like a paint-roller pass rather than a cut sticker */}
      <path
        d="M30 12
           C10 8 -4 24 6 40
           C-6 52 2 72 18 76
           C4 86 2 106 16 114
           C0 124 2 146 20 150
           C4 160 4 182 22 188
           C10 198 14 216 32 220
           C24 232 34 248 54 246
           C64 256 86 254 98 244
           C120 256 150 250 164 236
           C190 248 220 244 236 230
           C262 244 296 240 312 224
           C336 236 366 228 378 210
           C400 220 426 210 434 190
           C452 196 470 180 464 160
           C480 150 478 126 462 116
           C474 102 468 80 450 72
           C460 58 452 36 432 30
           C436 14 420 -4 398 4
           C392 -10 368 -14 352 0
           C336 -12 308 -10 296 4
           C276 -8 246 -6 234 10
           C212 -6 182 -4 170 10
           C148 -4 118 -2 108 14
           C86 0 58 2 46 18
           C40 6 24 -2 30 12 Z"
        fill="#E8352B"
      />
      <g transform="translate(66 22) rotate(-4)">
        <path
          d="M0 14 L-8 6 L8 2 L0 -6 L24 -2 L300 -2 L288 6 L304 2 L296 14
             L304 28 L288 24 L300 40 L276 34 L284 48 L8 48 L16 34 L-8 38 L0 24 L-10 16 Z"
          fill="#FFE100"
        />
        <text x="148" y="22" textAnchor="middle" fontFamily="'Manrope Variable', sans-serif" fontWeight="800" fontSize="19" letterSpacing="0.3" fill="#C21807">
          SPECIAL PROMOTION
        </text>
        <text x="148" y="43" textAnchor="middle" fontFamily="'Manrope Variable', sans-serif" fontWeight="800" fontSize="19" letterSpacing="0.3" fill="#C21807">
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
