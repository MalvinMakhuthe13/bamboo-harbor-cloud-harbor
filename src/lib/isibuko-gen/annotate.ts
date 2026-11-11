export const TRAINING_CATEGORIES = ["shirt", "jacket", "dress", "pants"] as const;
export const FUTURE_CATEGORIES = ["skirt", "shoes", "bag", "wig", "jewellery", "glasses", "accessory"] as const;
export const PARTS = ["collar", "sleeve", "hem", "straps", "legs"] as const;

export type PartName = (typeof PARTS)[number];
export type Point = [number, number];

export type PartMark = {
  present: boolean | null;
  kind: "polygon" | "box" | "absent" | null;
  polygon: Point[] | null;
  box: [number, number, number, number] | null;
  confidence: number | null;
  side: "left" | "right" | "both" | null;
};

export type AnnotationSample = {
  sampleId: string;
  sku: string;
  imageName: string;
  assetHash: string;
  width: number;
  height: number;
  category: string | null;
  futureCategory: string | null;
  trainingLabel: boolean;
  parts: Record<PartName, PartMark>;
  garmentPolygon: Point[] | null;
  merchant: { fabric: string; colours: string[]; pattern: string | null; visuallyDetected: false };
  visual: { logosDetected: false; patternDetected: false; materialDetected: false };
  confidence: number;
  annotator: string;
  reviewer: string;
  split: "train" | "val" | "test" | null;
  licence: string | null;
  commercialUse: boolean | null;
  consent: { consentId: string; rights: string; allowsTraining: boolean; allowsPersonImagery: boolean | null } | null;
  provenance: { source: string; acquired: string; origin: string } | null;
};

export type AnnotationSession = { version: 1; samples: AnnotationSample[] };

const emptyPart = (): PartMark => ({
  present: null,
  kind: null,
  polygon: null,
  box: null,
  confidence: null,
  side: null,
});

export function emptySession(): AnnotationSession {
  return { version: 1, samples: [] };
}

export function importSample(session: AnnotationSession, input: { sampleId: string; sku: string; imageName: string; assetHash: string; width: number; height: number }): AnnotationSample {
  const parts = Object.fromEntries(PARTS.map((name) => [name, emptyPart()])) as Record<PartName, PartMark>;
  const sample: AnnotationSample = {
    sampleId: input.sampleId,
    sku: input.sku,
    imageName: input.imageName,
    assetHash: input.assetHash,
    width: input.width,
    height: input.height,
    category: null,
    futureCategory: null,
    trainingLabel: false,
    parts,
    garmentPolygon: null,
    merchant: { fabric: "", colours: [], pattern: null, visuallyDetected: false },
    visual: { logosDetected: false, patternDetected: false, materialDetected: false },
    confidence: 0,
    annotator: "",
    reviewer: "",
    split: null,
    licence: null,
    commercialUse: null,
    consent: null,
    provenance: null,
  };
  session.samples.push(sample);
  return sample;
}

export function setCategory(sample: AnnotationSample, name: string) {
  if ((TRAINING_CATEGORIES as readonly string[]).includes(name)) {
    sample.category = name;
    sample.futureCategory = null;
    sample.trainingLabel = true;
    return;
  }
  if ((FUTURE_CATEGORIES as readonly string[]).includes(name)) {
    sample.category = null;
    sample.futureCategory = name;
    sample.trainingLabel = false;
    return;
  }
  throw new Error(`${name} is not a known category.`);
}

function inside(point: Point, sample: AnnotationSample) {
  return point[0] >= 0 && point[1] >= 0 && point[0] < sample.width && point[1] < sample.height;
}

export function addPoint(sample: AnnotationSample, part: PartName, point: Point) {
  if (!inside(point, sample)) throw new Error("Point is outside the image.");
  const mark = sample.parts[part];
  mark.present = true;
  mark.kind = "polygon";
  mark.polygon = [...(mark.polygon ?? []), point];
  mark.box = null;
}

export function closePolygon(sample: AnnotationSample, part: PartName) {
  const polygon = sample.parts[part].polygon;
  if (!polygon || polygon.length < 3) throw new Error("A polygon needs at least three points.");
  sample.parts[part].present = true;
  sample.parts[part].kind = "polygon";
}

export function setBox(sample: AnnotationSample, part: PartName, box: [number, number, number, number]) {
  const [x, y, width, height] = box;
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > sample.width || y + height > sample.height) {
    throw new Error("Box is outside the image.");
  }
  sample.parts[part] = { ...sample.parts[part], present: true, kind: "box", box, polygon: null };
}

export function markAbsent(sample: AnnotationSample, part: PartName) {
  sample.parts[part] = { present: false, kind: "absent", polygon: null, box: null, confidence: sample.parts[part].confidence, side: null };
}

export function setPartConfidence(sample: AnnotationSample, part: PartName, confidence: number) {
  if (confidence < 0 || confidence > 1) throw new Error("Confidence must be between 0 and 1.");
  sample.parts[part].confidence = confidence;
}

export function movePoint(sample: AnnotationSample, part: PartName, index: number, point: Point) {
  const polygon = sample.parts[part].polygon;
  if (!polygon || !polygon[index]) throw new Error("Point does not exist.");
  if (!inside(point, sample)) throw new Error("Point is outside the image.");
  polygon[index] = point;
}

export function removePartGeometry(sample: AnnotationSample, part: PartName) {
  sample.parts[part] = { ...emptyPart(), confidence: sample.parts[part].confidence };
}

export function setGarmentPolygon(sample: AnnotationSample, polygon: Point[]) {
  if (polygon.length < 3 || polygon.some((point) => !inside(point, sample))) throw new Error("Garment polygon is invalid.");
  sample.garmentPolygon = polygon;
}

export function missingParts(sample: AnnotationSample) {
  return PARTS.filter((name) => sample.parts[name].present === null);
}

export function sessionJson(session: AnnotationSession) {
  return JSON.stringify(session);
}

export function sessionFromJson(text: string): AnnotationSession {
  const session = JSON.parse(text) as AnnotationSession;
  if (session.version !== 1 || !Array.isArray(session.samples)) throw new Error("Annotation session is not readable.");
  return session;
}
