import type { HeadPose } from "./head-pose.ts";

export type Category =
  | "wig"
  | "hat"
  | "nails"
  | "glasses"
  | "earrings"
  | "necklace"
  | "watch"
  | "ring"
  | "shirt"
  | "jacket"
  | "dress"
  | "pants"
  | "skirt"
  | "bracelet";

export type NailShape = "almond" | "square" | "stiletto";
/** Fingers use the hand tracker. Toes use the pose foot point plus a spacing estimate. */
export type NailSite = "fingers" | "toes";
export type NailFinish = "cream" | "gloss";

export type ProductAnchorPoint = { x: number; y: number; confidence?: number };
export type ProductFittingAnchors = {
  version: "isibuko.anchors/1";
  points?: Record<string, ProductAnchorPoint>;
  parameters?: {
    wigOpening?: number;
    wigHoleFraction?: number;
  };
};

export type Swatch = {
  id: string;
  name: string;
  /** Null keeps the photograph. Otherwise RGB 0–1, shading comes from the photo. */
  tint: [number, number, number] | null;
};

export type SizeRow = {
  label: string;
  chest?: [number, number];
  waist?: [number, number];
  shoulder?: [number, number];
  head?: [number, number];
  wrist?: [number, number];
  finger?: [number, number];
  face?: [number, number];
  hip?: [number, number];
};

export type Product = {
  id: string;
  name: string;
  category: Category;
  blurb: string;
  /** Cut-out product photograph. Null for polish, which tints the real nail. */
  image: string | null;
  priceZar?: number | null;
  sizes: SizeRow[];
  swatches: Swatch[];
  nail: NailShape;
  /** Omitted means fingernails. */
  nailSite?: NailSite;
  /** Omitted means gloss. Cream has no extra highlight. */
  nailFinish?: NailFinish;
  custom?: boolean;
  merchantUrl?: string;
  /** Saved for a later checkout. The mirror does not open it and does not take payment. */
  purchaseUrl?: string;
  /** Merchant's own words. Not inferred from the photograph. */
  fabric?: string;
  /** Versioned, reviewed fitting metadata derived from the product asset. */
  fittingAnchors?: ProductFittingAnchors;
  /** Stated by the merchant or the studio sample. Not inferred from the photograph. */
  sleeve?: "sleeveless" | "short" | "long";
  neckline?: "closed" | "open" | "strapless";
  /** A drawing made for testing. Not a merchant photograph. */
  studioSample?: boolean;
};

export type TryEvent = {
  id: string;
  at: number;
  productId: string;
  productName: string;
  size: string | null;
  colour: string;
  source: "camera" | "studio";
};

export type Wardrobe = {
  v: 1;
  products: Product[];
  events: TryEvent[];
  heightCm: number;
};

export type BodyEstimate = {
  source: "live-scan" | "height-prior" | "none";
  shoulderCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  faceWidthCm: number | null;
  headCircCm: number | null;
  wristCm: number | null;
  note: string;
};

export type FitResult = {
  size: string;
  warning: string | null;
  detail: string;
  score: number;
};

export type LiveMetrics = {
  fps: number;
  face: boolean;
  pose: boolean;
  hands: number;
  segment: boolean;
  faceMs: number;
  poseMs: number;
  handMs: number;
  segmentMs: number;
  compositeMs: number;
  /** Smoothed head orientation in degrees, relative to the neutral calibration when set. */
  headPose: HeadPose | null;
  headPoseMs: number;
  /** Latest interval between active render-loop frames. */
  frameIntervalMs: number;
  /** JavaScript work duration for the latest active render-loop frame. */
  frameWorkMs: number;
  meanFrameIntervalMs: number;
  p95FrameIntervalMs: number;
  meanFrameWorkMs: number;
  jankFrames: number;
  longestFrameIntervalMs: number;
  frameSamples: number;
  budgetRung: 0 | 1 | 2 | 3 | null;
  budgetReason: string;
  /** Milliseconds from a product, colour, or size change until that photograph is bound. Null before any change. Zero means the change landed in the same frame. */
  switchMs: number | null;
  /** How often a new face, pose, hand, or mask result arrives. */
  trackFps: number;
  faceHz: number;
  poseHz: number;
  handHz: number;
  segmentHz: number;
  maskAgeMs: number;
  shoulders: boolean;
  elbows: number;
  wrists: number;
  motion: "unknown" | "still" | "moving" | "turning";
  cameraSession: number;
  poseCrop: boolean;
  segmentEdge: number;
  delegate: string;
  delegateNote: string;
  source: "camera" | "studio" | "off";
  body: BodyEstimate;
  productId: string | null;
  /** Animation-frame rate. Independent of the tracker rates. */
  renderFps: number;
  /** Video frames observed per second. Zero on the studio still. */
  cameraFps: number;
  /** Time from the start of this animation frame to the metrics publish. */
  frameLatencyMs: number;
};

export type FrameRequest = {
  productId: string | null;
  category: Category | null;
  image: string | null;
  tint: [number, number, number] | null;
  sizeScale: number;
  nail: NailShape;
  nailSite?: NailSite;
  nailFinish?: NailFinish;
  /** Null means the mirror has no stature. Visual scale follows landmarks, not centimetres. */
  heightCm: number | null;
  fittingAnchors?: ProductFittingAnchors;
  /** Merchant-stated cut. The photograph is not measured to produce this. */
  sleeve?: "sleeveless" | "short" | "long";
  neckline?: "closed" | "open" | "strapless";
};

export type Pt = { x: number; y: number };
