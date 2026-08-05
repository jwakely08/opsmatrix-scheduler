// Builds the fusion bridge as a single self-contained IIFE
// (window.OpsMatrixFusion) for injection into the classic app.
import { defineConfig } from "vite";

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify({ hash: "fusion", date: "" }) },
  publicDir: false,
  build: {
    lib: {
      entry: "src/bridge/fusionEntry.ts",
      name: "OpsMatrixFusion",
      formats: ["iife"],
      fileName: () => "fusion-core.js"
    },
    outDir: "scripts/out",
    emptyOutDir: true,
    minify: true
  }
});
