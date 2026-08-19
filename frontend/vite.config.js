import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The desktop (Electron) build loads index.html via file://, with no
// domain/path prefix to rewrite against — base must be relative ("./"),
// unlike the web build which is served under izayaedge.com/eis/ and needs
// the absolute "/eis/" prefix baked into every asset URL. Only `--mode
// desktop` (used by the desktop/ package's build step) switches this; the
// web build's `vite build` (no --mode flag) is untouched.
export default defineConfig(({ mode }) => ({
  base: mode === "desktop" ? "./" : "/eis/",
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));