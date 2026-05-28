import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Renderer lives in src/mainview; Vite builds to dist/, which electrobun.config
// copies into views/mainview. base "./" keeps asset URLs relative for views://.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/mainview",
  base: "./",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/mainview"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
