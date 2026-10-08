import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Same codebase, two separately-deployed, separately-installable PWAs —
// the shared tenant-company practitioner app (app.izayaedge.com/EIS) and
// "Izaya One" for independent practitioners (one.izayaedge.com/EIS), who
// get their own distinct home-screen icon/name so it doesn't look like
// the same app a tenant-company practitioner uses. Toggled at build time
// via VITE_APP_BRAND (set as a Vercel env var on the "izaya-one" project,
// left unset/default on "mobile") — everything else (routes, role gating,
// features) is byte-identical between the two builds; this only changes
// what the OS shows before the app is even opened.
const APP_BRAND = process.env.VITE_APP_BRAND === "one" ? "one" : "eis";
const BRAND_CONFIG = {
  eis: {
    name: "Izaya EIS",
    shortName: "Izaya EIS",
    description: "Izaya EIS — practitioner field app for NJEIS encounter logging.",
    themeColor: "#2563eb",
    iconDir: "icons",
  },
  one: {
    name: "Izaya One",
    shortName: "Izaya One",
    description: "Izaya One — the independent practitioner's NJEIS encounter-logging app.",
    themeColor: "#FF6B5B",
    iconDir: "icons-one",
  },
}[APP_BRAND];

// index.html's %VITE_APP_NAME% etc. placeholders (Vite's own html-env
// substitution) only resolve from real process.env values at the point
// Vite's HTML transform runs — derived-from-VITE_APP_BRAND values computed
// above wouldn't otherwise reach it, so they're written back into
// process.env here before that transform happens.
process.env.VITE_APP_NAME = BRAND_CONFIG.name;
process.env.VITE_APP_ICON_DIR = BRAND_CONFIG.iconDir;
process.env.VITE_APP_THEME_COLOR = BRAND_CONFIG.themeColor;
process.env.VITE_APP_DESCRIPTION = BRAND_CONFIG.description;

// https://vite.dev/config/
export default defineConfig({
  // Served at app.izayaedge.com/EIS — every asset/URL the build emits must
  // carry that prefix (this is Vite's own base, controlling %BASE_URL% and
  // every emitted <script>/<link> src), or requests miss the /EIS/*
  // rewrites in vercel.json and fall through to the SPA catch-all instead
  // of the real file (see frontend/vercel.json's identical /eis pattern).
  // Same /EIS/ path on the one.izayaedge.com subdomain too — only the
  // domain differs between the two deployments, not this path.
  base: "/EIS/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: BRAND_CONFIG.name,
        short_name: BRAND_CONFIG.shortName,
        description: BRAND_CONFIG.description,
        start_url: "/EIS/",
        scope: "/EIS/",
        display: "standalone",
        orientation: "portrait",
        // Clinical Trust Blue tokens — design/practitioner-mobile-app-art-direction.md
        // (Izaya One build uses its own coral accent instead — see BRAND_CONFIG above.)
        theme_color: BRAND_CONFIG.themeColor,
        background_color: "#f8fafc",
        icons: [
          {
            src: `/EIS/${BRAND_CONFIG.iconDir}/icon-192.png`,
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `/EIS/${BRAND_CONFIG.iconDir}/icon-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `/EIS/${BRAND_CONFIG.iconDir}/icon-512-maskable.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the SPA shell + built assets; standard Workbox
        // generateSW strategy for a Vite app.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
      devOptions: {
        // Lets the manifest/SW be inspected against `npm run dev` too.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
