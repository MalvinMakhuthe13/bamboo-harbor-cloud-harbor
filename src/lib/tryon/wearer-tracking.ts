import { FaceLandmarker, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type WearerTrackingSample = {
  timestampMs: number;
  faceDetected: boolean;
  faceConfidence: number;
  headCenterX: number | null;
  headCenterY: number | null;
  headWidth: number | null;
  /** Landmark-derived yaw proxy. It is not a calibrated angle in radians. */
  headYawProxy: number | null;
  shouldersDetected: boolean;
  shoulderCenterX: number | null;
  shoulderCenterY: number | null;
  shoulderSpan: number | null;
};

export type WearerTrackers = {
  detect: (bitmap: ImageBitmap, timestampMs: number) => WearerTrackingSample;
  close: () => void;
};

export async function createWearerTrackers(): Promise<WearerTrackers> {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const face = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  let pose: PoseLandmarker;
  try {
    pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  } catch (error) {
    face.close();
    throw error;
  }

  let previousTimestamp = -1;
  return {
    detect(bitmap, timestampMs) {
      const safeTimestamp = Math.max(previousTimestamp + 1, Math.round(timestampMs));
      previousTimestamp = safeTimestamp;
      const faceResult = face.detectForVideo(bitmap, safeTimestamp);
      const landmarks = faceResult.faceLandmarks[0];
      let faceSample: Pick<WearerTrackingSample,
        "faceDetected" | "faceConfidence" | "headCenterX" | "headCenterY" | "headWidth" | "headYawProxy"
      > = {
        faceDetected: false,
        faceConfidence: 0,
        headCenterX: null,
        headCenterY: null,
        headWidth: null,
        headYawProxy: null,
      };

      if (landmarks && landmarks.length > 454) {
        const left = landmarks[234];
        const right = landmarks[454];
        const nose = landmarks[1];
        const width = Math.hypot(right.x - left.x, right.y - left.y);
        if (Number.isFinite(width) && width > 0) {
          const centerX = (left.x + right.x) / 2;
          const centerY = (left.y + right.y) / 2;
          faceSample = {
            faceDetected: true,
            faceConfidence: 1,
            headCenterX: centerX,
            headCenterY: centerY,
            headWidth: width,
            headYawProxy: (nose.x - centerX) / width,
          };
        }
      }

      const poseResult = pose.detectForVideo(bitmap, safeTimestamp);
      const poseLandmarks = poseResult.landmarks[0];
      let shoulderSample: Pick<WearerTrackingSample,
        "shouldersDetected" | "shoulderCenterX" | "shoulderCenterY" | "shoulderSpan"
      > = {
        shouldersDetected: false,
        shoulderCenterX: null,
        shoulderCenterY: null,
        shoulderSpan: null,
      };
      if (poseLandmarks && poseLandmarks.length > 12) {
        const left = poseLandmarks[11];
        const right = poseLandmarks[12];
        const visibility = Math.min(left.visibility ?? 0, right.visibility ?? 0);
        const span = Math.hypot(right.x - left.x, right.y - left.y);
        if (visibility >= 0.35 && Number.isFinite(span) && span > 0) {
          shoulderSample = {
            shouldersDetected: true,
            shoulderCenterX: (left.x + right.x) / 2,
            shoulderCenterY: (left.y + right.y) / 2,
            shoulderSpan: span,
          };
        }
      }

      return { timestampMs: safeTimestamp, ...faceSample, ...shoulderSample };
    },
    close() {
      face.close();
      pose.close();
    },
  };
}
