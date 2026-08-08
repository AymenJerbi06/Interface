import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const outputRoot = new URL("../.vercel/output/", import.meta.url);

test("builds a Vercel-compatible Nitro output directory", async () => {
  const config = JSON.parse(
    await readFile(new URL("config.json", outputRoot), "utf8"),
  );
  assert.equal(config.version, 3);
  assert.equal(config.framework?.name, "nitro");
  assert(
    config.routes.some((route) => route.dest === "/__server"),
    "expected all non-static routes to target the Nitro server function",
  );

  const nitroManifest = JSON.parse(
    await readFile(new URL("nitro.json", outputRoot), "utf8"),
  );
  assert.equal(nitroManifest.preset, "vercel");
  assert.equal(nitroManifest.serverEntry, "functions/__server.func/index.mjs");

  const functionConfig = JSON.parse(
    await readFile(
      new URL("functions/__server.func/.vc-config.json", outputRoot),
      "utf8",
    ),
  );
  assert.equal(functionConfig.handler, "index.mjs");
  assert.match(functionConfig.runtime, /^nodejs\d+\.x$/);

  await access(new URL("functions/__server.func/index.mjs", outputRoot));
  await access(new URL("static/", outputRoot));
});
