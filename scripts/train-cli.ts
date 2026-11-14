/**
 * Developer commands for a later training run.
 * None of these train, upload, or download weights.
 *
 *   node --experimental-strip-types scripts/train-cli.ts prepare [manifest.json]
 *   node --experimental-strip-types scripts/train-cli.ts synthetic
 *   node --experimental-strip-types scripts/train-cli.ts kaggle-pack
 *   node --experimental-strip-types scripts/train-cli.ts eval [artifact.json]
 *   node --experimental-strip-types scripts/train-cli.ts import <note.json>
 */
import { mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import {
  evalArtifact,
  importArtifact,
  kagglePackList,
  prepareManifest,
  syntheticManifest,
} from "../src/lib/isibuko-gen/train-commands.ts";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const outRoot = join(root, "training", "outputs");

function writeFiles(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    writeFileSync(path, body);
    console.log(`wrote ${path}`);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const [command, arg] = process.argv.slice(2);

if (command === "prepare") {
  const source = arg ?? join(root, "training", "synthetic", "manifest.json");
  if (!existsSync(source)) {
    const manifest = syntheticManifest();
    const dir = join(outRoot, "synthetic");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "manifest.json");
    writeFileSync(path, JSON.stringify(manifest, null, 2));
    console.log(`wrote ${path}`);
    const result = prepareManifest(manifest);
    console.log(result.lines.join("\n"));
    if (result.ok && result.files) writeFiles(join(outRoot, "package"), result.files);
    process.exit(result.ok ? 0 : 1);
  }
  const result = prepareManifest(readJson(source));
  console.log(result.lines.join("\n"));
  if (result.ok && result.files) writeFiles(join(outRoot, "package"), result.files);
  process.exit(result.ok ? 0 : 1);
}

if (command === "synthetic") {
  const manifest = syntheticManifest();
  const dir = join(outRoot, "synthetic");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`wrote ${join(dir, "manifest.json")}`);
  console.log("Synthetic fixture only. It is not trainable and it is not a photograph.");
  process.exit(0);
}

if (command === "kaggle-pack") {
  const dir = join(outRoot, "kaggle-pack");
  mkdirSync(dir, { recursive: true });
  const references = kagglePackList().map((item) => {
    const from = join(root, item.path);
    if (!existsSync(from)) return { ...item, present: false };
    const dest = join(dir, basename(item.path));
    cpSync(from, dest);
    return { ...item, present: true, packed: basename(item.path) };
  });
  writeFileSync(
    join(dir, "DATA_REFERENCES.json"),
    JSON.stringify({ uploaded: false, trained: false, references }, null, 2),
  );
  console.log(`wrote ${dir}`);
  console.log("Pack is local. Nothing was uploaded to Kaggle.");
  process.exit(references.every((item) => item.present) ? 0 : 1);
}

if (command === "eval") {
  const artifact = arg && existsSync(arg) ? readJson(arg) : { id: "none" };
  const result = evalArtifact(artifact);
  console.log(result.lines.join("\n"));
  process.exit(0);
}

if (command === "import") {
  if (!arg) {
    console.error("Pass a JSON note. Weight files are refused.");
    process.exit(1);
  }
  const result = importArtifact(basename(arg), existsSync(arg) ? readJson(arg) : null);
  console.log(result.lines.join("\n"));
  if (result.ok && result.files) writeFiles(join(outRoot, "import"), result.files);
  process.exit(result.ok ? 0 : 1);
}

console.error("Use prepare, synthetic, kaggle-pack, eval, or import.");
process.exit(1);
