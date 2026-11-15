import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** The pitch deck. It is written and presented from this folder, so the page uses it as it is. */
const DECK_SOURCE = fileURLToPath(new URL("../presentation", import.meta.url));
/** What the deck needs to run. The README, the PDF and the export script stay out of the page. */
const DECK_PARTS = ["index.html", "deck.css", "deck.js", "fonts", "img"];
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Puts the pitch deck at /deck/, unchanged: served from its folder while developing,
 * copied into the build otherwise. The welcome page shows it in a frame.
 */
function pitchDeck(): Plugin {
  let outDir = "";
  let building = false;
  return {
    name: "pitch-deck",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      building = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use("/deck", (request, response, next) => {
        const path = decodeURIComponent((request.url ?? "/").split("?")[0]);
        const file = resolve(DECK_SOURCE, `.${path.endsWith("/") ? `${path}index.html` : path}`);
        const allowed = DECK_PARTS.some((part) => file === join(DECK_SOURCE, part) || file.startsWith(join(DECK_SOURCE, part) + sep));
        if (!allowed || !existsSync(file) || !statSync(file).isFile()) return next();
        response.setHeader("Content-Type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      if (!building) return;
      for (const part of DECK_PARTS) cpSync(join(DECK_SOURCE, part), join(outDir, "deck", part), { recursive: true });
    },
  };
}

// The page talks to the Python backend on port 8000 while developing.
export default defineConfig({
  plugins: [react(), tailwindcss(), pitchDeck()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
