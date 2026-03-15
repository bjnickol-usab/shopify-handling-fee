import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const HOST = process.env.HOST
  ? process.env.HOST.replace(/https?:\/\//, "")
  : "localhost";

let hmrConfig;
if (process.env.NODE_ENV === "development") {
  if (process.env.SHOPIFY_APP_URL) {
    const url = new URL(process.env.SHOPIFY_APP_URL);
    hmrConfig = {
      protocol: "wss",
      host: url.hostname,
      port: parseInt(process.env.FRONTEND_PORT) || 64999,
      clientPort: 443,
    };
  } else {
    hmrConfig = {
      protocol: "ws",
      host: HOST,
      port: parseInt(process.env.FRONTEND_PORT) || 64999,
    };
  }
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {},
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
} satisfies UserConfig);
