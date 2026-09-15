import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
export async function pythonAssets(root) {
  const assets = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "__pycache__") await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".py")) {
        assets.push({
          fileName:
            "python/" +
            path
              .relative(path.join(root, "src"), full)
              .split(path.sep)
              .join("/"),
          source: await readFile(full),
        });
      }
    }
  }
  await walk(path.join(root, "src/kiln"));
  assets.sort((a, b) => a.fileName.localeCompare(b.fileName));
  assets.push({
    fileName: "kiln-manifest.json",
    source: JSON.stringify({
      root: "./python",
      files: assets.map((a) => a.fileName.slice(7)),
    }),
  });
  return assets;
}
