import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { pythonAssets } from "./scripts/python-assets.mjs";
const root = fileURLToPath(new URL(".", import.meta.url));
function kilnPython(): Plugin {
  return {
    name: "kiln-python-assets",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        if (
          pathname !== "/kiln-manifest.json" &&
          !pathname.startsWith("/python/")
        )
          return next();
        try {
          const asset = (await pythonAssets(root)).find(
            (a) => "/" + a.fileName === pathname,
          );
          if (!asset) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          res.setHeader(
            "Content-Type",
            pathname.endsWith(".json")
              ? "application/json"
              : "text/plain; charset=utf-8",
          );
          res.end(asset.source);
        } catch (error) {
          next(error as Error);
        }
      });
    },
    async generateBundle() {
      for (const asset of await pythonAssets(root))
        this.emitFile({ type: "asset", ...asset });
    },
  };
}
export default defineConfig({
  base: "./",
  plugins: [react(), kilnPython()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@supabase") || id.includes("node_modules/ws") || id.includes("node_modules/iceberg-js")) return "supabase-vendor";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react-vendor";
        },
      },
    },
  },
});
