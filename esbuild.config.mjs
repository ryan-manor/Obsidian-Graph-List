import esbuild from "esbuild";
import { copyFileSync } from "fs";
import { join } from "path";

const prod = process.argv[2] === "production";

const VAULT_PLUGIN_DIR = join(
  process.env.HOME,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/My Vault/.obsidian/plugins/graph-list"
);

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [
    {
      // A release ships main.js, manifest.json and styles.css side by side, so
      // the stylesheet is emitted next to main.js rather than only in src/.
      name: "emit-styles",
      setup(build) {
        build.onEnd(() => copyFileSync("src/styles.css", "styles.css"));
      },
    },
    {
      name: "copy-to-vault",
      setup(build) {
        build.onEnd(() => {
          try {
            copyFileSync("main.js", join(VAULT_PLUGIN_DIR, "main.js"));
            copyFileSync("styles.css", join(VAULT_PLUGIN_DIR, "styles.css"));
            copyFileSync("manifest.json", join(VAULT_PLUGIN_DIR, "manifest.json"));
            console.log("Copied main.js + styles.css + manifest.json to vault plugin dir");
          } catch {
            // Vault dir may not exist yet
          }
        });
      },
    },
  ],
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
