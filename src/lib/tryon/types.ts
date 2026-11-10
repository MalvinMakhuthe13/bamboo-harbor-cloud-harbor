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
  | "pants";

export type Material = "silky" | "curly" | "cotton" | "satin" | "metal" | "gloss";

export type WigStyle = "straight" | "bob" | "braids";

export type NailShape = "almond" | "square" | "stiletto";

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

export type ProductAssetViews = {
  front?: string;
  left?: string;
  right?: string;
  back?: string;
};

export type Product = {
  id: string;
  name: string;
  category: Category;
  material: Material;
  color: string;
  blurb: string;
  custom?: boolean;
  style?: WigStyle;
  nailShape?: NailShape;
  sizes: SizeRow[];
  priceZar?: number;
  image?: string;
  /** Real product photographs from distinct angles; not yet rendered as a live 3D fit. */
  assetViews?: ProductAssetViews;
  /** Seller-provided demonstration video for future offline product-motion analysis. */
  motionReferenceVideo?: string;
  /** Seller attests they own or have permission to use the motion reference video. */
  motionReferenceConsent?: boolean;
  sourceUrl?: string;
};

export type TryEvent = {
  id: string;
  at: number;
  productId: string;
  productName: string;
  size: string | null;
  source: "live-scan" | "height-prior";
};

export type Wardrobe = {
  v: 1;
  products: Product[];
  events: TryEvent[];
  heightCm: number;
  headCircCm: number | null;
};

export type TryonState = {
  productId: string;
  category: Category;
  color: string;
  material: Material;
  style: WigStyle;
  nailShape: NailShape;
  wigSize: number;
  wigLift: number;
  hairLength: number;
  sway: number;
  heightCm: number;
  headCircCm: number | null;
  /** The size currently worn. Ease and wrinkles use these ranges, not the suggestion. */
  wornChest: [number, number] | null;
  wornWaist: [number, number] | null;
  wornHip: [number, number] | null;
};

export type MeasureSource = "live-scan" | "height-prior";

export type BodyEstimate = {
  source: MeasureSource;
  scale: number;
  shoulderCm: number | null;
  hipBreadthCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  inseamCm: number | null;
  faceWidthCm: number | null;
  headCircCm: number | null;
  wristCm: number | null;
  fingerCm: number | null;
  notes: string[];
};

export type FitResult = {
  size: string;
  warning: string | null;
  detail: string;
  /** Mean squared distance from each range midpoint, in units of half-range. Lower is closer. */
  score: number;
};

export type LiveMetrics = {
  camera: boolean;
  face: boolean;
  hands: number;
  pose: boolean;
  pinch: boolean;
  grabbed: boolean;
  /** Strands or beads currently pulled. 0 when nothing is held. More than 1 means a section, not the whole piece. */
  section: number;
  fps: number;
  body: BodyEstimate;
};
