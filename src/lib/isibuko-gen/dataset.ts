/** Training-pair contract. Validates metadata. It does not store photographs. */

export type Rights = "isibuko-owned" | "commercially-licensed" | "research-only" | "unknown";

export type PoseMark = { name: string; x: number; y: number; visible: boolean };

export type FrameLabel = {
  timestampMs: number;
  personId: string;
  garmentId: string;
  width: number;
  height: number;
  garmentMask: { width: number; height: number; clothesPixels: number };
  pose: PoseMark[];
  occludedByHand: boolean;
};

export type TrainingPair = {
  id: string;
  rights: Rights;
  personId: string;
  garmentId: string;
  fabricNote: string;
  garmentImage: { width: number; height: number };
  frames: FrameLabel[];
};

export type Validation = { ok: boolean; errors: string[] };

const REQUIRED_POSE = ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"];

export function validatePair(pair: TrainingPair): Validation {
  const errors: string[] = [];
  if (pair.rights !== "isibuko-owned" && pair.rights !== "commercially-licensed") {
    errors.push(`Rights "${pair.rights}" cannot enter the commercial training set.`);
  }
  if (!pair.personId || !pair.garmentId) errors.push("Person id and garment id are required.");
  if (!pair.fabricNote.trim()) errors.push("A fabric note is required so colour and material can be checked later.");
  if (pair.garmentImage.width < 64 || pair.garmentImage.height < 64) errors.push("The merchant shirt image is too small.");
  if (pair.frames.length < 8) errors.push("A shirt clip needs at least 8 frames so a turn is not a single still.");
  let previous = -1;
  pair.frames.forEach((frame, index) => {
    if (frame.personId !== pair.personId) errors.push(`Frame ${index} changes person id.`);
    if (frame.garmentId !== pair.garmentId) errors.push(`Frame ${index} changes garment id.`);
    if (frame.timestampMs <= previous) errors.push(`Frame ${index} timestamp is not increasing.`);
    previous = frame.timestampMs;
    if (frame.width < 64 || frame.height < 64) errors.push(`Frame ${index} is below 64px.`);
    if (frame.garmentMask.width !== frame.width || frame.garmentMask.height !== frame.height) {
      errors.push(`Frame ${index} garment mask does not match the frame size.`);
    }
    if (frame.garmentMask.clothesPixels < 16) errors.push(`Frame ${index} garment mask is empty.`);
    for (const name of REQUIRED_POSE) {
      const mark = frame.pose.find((item) => item.name === name);
      if (!mark || !mark.visible) errors.push(`Frame ${index} is missing a visible ${name}.`);
      else if (mark.x < 0 || mark.x > 1 || mark.y < 0 || mark.y > 1) errors.push(`Frame ${index} ${name} is outside the frame.`);
    }
  });
  return { ok: errors.length === 0, errors };
}

function pose(visible = true): PoseMark[] {
  return REQUIRED_POSE.map((name, index) => ({
    name,
    x: 0.3 + (index % 3) * 0.15,
    y: 0.2 + Math.floor(index / 3) * 0.25,
    visible,
  }));
}

function frames(count: number, personId: string, garmentId: string, wrists: boolean): FrameLabel[] {
  return Array.from({ length: count }, (_, index) => ({
    timestampMs: 1000 + index * 80,
    personId,
    garmentId,
    width: 384,
    height: 512,
    garmentMask: { width: 384, height: 512, clothesPixels: 4000 },
    pose: pose(wrists).map((mark) => (mark.name.includes("wrist") && !wrists ? { ...mark, visible: false } : mark)),
    occludedByHand: index === count - 1,
  }));
}

/** Metadata fixture only. Not a photograph and not a generated try-on. */
export function sampleOwnedPair(): TrainingPair {
  return {
    id: "fixture-owned-shirt",
    rights: "isibuko-owned",
    personId: "person-fixture",
    garmentId: "shirt-linen",
    fabricNote: "Sand linen, plain weave, no print.",
    garmentImage: { width: 768, height: 1024 },
    frames: frames(8, "person-fixture", "shirt-linen", true),
  };
}

export function sampleResearchPair(): TrainingPair {
  return {
    ...sampleOwnedPair(),
    id: "fixture-research-shirt",
    rights: "research-only",
    fabricNote: "",
    frames: frames(2, "person-fixture", "shirt-linen", false),
  };
}
