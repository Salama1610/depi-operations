import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const outfile = `/tmp/depi-render-worker-${process.pid}-${Date.now()}.mjs`;
  globalThis.__renderEnv = {};
  await build({
    entryPoints: [new URL("../dist/server/index.js", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    plugins: [
      {
        name: "cloudflare-workers-test-binding",
        setup(context) {
          context.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
            path: "cloudflare:workers",
            namespace: "test-binding",
          }));
          context.onLoad({ filter: /.*/, namespace: "test-binding" }, () => ({
            contents: "export const env=globalThis.__renderEnv",
            loader: "js",
          }));
        },
      },
    ],
  });
  const { default: worker } = await import(`file://${outfile}`);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await response.text(), developmentPreviewMeta);
});
