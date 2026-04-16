import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  define: {
    // Inject Web3Auth + Google OAuth credentials at build time.
    // Set GOOGLE_CLIENT_ID and WEB3AUTH_GOOGLE_VERIFIER in env secrets.
    __WEB3AUTH_CLIENT_ID__: JSON.stringify(process.env["WEB3AUTH_CLIENT_ID"] ?? ""),
    __GOOGLE_CLIENT_ID__: JSON.stringify(process.env["GOOGLE_CLIENT_ID"] ?? ""),
    __WEB3AUTH_GOOGLE_VERIFIER__: JSON.stringify(process.env["WEB3AUTH_GOOGLE_VERIFIER"] ?? ""),
    // util@0.12.5 reads process.NODE_DEBUG at module load time; stub it out.
    "process.NODE_DEBUG": "false",
    // WalletConnect (bundled inside @web3auth/no-modal) reads these env vars at chunk
    // load time. We don't use WalletConnect but it's in the bundle, so stub them.
    "process.env.VITE_APP_INFURA_PROJECT_KEY": JSON.stringify(""),
    "import.meta.env.VITE_APP_INFURA_PROJECT_KEY": JSON.stringify(""),
  },
  plugins: [
    nodePolyfills({ globals: { Buffer: true, global: true, process: true }, protocolImports: true }),
    react(),
    tailwindcss(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  optimizeDeps: {
    // Force Vite to pre-bundle the TSS packages so esbuild can transform
    // their webpack-bundled CJS exports to proper ESM named exports.
    // (Without this, Vite serves raw CJS which browsers can't handle.)
    include: ["@toruslabs/tss-dkls-lib", "@toruslabs/tss-frost-lib"],
    esbuildOptions: {
      // Inject a process shim at the TOP of every pre-bundled CJS chunk so that
      // modules like `util@0.12.5` (which read process.env at module init time)
      // never see `process.env` as undefined.
      banner: `
        if (typeof globalThis.process === 'undefined') {
          globalThis.process = { env: {}, nextTick: function(fn) { Promise.resolve().then(fn); }, NODE_DEBUG: false };
        } else {
          if (!globalThis.process.env) globalThis.process.env = {};
          if (typeof globalThis.process.nextTick !== 'function') {
            globalThis.process.nextTick = function(fn) { Promise.resolve().then(fn); };
          }
        }
      `,
      define: {
        "process.env.NODE_DEBUG": "false",
        "process.env.NODE_ENV": JSON.stringify("development"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/jaire": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/mpc": {
        target: "http://localhost:9000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
