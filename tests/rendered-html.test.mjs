import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

// This checks the Cloudflare Worker bundle, which only exists after
// `npm run build:cloudflare`. The default build is now `next build` for Vercel,
// so the check is skipped rather than failed when that bundle is absent.
const workerBundle = fileURLToPath(new URL("../dist/server/index.js", import.meta.url));
test("renders development preview metadata", { skip: !existsSync(workerBundle) && "no Cloudflare build output" }, async () => {
  const outfile = join(tmpdir(), `depi-render-worker-${process.pid}-${Date.now()}.mjs`);
  globalThis.__renderEnv = {};
  await build({
    entryPoints: [workerBundle],
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
  const { default: worker } = await import(pathToFileURL(outfile).href);

  const rootResponse = await worker.fetch(
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

  assert.equal(rootResponse.status, 307);
  assert.equal(new URL(rootResponse.headers.get("location"), "http://localhost").pathname, "/login");
  const response = await worker.fetch(
    new Request("http://localhost/login", {
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
