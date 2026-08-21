import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ["keytar", "node:sqlite", "wrangler", "better-sqlite3", /^better-sqlite3(\/.*)?$/],
      },
    },
  },
  // Sandboxed Electron preload scripts must be CommonJS. Explicitly pin the
  // format because this package uses `type: module`, which otherwise makes
  // electron-vite emit an .mjs preload that Electron refuses to load.
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "chunks/[name]-[hash].cjs",
        },
      },
    },
  },
  renderer: {},
});
