import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Express API listens on port 3000 (see PORT in the server config). Every
// /api request is proxied there, so the browser only ever talks to the Vite
// origin. The frontend never holds database credentials or provider API keys.
//
// VITE_API_TARGET overrides the target for the rare case where the API runs
// elsewhere; the default stays the documented port 3000.
const apiTarget = process.env.VITE_API_TARGET || "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
