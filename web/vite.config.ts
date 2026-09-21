import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target =
    process.env.VITE_API_URL ||
    env.VITE_API_URL ||
    "http://localhost:8000";

  return {
    plugins: [solid()],
    build: { target: "esnext" },
    server: {
      proxy: {
        // Dev-only: forward serving-API requests to the local FastAPI app or Cloud Run service.
        "/pitches": {
          target,
          changeOrigin: true,
        },
      },
    },
    test: { environment: "node" },
  };
});
