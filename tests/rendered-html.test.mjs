import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
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
}

test("server-renders the CMPT 310 interface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>CMPT 310 Location AI<\/title>/i);
  assert.match(html, /Predict restaurant location success\./);
  assert.match(html, /CMPT 310 interface/);
  assert.match(html, /Refresh prediction/);
  assert.match(html, /OpenStreetMap location selector/);
  assert.match(html, /Expected Yelp rating/);
  assert.match(html, /Powered by[\s\S]*GitHub training rows/);
  assert.match(html, /A model interface/);
  assert.match(html, /that explains its signal/);
  assert.match(html, /How the project models stack up against each other/);
  assert.match(html, /Charts from the GitHub repository/);
  assert.doesNotMatch(html, /Restaurant success markets|Location contract|Restaurant contract|Discover Trade Settle|prediction markets|market odds/i);
  assert.doesNotMatch(html, /Predicted restaurant performance for this location|Live estimate/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("uses project assets, map package, and removes starter preview code", async () => {
  const templateRoot = new URL("../", import.meta.url);
  const [page, model, modelRows, layout, packageJson, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projectModel.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/model-data/projectModelRows.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /model-assets\/knn_confusion_matrix\.png/);
  assert.match(page, /OpenStreetMap/);
  assert.match(page, /leaflet/);
  assert.match(page, /predictLocation/);
  assert.match(page, /signal-ticker/);
  assert.match(page, /guardrail-section/);
  assert.match(page, /Ridge regression/);
  assert.match(model, /nearestKnnRows/);
  assert.match(model, /reviewDemandArtifact/);
  assert.match(modelRows, /classificationTrainingRows": 1535/);
  assert.match(modelRows, /reviewTrainingRows": 550/);
  assert.match(modelRows, /CMPT310_Project/);
  assert.match(layout, /title:\s*"CMPT 310 Location AI"/);
  assert.match(packageJson, /"leaflet"/);
  assert.match(packageJson, /"lucide-react"/);
  assert.match(styles, /#32302f/);
  assert.match(styles, /#b9c7a8/);
  assert.doesNotMatch(styles, /#f0c94a|240,\s*201,\s*74/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|_sites-preview/);

  await Promise.all([
    access(new URL("../public/model-assets/knn_confusion_matrix.png", import.meta.url)),
    access(new URL("../public/model-assets/knn_performance_vs_k.png", import.meta.url)),
    access(new URL("../public/model-assets/mae_vs_lambda.png", import.meta.url)),
    access(new URL("../public/model-assets/r2_vs_lambda.png", import.meta.url)),
    access(new URL("../public/model-assets/rmse_vs_lambda.png", import.meta.url)),
  ]);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
});
