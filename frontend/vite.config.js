import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
      // Bull-Board UI lives on the API process — proxy through so opening
      // /admin/queues in the SPA tab loads it directly instead of the
      // SPA fallback (blank page).
      "/admin": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      // Socket.io upgrade path — same origin in dev.
      "/socket.io": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
