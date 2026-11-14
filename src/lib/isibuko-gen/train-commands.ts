import { MANIFEST_VERSION, replayMae, validateManifest, type TrainManifest } from "./manifest.ts";
import type { CapturePurpose } from "./capture.ts";
import { emptyCaptureConsent } from "./capture.ts";

export type CommandResult = { ok: true; lines: string[]; files?: Record<string, string> } | { ok: false; lines: string[] };

const TASKS: CapturePurpose[] = ["hair-motion", "garment-drape", "jewellery", "nails", "product-cutout"];

function fixtureConsent(task: CapturePurpose) {
  const consent = emptyCaptureConsent(`synth-${task}`, task);
  consent.atIso = "2026-11-14T00:00:00Z";
  consent.pixels = false;
  consent.segmentation = false;
  consent.rights = {
    ...consent.rights,
    recordKind: "synthetic-fixture",
    rightsBasis: "isibuko-owned",
    rightsHolder: "Isibuko fixture",
    agreementReference: "synthetic-fixture",
    agreementScope: "ai-training",
    commercialTraining: true,
    consentId: consent.id,
    allowsTraining: true,
    allowsPersonImagery: false,
    source: "training/synthetic",
    acquired: "2026-11-14",
    method: "synthetic",
    merchant: "none",
  };
  return consent;
}

function sampleFor(task: CapturePurpose) {
  const landmarks = {
    "hair-motion": [
      { name: "forehead", x: 0.5, y: 0.3 },
      { name: "cheekL", x: 0.42, y: 0.4 },
      { name: "cheekR", x: 0.58, y: 0.4 },
    ],
    "garment-drape": [
      { name: "shoulderL", x: 0.35, y: 0.32 },
      { name: "shoulderR", x: 0.65, y: 0.32 },
      { name: "hipL", x: 0.4, y: 0.62 },
      { name: "hipR", x: 0.6, y: 0.62 },
    ],
    jewellery: [{ name: "anchor", x: 0.4, y: 0.46 }],
    nails: [
      { name: "tip", x: 0.62, y: 0.7 },
      { name: "base", x: 0.6, y: 0.66 },
    ],
    "product-cutout": [{ name: "box", x: 0.5, y: 0.5 }],
  }[task];
  return { tMs: 0, category: task, landmarks };
}

/** A non-trainable manifest. Synthetic fixtures are not admitted to a run. */
export function syntheticManifest(): TrainManifest {
  return {
    version: MANIFEST_VERSION,
    trainable: false,
    rows: TASKS.map((task) => ({
      id: `synth-${task}`,
      task,
      category: task === "jewellery" ? "earrings" : task === "nails" ? "nails" : task === "hair-motion" ? "wig" : "shirt",
      consent: fixtureConsent(task),
      pixelBlob: false,
      samples: [sampleFor(task), { ...sampleFor(task), tMs: 16 }],
      ...(task === "product-cutout" ? { purchaseUrl: "https://shop.example/buy/later" } : {}),
    })),
  };
}

export function prepareManifest(raw: unknown): CommandResult {
  if (!raw || typeof raw !== "object") return { ok: false, lines: ["The manifest is not a JSON object."] };
  const result = validateManifest(raw as TrainManifest);
  if (!result.ok) return { ok: false, lines: ["Manifest refused.", ...result.errors] };
  const manifest = raw as TrainManifest;
  const packed = {
    packagedAt: "local",
    trained: false,
    uploaded: false,
    trainable: manifest.trainable,
    rows: manifest.rows.length,
    manifest,
  };
  return {
    ok: true,
    lines: [
      `Manifest ok. ${manifest.rows.length} row(s). Trainable: ${manifest.trainable}.`,
      "No training was started. No file was uploaded.",
    ],
    files: { "manifest-package.json": JSON.stringify(packed, null, 2) },
  };
}

export function kagglePackList(): { path: string; role: string }[] {
  return [
    { path: "training/kaggle/tune_motion.py", role: "script" },
    { path: "training/kaggle/finetune_cutout.py", role: "script" },
    { path: "training/kaggle/finetune_nails.py", role: "script" },
    { path: "training/kaggle/isibuko-motion-tune.ipynb", role: "notebook" },
    { path: "training/kaggle/isibuko-cutout-classifier.ipynb", role: "notebook" },
    { path: "training/kaggle/isibuko-nail-segment.ipynb", role: "notebook" },
    { path: "training/kaggle/gpu-estimates.json", role: "estimate" },
    { path: "training/synthetic/hair-motion.jsonl", role: "fixture" },
    { path: "training/synthetic/garment-drape.jsonl", role: "fixture" },
    { path: "training/synthetic/jewellery.jsonl", role: "fixture" },
    { path: "training/synthetic/nails.jsonl", role: "fixture" },
    { path: "training/synthetic/product-cutout.jsonl", role: "fixture" },
  ];
}

export function evalArtifact(artifact: unknown): CommandResult {
  const recorded = [0, 0.01, 0.004];
  const replay = [0, 0, 0];
  const mae = replayMae(recorded, replay);
  const name = artifact && typeof artifact === "object" && "id" in artifact ? String((artifact as { id: unknown }).id) : "none";
  return {
    ok: true,
    lines: [
      `Artifact id: ${name}.`,
      "No trained checkpoint is loaded. The score is a fixture replay, not a model score.",
      `Replay mean absolute error on the fixture: ${mae}.`,
      "Renderer stays geometric-composite.",
    ],
  };
}

const WEIGHT_EXT = /\.(pt|pth|safetensors|ckpt|bin|onnx|npz|gguf)$/i;

export function importArtifact(name: string, raw: unknown): CommandResult {
  if (WEIGHT_EXT.test(name)) {
    return { ok: false, lines: [`Refused ${name}. Weight files are not imported and must not be committed.`] };
  }
  if (!raw || typeof raw !== "object") return { ok: false, lines: ["The artifact is not a JSON note."] };
  const receipt = {
    enabled: false,
    fallback: "geometric-composite",
    source: name,
    trained: false,
    note: "Parked only. The live mirror does not load this file.",
    artifact: raw,
  };
  return {
    ok: true,
    lines: ["Artifact parked with the feature flag off. The mirror still uses the geometric composite."],
    files: { "imported-flag.json": JSON.stringify(receipt, null, 2) },
  };
}
