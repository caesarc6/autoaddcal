import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, "../public/assets"),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/mount.tsx"),
      output: {
        entryFileNames: "auto-sync.js",
        chunkFileNames: "auto-sync-[name].js",
        assetFileNames: "auto-sync[extname]",
      },
    },
  },
});
