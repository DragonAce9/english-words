import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  envDir: repoRoot,
  plugins: [react()],
  server: {
    port: 5173,
    // Quick Cloudflare Tunnel (*.trycloudflare.com) sends a non-localhost Host header.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/me": "http://127.0.0.1:3000",
      "/themes": "http://127.0.0.1:3000",
      "/sessions": "http://127.0.0.1:3000",
      "/exam": "http://127.0.0.1:3000",
      "/studying": "http://127.0.0.1:3000",
      "/progress": "http://127.0.0.1:3000",
      "/onboarding": "http://127.0.0.1:3000",
      "/pet": "http://127.0.0.1:3000",
      "/referral": "http://127.0.0.1:3000",
      "/teachers": "http://127.0.0.1:3000",
      "/texts": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
      "/metrics": "http://127.0.0.1:3000",
      "/webhook": "http://127.0.0.1:3000",
    },
  },
});
