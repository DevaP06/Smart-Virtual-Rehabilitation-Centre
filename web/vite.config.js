import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API_URL lets the dev server proxy to an API on another port (for example when 8000 is taken):
//   PowerShell:  $env:API_URL="http://127.0.0.1:8765"; npm run dev      (Remove-Item Env:API_URL to go back to the default)
const target = process.env.API_URL || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target,
        // When nothing is listening, answer with a readable 502 instead of a bare 500.
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if (!res || res.headersSent || typeof res.writeHead !== "function") return;
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: `The API is not running at ${target} (${err.code || err.message}). Start it with: uvicorn api.index:app --port ${new URL(target).port || 8000}` }));
          });
        },
      },
    },
  },
});
