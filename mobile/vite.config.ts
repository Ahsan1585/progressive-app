import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Root-relative so the app installs correctly regardless of which
      // subpath/domain it ends up deployed at.
      base: "/",
      manifest: {
        name: "Progressive Steps NJ — Practitioner",
        short_name: "PS NJ",
        description:
          "Progressive Steps NJ — practitioner field app for NJEIS encounter logging.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        // Clinical Trust Blue tokens — design/practitioner-mobile-app-art-direction.md
        theme_color: "#2563eb",
        background_color: "#f8fafc",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512-maskable.png",
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
