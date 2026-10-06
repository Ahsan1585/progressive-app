import { useEffect, useRef } from 'react';

// Lightweight scroll-reveal for the marketing site — IntersectionObserver
// only (never a scroll listener; see marketing.css's existing all-CSS
// motion for why this stays dependency-free rather than pulling in
// Framer Motion/GSAP for one effect). Adds `.mk-reveal-visible` once an
// element enters the viewport; the CSS transition itself lives in
// marketing.css and is skipped entirely under prefers-reduced-motion
// (matches every other instance of that query in this file already).
// Attach the returned ref to any element with the `.mk-reveal` class.
export function useScrollReveal(options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('mk-reveal-visible');
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('mk-reveal-visible');
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px', ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [options]);

  return ref;
}
