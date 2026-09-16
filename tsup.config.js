import { defineConfig } from "tsup";

/**
 * The IIFE build is the product: a customer drops one <script> tag on a page.
 * ESM is published alongside it for bundler users, but the size gate below is
 * what the script tag actually costs a visitor.
 *
 * es2019 rather than esnext: this runs on whatever browsers a customer's
 * audience happens to use, not on whatever ours do.
 */
export default defineConfig([
  {
    entry: { nsl: "src/index.ts" },
    format: ["iife"],
    globalName: "NSLEmbed",
    minify: true,
    sourcemap: true,
    target: "es2019",
    dts: false,
    clean: true,
    outExtension: () => ({ js: ".min.js" }),
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "es2019",
    clean: false,
    outExtension: () => ({ js: ".mjs" }),
  },
]);
