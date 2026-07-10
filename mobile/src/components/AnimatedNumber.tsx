import * as React from "react";

const SESSION_FLAG = "mobile:statsAnimatedOnce";

interface AnimatedNumberProps {
  value: number;
  formatter?: (n: number) => string;
}

// Subtle count-up on first paint of the session only (art-direction §6:
// "rare event -> delight is allowed"). Every subsequent stats refresh just
// renders the final value immediately — no repeated tweening.
export function AnimatedNumber({ value, formatter = (n) => String(Math.round(n)) }: AnimatedNumberProps) {
  const shouldAnimate = React.useRef(typeof window !== "undefined" && !sessionStorage.getItem(SESSION_FLAG));
  const [display, setDisplay] = React.useState(shouldAnimate.current ? 0 : value);
  const prefersReducedMotion = React.useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  React.useEffect(() => {
    if (!shouldAnimate.current || prefersReducedMotion.current) {
      setDisplay(value);
      return;
    }
    shouldAnimate.current = false;
    sessionStorage.setItem(SESSION_FLAG, "1");

    const duration = 500;
    const start = performance.now();
    const from = 0;

    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span className="tabular">{formatter(display)}</span>;
}
