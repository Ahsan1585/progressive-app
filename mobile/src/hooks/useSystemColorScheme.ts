import { useEffect } from "react";

// Unlike the web app (whose .dark tokens are effectively unused), this app's
// dark companion is real (art-direction §3) — follow the OS/browser
// preference automatically since there's no in-app theme toggle in scope.
export function useSystemColorScheme() {
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (matches: boolean) => {
      document.documentElement.classList.toggle("dark", matches);
    };
    apply(mql.matches);
    const listener = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);
}
