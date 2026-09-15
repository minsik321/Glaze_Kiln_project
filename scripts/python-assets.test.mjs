import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { pythonAssets } from "./python-assets.mjs";
test("every browser Python module is emitted with its exact source and resolvable manifest path", async () => {
  const assets = await pythonAssets(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  const manifest = JSON.parse(
    assets.find((a) => a.fileName === "kiln-manifest.json").source,
  );
  assert.ok(manifest.files.includes("kiln/webapp/bridge.py"));
  assert.ok(manifest.files.length > 30);
  for (const file of manifest.files) {
    assert.ok(file.endsWith(".py"));
    const resolved = new URL(
      `${manifest.root}/${file}`,
      "https://example.test/project/kiln-manifest.json",
    );
    const asset = assets.find(
      (a) => "/project/" + a.fileName === resolved.pathname,
    );
    assert.ok(asset, `missing ${file}`);
    assert.ok(Buffer.isBuffer(asset.source));
  }
});
