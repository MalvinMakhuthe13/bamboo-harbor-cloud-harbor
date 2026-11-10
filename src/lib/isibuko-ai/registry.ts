export type ModelRecord = {
  id: string;
  name: string;
  role: string;
  owner: "isibuko" | "opensource";
  license: string;
  status: "active" | "inactive";
  runs: "on-device" | "not-running";
  live: boolean;
  weights: string;
  notes: string;
};

/**
 * What Isibuko actually runs. `live: true` means it executes inside the
 * camera loop. Inactive entries are not a hidden fallback and must not be
 * described as the live experience.
 */
export const MODEL_REGISTRY: ModelRecord[] = [
  {
    id: "isibuko.orchestrator",
    name: "Isibuko frame orchestrator",
    role: "Schedules face, pose, hands and segmentation, and keeps one camera session across product changes.",
    owner: "isibuko",
    license: "Original code in this repository",
    status: "active",
    runs: "on-device",
    live: true,
    weights: "None. Control code only.",
    notes: "Original. Frames are read in the browser and dropped. They are not uploaded.",
  },
  {
    id: "isibuko.composite",
    name: "Isibuko appearance composite",
    role: "Product-conditioned replacement of hair and clothing, with face protection, occlusion and accessory placement.",
    owner: "isibuko",
    license: "Original code in this repository",
    status: "active",
    runs: "on-device",
    live: true,
    weights: "None. The merchant photograph is the product condition.",
    notes: "Original shader and fitters. This is geometric photographic compositing, not a video diffusion model.",
  },
  {
    id: "isibuko.fit",
    name: "Isibuko size fit",
    role: "Turns pose breadth into an ellipse tape and picks a size chart row.",
    owner: "isibuko",
    license: "Original code in this repository",
    status: "active",
    runs: "on-device",
    live: true,
    weights: "None.",
    notes: "Depth is assumed, not measured. The screen says so.",
  },
  {
    id: "mediapipe.face",
    name: "MediaPipe Face Landmarker",
    role: "478 face landmarks for glasses, hair, hats, earrings and identity alignment.",
    owner: "opensource",
    license: "Apache-2.0",
    status: "active",
    runs: "on-device",
    live: true,
    weights: "/models/face_landmarker.task",
    notes: "Google MediaPipe. Integrated, not fine-tuned by Isibuko.",
  },
  {
    id: "mediapipe.pose",
    name: "MediaPipe Pose Landmarker (lite)",
    role: "Body landmarks for garments, watches and size.",
    owner: "opensource",
    license: "Apache-2.0",
    status: "active",
    runs: "on-device",
    live: true,
    weights: "/models/pose_landmarker_lite.task",
    notes: "Google MediaPipe. Lite variant, chosen for a live phone budget.",
  },
  {
    id: "mediapipe.hands",
    name: "MediaPipe Hand Landmarker",
    role: "Finger landmarks so polish replaces the real nail and rings sit on a finger.",
    owner: "opensource",
    license: "Apache-2.0",
    status: "active",
    runs: "on-device",
    live: true,
    weights: "/models/hand_landmarker.task",
    notes: "Google MediaPipe. Integrated, not fine-tuned by Isibuko.",
  },
  {
    id: "mediapipe.segment",
    name: "MediaPipe selfie multiclass segmenter",
    role: "Separates background, hair, body skin, face skin, clothes and other, so replacement does not cover the face.",
    owner: "opensource",
    license: "Apache-2.0",
    status: "active",
    runs: "on-device",
    live: true,
    weights: "/models/selfie_multiclass.tflite",
    notes: "Classes: 0 background, 1 hair, 2 body, 3 face, 4 clothes, 5 other.",
  },
  {
    id: "isibuko.video-diffusion",
    name: "Isibuko generative live video",
    role: "Would synthesise a temporally consistent frame from the shopper and the product.",
    owner: "isibuko",
    license: "Not trained",
    status: "inactive",
    runs: "not-running",
    live: false,
    weights: "None owned.",
    notes: "Not shipped. Needs licensed training pairs and a GPU runtime. The live mirror does not pretend this is running.",
  },
];

export function liveModels(): ModelRecord[] {
  return MODEL_REGISTRY.filter((model) => model.live);
}

/** Measured bytes of the weight files shipped in public/models. */
export const WEIGHT_BYTES = {
  face: 3_758_596,
  pose: 5_777_746,
  hands: 7_819_105,
  segmenter: 16_371_837,
  wasm: 14_603_354,
} as const;
