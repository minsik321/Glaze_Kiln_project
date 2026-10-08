import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
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
