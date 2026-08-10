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
  assert.match(html, /Team project interface/);
  assert.match(html, /Refresh prediction/);
  assert.match(html, /OpenStreetMap location selector/);
  assert.match(html, /Expected Yelp rating/);
  assert.match(html, /Success classification/);
  assert.match(html, /Location model results/);
  assert.match(html, /How to use the interface/);
  assert.match(html, /Select the location/);
  assert.match(html, /Adjust the model inputs/);
  assert.match(html, /Refresh and read outputs/);
  assert.match(html, /Ridge regression/);
  assert.match(html, /KNN classifier/);
  assert.match(html, /location-information\.csv/);
  assert.match(html, /yelp-and-demo-info\.csv/);
  assert.match(html, /target_rating/);
  assert.match(html, /target_is_successful/);
  assert.match(html, /Generated input features/);
  assert.match(html, /Feature usage is model-specific/);
  assert.doesNotMatch(html, /Restaurant success markets|Location contract|Restaurant contract|Discover Trade Settle|prediction markets|market odds/i);
  assert.doesNotMatch(html, /Predicted restaurant performance for this location|Live estimate/i);
  assert.doesNotMatch(html, /Aymen|interface task|interface milestone/i);
  assert.doesNotMatch(html, /Predicted review demand|Feature readiness|Success probability/i);
  assert.doesNotMatch(html, /KNN-style estimate|KNN-style nearest-neighbor adapter/i);
  assert.doesNotMatch(
    html,
    /\b(Downtown|Mall|Suburban|Campus)\b|Model comparison|Project visuals|Charts from the GitHub repository/i,
  );
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("uses project data, map package, and removes non-output sections", async () => {
  const templateRoot = new URL("../", import.meta.url);
  const [page, model, modelRows, layout, packageJson, styles, readme] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projectModel.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/model-data/projectModelRows.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /OpenStreetMap/);
  assert.match(page, /leaflet/);
  assert.match(page, /predictLocation/);
  assert.match(page, /projectCategoryLabels/);
  assert.match(page, /ratingTrainingRows/);
  assert.match(page, /instruction-rail/);
  assert.match(page, /target_is_successful/);
  assert.doesNotMatch(page, /signal-ticker|guardrail-section|model-compare-section|visual-section/);
  assert.doesNotMatch(page, /workflow-tab|interface-tabs/);
  assert.doesNotMatch(page, /Predicted review demand|Feature readiness|Success probability/);
  assert.doesNotMatch(page, /KNN-style estimate|KNN-style nearest-neighbor adapter/);
  assert.doesNotMatch(page, /model-assets\//);
  assert.match(model, /nearestKnnRows/);
  assert.match(model, /ridgeRatingArtifact/);
  assert.match(model, /predictRating/);
  assert.match(model, /reviewDemandArtifact/);
  assert.match(model, /projectCategoryLabels/);
  assert.doesNotMatch(model, /predictReviewDemand|calculateFeatureReadiness/);
  assert.match(modelRows, /classificationTrainingRows": 1535/);
  assert.match(modelRows, /ratingTrainingRows": 550/);
  assert.match(modelRows, /ridgeRatingArtifact/);
  assert.match(modelRows, /reviewTrainingRows": 550/);
  assert.match(modelRows, /CMPT310_Project/);
  assert.match(layout, /title:\s*"CMPT 310 Location AI"/);
  assert.match(packageJson, /"leaflet"/);
  assert.match(packageJson, /"lucide-react"/);
  assert.match(styles, /#32302f/);
  assert.match(styles, /#b9c7a8/);
  assert.match(styles, /@keyframes panel-rise/);
  assert.match(styles, /@keyframes phone-scan/);
  assert.match(styles, /@keyframes tab-progress/);
  assert.match(styles, /@keyframes bar-shimmer/);
  assert.doesNotMatch(page + "\n" + styles + "\n" + readme, /Aymen|interface task|interface milestone/i);
  assert.doesNotMatch(styles, /#f0c94a|240,\s*201,\s*74/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|_sites-preview/);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
});
