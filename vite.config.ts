import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // relative base so the build works at any URL — GitHub Pages project sites
  // (username.github.io/repo/), Vercel, or a plain file server
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
} as any);
