import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  // Served at app.izayaedge.com/EIS — every asset/URL the build emits must
  // carry that prefix (this is Vite's own base, controlling %BASE_URL% and
  // every emitted <script>/<link> src), or requests miss the /EIS/*
  // rewrites in vercel.json and fall through to the SPA catch-all instead
  // of the real file (see frontend/vercel.json's identical /eis pattern).
  base: "/EIS/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Izaya EIS",
        short_name: "Izaya EIS",
        description:
          "Izaya EIS — practitioner field app for NJEIS encounter logging.",
        start_url: "/EIS/",
        scope: "/EIS/",
        display: "standalone",
        orientation: "portrait",
        // Clinical Trust Blue tokens — design/practitioner-mobile-app-art-direction.md
        theme_color: "#2563eb",
        background_color: "#f8fafc",
        icons: [
          {
            src: "/EIS/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/EIS/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/EIS/icons/icon-512-maskable.png",
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
