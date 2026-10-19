// Tests import the real modules, so they need bundling before node --test can
// run them. The "obsidian" package has types but no runtime code, so the bundle
// swaps it for a small stub that covers what the tested modules touch.
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tests/*.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outdir: "build-tests",
  outExtension: { ".js": ".mjs" },
  external: ["node:*"],
  alias: { obsidian: "./tests/obsidian-stub.ts" },
  logLevel: "warning",
});
