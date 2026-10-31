import { defineConfig } from "vite";

// Relative base so the build works from any folder (GitHub Pages subpath, a USB stick, file server).
export default defineConfig({
  base: "./",
  server: { port: 5185, strictPort: true, host: "127.0.0.1" },
  preview: { port: 5186, strictPort: true, host: "127.0.0.1" },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  worker: { format: "es" },
  test: { environment: "node", include: ["tests/unit/**/*.test.js"] },
});
