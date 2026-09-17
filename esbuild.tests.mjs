// Tests import the real modules, so they need bundling before node --test can
// run them. Type-only imports of "obsidian" disappear in the process, which is
// why the matcher is kept free of Obsidian runtime calls.
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tests/mentions.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outdir: "build-tests",
  outExtension: { ".js": ".mjs" },
  external: ["node:*"],
  logLevel: "warning",
});
