import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: { target: "esnext" },
  server: {
    proxy: {
      // Dev-only: forward serving-API requests to the local FastAPI app.
      "/pitches": "http://localhost:8000",
    },
  },
  test: { environment: "node" },
});
