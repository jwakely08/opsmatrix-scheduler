import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

function buildInfo() {
  let hash = "dev";
  try { hash = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* no git */ }
  return { hash, date: new Date().toISOString().slice(0, 10) };
}

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify(buildInfo()) },
  // relative base so the build works at any URL — GitHub Pages project sites
  // (username.github.io/repo/), Vercel, or a plain file server
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
} as any);
