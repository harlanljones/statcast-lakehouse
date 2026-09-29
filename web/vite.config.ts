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
    build: {
      target: "esnext",
      // The deck chunk (deck.gl core+layers, luma.gl, math.gl) is ~860 kB minified / ~240 kB gzip
      // and does not split further without cyclic chunks; everything else is well under 500 kB.
      // The limit sits just above it so a new oversized chunk still warns.
      chunkSizeWarningLimit: 900,
      rolldownOptions: {
        output: {
          // Vendor chunks: deck.gl/luma/math.gl (the GPU stack), Arrow (+ zstd) and Solid
          // cache independently of the app code; the 2D panels are lazy() chunks.
          codeSplitting: {
            groups: [

              { name: "deck", test: /node_modules[\\/](@deck\.gl|@luma\.gl|@math\.gl|@loaders\.gl|@probe\.gl|@vis\.gl)[\\/]/, priority: 3 },
              { name: "arrow", test: /node_modules[\\/](apache-arrow|fzstd|flatbuffers|tslib)[\\/]/, priority: 2 },
              { name: "solid", test: /node_modules[\\/](solid-js|vite-plugin-solid|@solidjs)[\\/]/, priority: 1 },
            ],
          },
        },
      },
    },
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
