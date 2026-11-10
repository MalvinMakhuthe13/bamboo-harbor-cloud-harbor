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
  | "pants";

export type NailShape = "almond" | "square" | "stiletto";

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
  priceZar: number;
  sizes: SizeRow[];
  swatches: Swatch[];
  nail: NailShape;
  custom?: boolean;
  merchantUrl?: string;
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
  /** How often a new face, pose, hand, or mask result arrives. */
  trackFps: number;
  delegate: string;
  source: "camera" | "studio" | "off";
  body: BodyEstimate;
  productId: string | null;
};

export type FrameRequest = {
  productId: string | null;
  category: Category | null;
  image: string | null;
  tint: [number, number, number] | null;
  sizeScale: number;
  nail: NailShape;
  heightCm: number;
};

export type Pt = { x: number; y: number };
