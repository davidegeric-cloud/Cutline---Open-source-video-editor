import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "desktop",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist-desktop",
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome136",
  },
});
