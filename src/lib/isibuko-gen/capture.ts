import { emptyRights, rightsProblems, type RightsRecord } from "./rights.ts";
import { FRAME_POLICY } from "../isibuko-ai/privacy.ts";

/**
 * Opt-in capture of tracker numbers.
 * Camera colour frames are refused unless a separate pixel consent is set.
 * Nothing here uploads, trains, or changes FRAME_POLICY.
 */
export type CapturePurpose = "hair-motion" | "garment-drape" | "jewellery" | "nails" | "product-cutout";

export type CaptureConsent = {
  version: "isibuko.capture/1";
  id: string;
  atIso: string;
  landmarks: true;
  segmentation: boolean;
  /** Separate from landmark consent. Default capture must leave this false. */
  pixels: boolean;
  purpose: CapturePurpose;
  rights: RightsRecord;
};

export type LandmarkSample = {
  name: string;
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type SegmentationSummary = {
  /** Class counts only. Not a colour frame. */
  counts: Record<string, number>;
  /** Optional coarse class grid, values 0–5. Not RGB. */
  coarse?: number[];
  coarseWidth?: number;
  coarseHeight?: number;
};

export type CaptureSample = {
  tMs: number;
  category: string;
  landmarks: LandmarkSample[];
  segmentation?: SegmentationSummary;
  pixels?: Uint8Array;
};

export type StoredSample = {
  tMs: number;
  category: string;
  landmarks: LandmarkSample[];
  segmentation?: SegmentationSummary;
};

export function emptyCaptureConsent(id: string, purpose: CapturePurpose): CaptureConsent {
  return {
    version: "isibuko.capture/1",
    id,
    atIso: "",
    landmarks: true,
    segmentation: false,
    pixels: false,
    purpose,
    rights: { ...emptyRights(), consentId: id },
  };
}

export function reviewConsent(consent: CaptureConsent): { ok: true } | { ok: false; reasons: string[] } {
  const reasons = [...rightsProblems(consent.rights)];
  if (consent.version !== "isibuko.capture/1") reasons.push("The capture consent version is not isibuko.capture/1.");
  if (consent.landmarks !== true) reasons.push("Landmark capture was not granted.");
  if (!consent.id.trim()) reasons.push("The consent id is empty.");
  if (consent.rights.consentId && consent.rights.consentId !== consent.id) {
    reasons.push("The consent id does not match the rights record.");
  }
  if (consent.pixels === true && consent.rights.allowsPersonImagery !== true) {
    reasons.push("Pixel capture needs its own person-imagery permission.");
  }
  if (consent.pixels === true && consent.rights.recordKind === "synthetic-fixture") {
    reasons.push("A synthetic fixture does not grant pixel capture.");
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export function acceptSample(
  consent: CaptureConsent,
  sample: CaptureSample,
): { ok: true; stored: StoredSample } | { ok: false; reason: string } {
  if (FRAME_POLICY.leavesDevice !== false || FRAME_POLICY.externalInference !== false) {
    return { ok: false, reason: "Capture refused because the frame policy changed." };
  }
  const consentCheck = reviewConsent(consent);
  if (!consentCheck.ok) return { ok: false, reason: consentCheck.reasons[0] ?? "Consent is incomplete." };
  if (sample.pixels && sample.pixels.byteLength > 0 && consent.pixels !== true) {
    return { ok: false, reason: "A colour frame was attached without separate pixel consent." };
  }
  if (!sample.landmarks.length) return { ok: false, reason: "A sample needs at least one landmark." };
  for (const mark of sample.landmarks) {
    if (!mark.name.trim()) return { ok: false, reason: "A landmark is missing a name." };
    if (mark.x < 0 || mark.x > 1 || mark.y < 0 || mark.y > 1) {
      return { ok: false, reason: `${mark.name} is outside 0–1.` };
    }
  }
  if (sample.segmentation && consent.segmentation !== true) {
    return { ok: false, reason: "Segmentation was attached without segmentation consent." };
  }
  if (sample.segmentation?.coarse) {
    const width = sample.segmentation.coarseWidth ?? 0;
    const height = sample.segmentation.coarseHeight ?? 0;
    if (width * height !== sample.segmentation.coarse.length) {
      return { ok: false, reason: "The coarse class grid does not match its size." };
    }
    if (sample.segmentation.coarse.some((value) => value < 0 || value > 5)) {
      return { ok: false, reason: "The coarse grid must be class ids 0–5, not colours." };
    }
  }
  const stored: StoredSample = {
    tMs: sample.tMs,
    category: sample.category,
    landmarks: sample.landmarks.map((mark) => ({ ...mark })),
  };
  if (sample.segmentation && consent.segmentation) stored.segmentation = sample.segmentation;
  return { ok: true, stored };
}
