import { useEffect, useState } from "react";

// Total time the animation plays before it starts departing, and how long
// the depart transition itself takes — mirrors the standalone splash mockup
// (field wake -> sprout draws -> logo strokes in -> nodes pop -> tagline).
const HOLD_MS = 6800;
const DEPART_MS = 800;
const REDUCED_MOTION_HOLD_MS = 900;

// Full-screen launch animation for the mobile hybrid app. Mounted once at
// app start (not re-shown on ordinary in-session navigation) and sits above
// the real route tree via a fixed overlay so the destination screen is
// already mounted and ready underneath by the time it departs.
export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [departing, setDeparting] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const holdMs = reduced ? REDUCED_MOTION_HOLD_MS : HOLD_MS;
    const departTimer = setTimeout(() => setDeparting(true), holdMs);
    const finishTimer = setTimeout(onFinish, holdMs + DEPART_MS);
    return () => {
      clearTimeout(departTimer);
      clearTimeout(finishTimer);
    };
  }, [onFinish]);

  return (
    <div className={`splash-root${departing ? " splash-depart" : ""}`}>
      <style>{`
        .splash-root{
          position:fixed;
          inset:0;
          z-index:9999;
          overflow:hidden;
          background:#0B1B2A;
          display:flex;
          align-items:center;
          justify-content:center;
          font-family:var(--font-sans, sans-serif);
        }
        .splash-field{
          position:absolute;
          inset:0;
          background:
            radial-gradient(120% 90% at 50% 110%, rgba(47,191,159,0.35), transparent 60%),
            radial-gradient(140% 100% at 50% 120%, rgba(14,110,103,0.5), transparent 70%),
            linear-gradient(180deg, #0B1B2A 0%, #132A3E 100%);
          opacity:0;
          animation: splashFieldWake 2.8s cubic-bezier(0.33,0,0.13,1) 0.2s forwards;
        }
        @keyframes splashFieldWake{ to{ opacity:1; } }

        .splash-glow{
          position:absolute;
          left:50%; top:58%;
          width:340px; height:340px;
          transform:translate(-50%,-50%) scale(0.4);
          border-radius:50%;
          background:radial-gradient(circle, rgba(244,251,247,0.28) 0%, rgba(47,191,159,0.14) 40%, transparent 70%);
          opacity:0;
          animation: splashBloom 3s cubic-bezier(0.33,0,0.13,1) 0.8s forwards;
          animation-fill-mode:forwards;
          pointer-events:none;
        }
        @keyframes splashBloom{ to{ opacity:1; transform:translate(-50%,-50%) scale(1); } }

        .splash-stage{
          position:relative;
          text-align:center;
          z-index:2;
          animation-fill-mode:forwards;
        }

        .splash-sprout{ margin:0 auto 20px; display:block; }
        .splash-stem{
          stroke:#F4FBF7; stroke-width:3; stroke-linecap:round; fill:none;
          stroke-dasharray:60; stroke-dashoffset:60;
          animation: splashDraw 1.1s cubic-bezier(0.33,0,0.13,1) 1.5s forwards;
        }
        .splash-leaf{ fill:#2FBF9F; opacity:0; transform-origin:center bottom; transform:scale(0.4); }
        .splash-leaf.l{ animation: splashUnfurl 0.9s cubic-bezier(0.33,0,0.13,1) 2.3s forwards; }
        .splash-leaf.r{ animation: splashUnfurl 0.9s cubic-bezier(0.33,0,0.13,1) 2.55s forwards; }
        @keyframes splashDraw{ to{ stroke-dashoffset:0; } }
        @keyframes splashUnfurl{ to{ opacity:1; transform:scale(1); } }
        .splash-seed{ fill:#F4FBF7; opacity:0; animation: splashSeedLight 0.6s cubic-bezier(0.33,0,0.13,1) 1.2s forwards; }
        @keyframes splashSeedLight{ to{ opacity:0.9; } }

        .splash-logo{ width:min(300px, 78vw); height:auto; display:block; margin:0 auto; overflow:visible; }
        .splash-stroke-w{ stroke:#F4FBF7; fill:none; stroke-width:13; stroke-linecap:round; stroke-linejoin:round; }
        .splash-stroke-g{ stroke:#2FBF9F; fill:none; stroke-width:13; stroke-linecap:round; stroke-linejoin:round; }
        .splash-letter{ opacity:0; transform:translateY(8px); animation: splashLetterIn 0.7s cubic-bezier(0.33,0,0.13,1) forwards; }
        .splash-letter:nth-of-type(1){ animation-delay:3.1s; }
        .splash-letter:nth-of-type(2){ animation-delay:3.24s; }
        .splash-letter:nth-of-type(3){ animation-delay:3.38s; }
        .splash-letter:nth-of-type(4){ animation-delay:3.52s; }
        .splash-letter:nth-of-type(5){ animation-delay:3.66s; }
        .splash-letter:nth-of-type(6){ animation-delay:3.8s; }
        @keyframes splashLetterIn{ to{ opacity:1; transform:translateY(0); } }
        .splash-node{
          fill:#2FBF9F; opacity:0; transform-box:fill-box; transform-origin:center; transform:scale(0);
          animation: splashNodePop 0.5s cubic-bezier(0.34,1.5,0.5,1) forwards;
        }
        .splash-node.n1{ animation-delay:4.15s; }
        .splash-node.n2{ animation-delay:4.3s; }
        .splash-node.n3{ animation-delay:4.45s; }
        @keyframes splashNodePop{ to{ opacity:1; transform:scale(1); } }

        .splash-tagline{
          margin-top:22px; font-size:11px; font-weight:500; letter-spacing:4px;
          text-transform:uppercase; color:rgba(244,251,247,0.55); opacity:0;
          animation: splashWhisper 1.2s cubic-bezier(0.33,0,0.13,1) 4.9s forwards;
        }
        @keyframes splashWhisper{ to{ opacity:1; } }

        .splash-mote{
          position:absolute; bottom:-8px; width:4px; height:4px; border-radius:50%;
          background:#F4FBF7; opacity:0; animation: splashRise linear infinite;
        }
        .splash-mote:nth-of-type(1){ left:18%; animation-duration:11s; animation-delay:2s; }
        .splash-mote:nth-of-type(2){ left:34%; width:3px; height:3px; animation-duration:14s; animation-delay:4s; }
        .splash-mote:nth-of-type(3){ left:52%; animation-duration:12s; animation-delay:3s; }
        .splash-mote:nth-of-type(4){ left:68%; width:2.5px; height:2.5px; animation-duration:16s; animation-delay:5.5s; }
        .splash-mote:nth-of-type(5){ left:83%; width:3px; height:3px; animation-duration:13s; animation-delay:2.8s; }
        @keyframes splashRise{
          0%{ transform:translateY(0); opacity:0; }
          12%{ opacity:0.5; }
          85%{ opacity:0.3; }
          100%{ transform:translateY(-105vh); opacity:0; }
        }

        .splash-root.splash-depart .splash-stage,
        .splash-root.splash-depart .splash-glow{
          transition: opacity 0.8s cubic-bezier(0.33,0,0.13,1), transform 0.8s cubic-bezier(0.33,0,0.13,1);
          opacity:0;
          transform:translateY(-14px);
        }
        .splash-root.splash-depart .splash-glow{ transform:translate(-50%,-58%); }

        @media (prefers-reduced-motion: reduce){
          .splash-field, .splash-glow, .splash-stem, .splash-leaf, .splash-seed,
          .splash-letter, .splash-node, .splash-tagline{
            animation:none !important;
            opacity:1 !important;
            transform:none !important;
            stroke-dashoffset:0 !important;
          }
          .splash-mote{ display:none; }
        }
      `}</style>

      <div className="splash-field" />
      <div className="splash-glow" />

      <div className="splash-mote" />
      <div className="splash-mote" />
      <div className="splash-mote" />
      <div className="splash-mote" />
      <div className="splash-mote" />

      <div className="splash-stage">
        <svg className="splash-sprout" viewBox="0 0 72 96" style={{ width: 72, height: 96 }}>
          <circle className="splash-seed" cx="36" cy="88" r="3.5" />
          <path className="splash-stem" d="M36 88 C 36 70 36 56 36 40" />
          <path className="splash-leaf l" d="M36 62 C 20 58 17 40 26 30 C 33 42 36 52 36 62 Z" />
          <path className="splash-leaf r" d="M36 52 C 52 48 55 32 47 22 C 40 34 36 43 36 52 Z" />
        </svg>

        <svg className="splash-logo" viewBox="0 0 460 130" role="img" aria-label="IZAYA">
          <g className="splash-letter">
            <path className="splash-stroke-g" d="M22 32 L60 63 L22 94" />
          </g>
          <g className="splash-letter">
            <path className="splash-stroke-w" d="M96 28 L96 98" />
          </g>
          <g className="splash-letter">
            <path className="splash-stroke-w" d="M130 28 L196 28" />
            <path className="splash-stroke-g" d="M196 28 L130 98" />
            <path className="splash-stroke-w" d="M130 98 L196 98" />
          </g>
          <g className="splash-letter">
            <path className="splash-stroke-w" d="M216 98 L248 28 L280 98" />
            <path className="splash-stroke-w" d="M230 74 L266 74" />
          </g>
          <g className="splash-letter">
            <path className="splash-stroke-w" d="M300 28 L332 64" />
            <path className="splash-stroke-w" d="M364 28 L332 64" />
            <path className="splash-stroke-w" d="M332 64 L332 98" />
          </g>
          <g className="splash-letter">
            <path className="splash-stroke-w" d="M384 98 L416 28 L448 98" />
            <path className="splash-stroke-w" d="M398 74 L434 74" />
          </g>
          <circle className="splash-node n1" cx="248" cy="28" r="13" />
          <circle className="splash-node n2" cx="332" cy="64" r="13" />
          <circle className="splash-node n3" cx="416" cy="28" r="13" />
        </svg>

        <div className="splash-tagline">Early Intervention Simplified</div>
      </div>
    </div>
  );
}
