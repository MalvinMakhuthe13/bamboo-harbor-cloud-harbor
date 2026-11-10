import * as THREE from "three";
import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type { LiveMetrics, Material, NailShape, TryonState, WigStyle } from "@/lib/tryon/types";
import { estimateFromPose, PINCH_MAX, priorFromHeight, round1 } from "@/lib/tryon/math";
import {
  CAT_EYE_ROLL,
  angleDeltaRadians,
  bodyMotionAcceleration,
  CONSTRAINT_PASSES,
  EAR_SWING_X,
  EAR_SWING_Z,
  FINGER_LENGTH_TO_BREADTH,
  GRAB_LERP,
  GRAB_RADIUS_NORM,
  GRAVITY_CM_S2,
  HAND_Z_TO_CM,
  NAIL_SETBACK_CM,
  NECKLACE_BEADS,
  NECKLACE_SEGMENT_CM,
  NECKLACE_STIFFNESS,
  POSE_Z_TO_CM,
  SECTION_FOLLOW,
  VERLET_DAMP,
  constraintBlend,
  clothWrinkleCm,
  fingerFromPalm,
  foldAmplitudeCm,
  frameDeltaSeconds,
  updatePinchState,
  trackingBlend,
  garmentEase,
  glassesScale,
  hairDropCm,
  hairSectionInfluence,
  hairStrandDamping,
  resolveEllipsoidContact,
  hairStiffness,
  headFromFace,
  kneeBendAmount,
  nailScale,
  ribbonWidthCm,
  ringScale,
  sectionWeights,
  shinRadiusCm,
  stepPendulum,
  stableHairJitter,
  thighRadiusCm,
  watchScale,
  wristFromPalm,
  type EaseRead,
} from "@/lib/tryon/physics";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const SHIRT_ROWS = 9;
const SHIRT_COLS = 7;
const SHIRT_VERTS = SHIRT_ROWS * SHIRT_COLS * 2;
const ROW_T = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 1.02, 1.2];

type VNode = { pos: THREE.Vector3; prev: THREE.Vector3 };
type Strand = {
  local: THREE.Vector3;
  lengthMul: number;
  nodes: VNode[];
  ready: boolean;
  influence: number;
  geo: THREE.BufferGeometry;
  mesh: THREE.Mesh;
};
type Finger = { tip: THREE.Vector3; base: THREE.Vector3; ready: boolean };

export type EngineHandle = {
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  dispose: () => void;
};

export function startEngine(opts: {
  stage: HTMLElement;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  getState: () => TryonState;
  onMetrics: (metrics: LiveMetrics) => void;
  onStatus: (status: string) => void;
}): EngineHandle {
  const { stage, video, canvas, getState, onMetrics, onStatus } = opts;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(63, 9 / 16, 1, 2000);
  scene.add(new THREE.AmbientLight(0xfff4e8, 0.72));
  const key = new THREE.DirectionalLight(0xffe2c4, 1.15);
  key.position.set(18, 40, 30);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc4a574, 0.45);
  rim.position.set(-20, 10, -10);
  scene.add(rim);

  const backdrop = new THREE.Color("#14110e");

  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x1a1210,
    roughness: 0.34,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.72, metalness: 0.04 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x3a2e28, roughness: 0.78, metalness: 0 });
  const clothMat = new THREE.MeshStandardMaterial({
    color: 0xe7d7c3,
    roughness: 0.82,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.22, metalness: 0.82 });
  const nailMat = new THREE.MeshStandardMaterial({ color: 0xf4ece4, roughness: 0.18, metalness: 0.45 });
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false });

  const capGroup = new THREE.Group();
  scene.add(capGroup);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), capMat);
  cap.scale.set(8.4, 6.2, 9.4);
  cap.position.set(0, 5.6, -2.4);
  capGroup.add(cap);

  const hat = new THREE.Mesh(new THREE.SphereGeometry(8, 28, 16), capMat);
  hat.scale.set(1.2, 0.42, 1.2);
  scene.add(hat);

  const occ = new THREE.Group();
  scene.add(occ);
  const occHead = new THREE.Mesh(new THREE.SphereGeometry(7.6, 24, 18), occMat);
  occHead.position.set(0, 1.2, -1.5);
  const occNeck = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 12, 16), occMat);
  occNeck.position.set(0, -10, -1);
  occ.renderOrder = -1;
  occ.add(occHead, occNeck);

  const bust = new THREE.Group();
  scene.add(bust);
  const bustHead = new THREE.Mesh(new THREE.SphereGeometry(7.4, 28, 18), skinMat);
  const bustNeck = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.2, 10, 16), skinMat);
  bustNeck.position.set(0, -11, 0);
  const bustTorso = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), skinMat);
  bust.add(bustHead, bustNeck, bustTorso);

  const pinchDot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), metalMat);
  pinchDot.visible = false;
  scene.add(pinchDot);

  const glasses = new THREE.Group();
  scene.add(glasses);
  const lensGeo = new THREE.TorusGeometry(2.15, 0.16, 8, 22);
  const lensL = new THREE.Mesh(lensGeo, metalMat);
  const lensR = new THREE.Mesh(lensGeo, metalMat);
  lensL.position.set(-3.3, 1.4, 7.2);
  lensR.position.set(3.3, 1.4, 7.2);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.18), metalMat);
  bridge.position.set(0, 1.5, 7.2);
  const templeL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 7), metalMat);
  const templeR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 7), metalMat);
  templeL.position.set(-5.2, 1.5, 3.6);
  templeR.position.set(5.2, 1.5, 3.6);
  glasses.add(lensL, lensR, bridge, templeL, templeR);

  const earringL = new THREE.Group();
  const earringR = new THREE.Group();
  scene.add(earringL, earringR);
  for (const group of [earringL, earringR]) {
    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), metalMat);
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), metalMat);
    drop.position.set(0, -2.3, 0);
    group.add(stud, drop);
  }

  const neckBeads: THREE.Mesh[] = [];
  const neckNodes: VNode[] = [];
  for (let i = 0; i < NECKLACE_BEADS; i++) {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), metalMat);
    scene.add(bead);
    neckBeads.push(bead);
    neckNodes.push({ pos: new THREE.Vector3(), prev: new THREE.Vector3() });
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.16, 8, 18), metalMat);
  scene.add(ring);

  const watch = new THREE.Group();
  scene.add(watch);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.32, 8, 18), metalMat);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.4, 20), clothMat);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0, 0.15, 0);
  watch.add(strap, dial);

  const nailMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), nailMat);
    mesh.visible = false;
    scene.add(mesh);
    nailMeshes.push(mesh);
  }

  const shirtGeo = buildShirtGeometry();
  const shirt = new THREE.Mesh(shirtGeo, clothMat);
  shirt.frustumCulled = false;
  scene.add(shirt);
  const sleeveL = tube();
  const sleeveR = tube();
  sleeveL.material = clothMat;
  sleeveR.material = clothMat;
  scene.add(sleeveL, sleeveR);

  const pantMat = clothMat.clone();
  const thighL = tube();
  const thighR = tube();
  const shinL = tube();
  const shinR = tube();
  const seat = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), pantMat);
  const kneePadL = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pantMat);
  const kneePadR = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pantMat);
  for (const mesh of [thighL, thighR, shinL, shinR, seat, kneePadL, kneePadR]) {
    mesh.material = pantMat;
    scene.add(mesh);
  }

  const fingers: Finger[] = Array.from({ length: 10 }, () => ({
    tip: new THREE.Vector3(),
    base: new THREE.Vector3(),
    ready: false,
  }));

  let strands: Strand[] = [];
  let strandStyle: WigStyle | null = null;
  let nailShape: NailShape | null = null;
  let poseWorldHold: { x: number; y: number; z: number }[] | null = null;
  let poseImageHold: { x: number; y: number; z: number; visibility: number }[] | null = null;
  let poseSeen = 0;
  let faceTransformReady = false;
  let faceWidthHold: number | null = null;
  let wristHold: number | null = null;
  let fingerHold: number | null = null;
  let sectionNow = 0;
  let clothGrab = -1;
  let clothPhase = 0;
  let nailGeo: THREE.BufferGeometry | null = null;

  const headPos = new THREE.Vector3(0, 8, -74);
  const headQuat = new THREE.Quaternion();
  const faceTargetPos = new THREE.Vector3();
  const faceTargetQuat = new THREE.Quaternion();
  const hipQuat = new THREE.Quaternion();
  const prevQuat = new THREE.Quaternion();
  let swing = 0;
  let swingVel = 0;
  let prevYaw = 0;
  let bodyMotionStamp = 0;
  let bodyMotionReady = false;
  const previousBodyMid = new THREE.Vector3();
  const previousBodyVelocity = new THREE.Vector3();
  const bodyAcceleration = new THREE.Vector3();

  let cameraOn = false;
  let faceOn = false;
  let poseOn = false;
  let handCount = 0;
  let lastHandSeen = 0;
  let pinch = false;
  let grabbed = false;
  let grabStrand = -1;
  let grabJoint = -1;
  const lastPinchWorld = new THREE.Vector3();
  const pinchFrameVelocity = new THREE.Vector3();
  let pinchWorldReady = false;
  let neckGrab = -1;
  let disposed = false;
  let axesLocked = false;
  let ySign = 1;
  let zSign = 1;
  let lastVideo = -1;
  let stamp = 0;
  let frames = 0;
  let fps = 0;
  let fpsT = performance.now();
  let lastFrameTime: number | null = null;
  let metricT = 0;
  let faceLandmarker: FaceLandmarker | null = null;
  let handLandmarker: HandLandmarker | null = null;
  let poseLandmarker: PoseLandmarker | null = null;
  let stream: MediaStream | null = null;

  const tmp = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const side = new THREE.Vector3();
  const prevSide = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const euler = new THREE.Euler();
  const neckRoot = new THREE.Vector3();
  const shL = new THREE.Vector3();
  const shR = new THREE.Vector3();
  const hipL = new THREE.Vector3();
  const hipR = new THREE.Vector3();
  const kneeL = new THREE.Vector3();
  const kneeR = new THREE.Vector3();
  const ankL = new THREE.Vector3();
  const ankR = new THREE.Vector3();
  const wristPos = new THREE.Vector3();
  const wristDir = new THREE.Vector3();
  const rowL = new THREE.Vector3();
  const rowR = new THREE.Vector3();
  const clothPt = new THREE.Vector3();
  const sleeveEnd = new THREE.Vector3();
  const prevTorso = new THREE.Vector3();
  const shirtOff = new Float32Array(SHIRT_VERTS * 3);
  const shirtPull = new Float32Array(SHIRT_VERTS);
  const shirtTargets = Array.from({ length: SHIRT_VERTS }, () => new THREE.Vector3());

  onStatus("Mannequin is up. Trackers are loading.");
  void bootTrackers();

  function nextStamp() {
    stamp = Math.max(stamp + 1, performance.now());
    return stamp;
  }

  async function bootTrackers() {
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      if (disposed) return;
      faceLandmarker = await makeFace(fileset);
      if (disposed) return;
      onStatus(cameraOn ? "Face lock is ready. Hands and body are still loading." : "Face tracker ready. You can open the camera.");
      handLandmarker = await makeHand(fileset);
      if (disposed) return;
      poseLandmarker = await makePose(fileset);
      if (disposed) return;
      onStatus(cameraOn ? "Look at the camera. Pinch a strand to pull it." : "Trackers ready. Open the camera when you want a live fit.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tracker download failed";
      onStatus(`Trackers did not start (${message}). The mannequin still runs.`);
    }
  }

  function layout() {
    const W = stage.clientWidth || 1;
    const H = stage.clientHeight || 1;
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const fit = Math.max(W / vw, H / vh);
    const dw = vw * fit;
    const dh = vh * fit;
    canvas.style.width = `${dw}px`;
    canvas.style.height = `${dh}px`;
    canvas.style.left = `${(W - dw) / 2}px`;
    canvas.style.top = `${(H - dh) / 2}px`;
    renderer.setSize(dw, dh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
  }

  function loop(now: number) {
    if (disposed) return;
    requestAnimationFrame(loop);
    const dt = frameDeltaSeconds(now, lastFrameTime);
    lastFrameTime = now;
    frames += 1;
    if (now - fpsT > 500) {
      fps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0;
      fpsT = now;
    }

    const state = getState();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const time = reduce ? 0 : now / 1000;

    let faceWidth: number | null = null;
    let wristCm: number | null = null;
    let fingerCm: number | null = null;
    const poseWorld = poseWorldHold;
    const poseImage = poseImageHold;
    let liveHands: { x: number; y: number; z: number }[][] = [];
    let freshFrame = false;

    if (cameraOn && video.readyState >= 2 && video.currentTime !== lastVideo) {
      freshFrame = true;
      lastVideo = video.currentTime;
      if (faceLandmarker) {
        try {
          const res = faceLandmarker.detectForVideo(video, nextStamp());
          const matrix = res.facialTransformationMatrixes?.[0];
          const marks = res.faceLandmarks?.[0];
          if (matrix && marks) {
            const m = new THREE.Matrix4().fromArray(matrix.data);
            const sc = new THREE.Vector3();
            m.decompose(faceTargetPos, faceTargetQuat, sc);
            if (Math.abs(faceTargetPos.z) < 5) faceTargetPos.multiplyScalar(100);
            if (!faceTransformReady) {
              headPos.copy(faceTargetPos);
              headQuat.copy(faceTargetQuat);
              faceTransformReady = true;
            } else {
              const blend = trackingBlend(dt, 16);
              headPos.lerp(faceTargetPos, blend);
              headQuat.slerp(faceTargetQuat, blend);
            }
            faceOn = true;
            const left = marks[234];
            const right = marks[454];
            if (left && right) {
              const a = normToWorld(left.x, left.y, headPos.z);
              const b = normToWorld(right.x, right.y, headPos.z);
              faceWidth = a.distanceTo(b);
            }
          } else {
            faceOn = false;
          }
        } catch {
          faceOn = false;
        }
      }
      if (handLandmarker) {
        try {
          const res = handLandmarker.detectForVideo(video, nextStamp());
          liveHands = res.landmarks ?? [];
          handCount = liveHands.length;
        } catch {
          handCount = 0;
          liveHands = [];
        }
      }
      if (poseLandmarker) {
        const poseSlot = Math.floor(now / 32) % 2 === 0;
        if (poseSlot) {
          try {
            const res = poseLandmarker.detectForVideo(video, nextStamp());
            if (res.worldLandmarks?.[0] && res.landmarks?.[0] && res.worldLandmarks[0].length >= 29) {
              const blend = trackingBlend(dt, 10);
              const world = res.worldLandmarks[0];
              const image = res.landmarks[0];
              if (!poseWorldHold || poseWorldHold.length !== world.length) {
                poseWorldHold = world.map((point) => ({ ...point }));
                poseImageHold = image.map((point) => ({ ...point }));
              } else {
                poseWorldHold = world.map((point, index) => {
                  const previous = poseWorldHold![index];
                  return {
                    x: previous.x + (point.x - previous.x) * blend,
                    y: previous.y + (point.y - previous.y) * blend,
                    z: previous.z + (point.z - previous.z) * blend,
                  };
                });
                poseImageHold = image.map((point, index) => {
                  const previous = poseImageHold![index];
                  return {
                    x: previous.x + (point.x - previous.x) * blend,
                    y: previous.y + (point.y - previous.y) * blend,
                    z: previous.z + (point.z - previous.z) * blend,
                    visibility: previous.visibility + (point.visibility - previous.visibility) * blend,
                  };
                });
              }
              poseSeen = now;
            }
            res.close?.();
          } catch {
            poseSeen = 0;
          }
        }
      }
    }

    poseOn = cameraOn && Boolean(poseWorldHold && now - poseSeen < 500);

    if (!cameraOn) {
      const yaw = reduce ? 0.25 : Math.sin(time * 0.55) * 0.55;
      const pitch = reduce ? 0 : Math.sin(time * 0.32) * 0.05;
      euler.set(pitch, yaw, 0);
      headQuat.setFromEuler(euler);
      euler.set(pitch * 0.25, yaw * 0.58, Math.sin(time * 0.7) * 0.06);
      hipQuat.setFromEuler(euler);
      headPos.set(0, 8, -74);
      faceOn = false;
      faceTransformReady = false;
    }

    const yawNow = Math.atan2(
      2 * (headQuat.w * headQuat.y + headQuat.x * headQuat.z),
      1 - 2 * (headQuat.y * headQuat.y + headQuat.z * headQuat.z),
    );
    const yawDelta = angleDeltaRadians(yawNow, prevYaw);
    prevYaw = yawNow;
    const swung = stepPendulum(swing, swingVel, yawDelta, dt);
    swing = swung.swing;
    swingVel = swung.vel;

    if (!cameraOn) {
      applyBustLocal(shL, -16, -18, 0);
      applyBustLocal(shR, 16, -18, 0);
      applyHipLocal(hipL, -11, -52, 2);
      applyHipLocal(hipR, 11, -52, 2);
      applyHipLocal(kneeL, -10, -76, 12);
      applyHipLocal(kneeR, 10, -76, 12);
      applyHipLocal(ankL, -10, -102, 2);
      applyHipLocal(ankR, 10, -102, 2);
      poseMannequinFingers();
    }

    if (poseOn && poseWorld && poseImage) {
      if (!axesLocked) {
        const shY = (poseWorld[11].y + poseWorld[12].y) / 2;
        const hipY = (poseWorld[23].y + poseWorld[24].y) / 2;
        ySign = shY >= hipY ? 1 : -1;
        const hipZ = (poseWorld[23].z + poseWorld[24].z) / 2;
        zSign = poseWorld[0].z >= hipZ ? 1 : -1;
        axesLocked = true;
      }
      const baseZ = (faceOn ? headPos.z : -74) - 6;
      const put = (index: number, target: THREE.Vector3) => {
        const img = poseImage![index];
        const dz = (poseWorld![index].z - poseWorld![11].z) * zSign * POSE_Z_TO_CM;
        target.copy(normToWorld(img.x, img.y, baseZ + dz));
      };
      put(11, shL);
      put(12, shR);
      put(23, hipL);
      put(24, hipR);
      put(25, kneeL);
      put(26, kneeR);
      put(27, ankL);
      put(28, ankR);
    }

    if (poseOn && poseSeen > bodyMotionStamp) {
      const bodyMid = tmp.copy(shL).add(shR).multiplyScalar(0.5)
        .add(tmpB.copy(hipL).add(hipR).multiplyScalar(0.5)).multiplyScalar(0.5);
      if (bodyMotionReady) {
        const elapsed = Math.max(1 / 120, Math.min(0.2, (poseSeen - bodyMotionStamp) / 1000));
        const velocity = tmpC.subVectors(bodyMid, previousBodyMid).multiplyScalar(1 / elapsed);
        const acceleration = bodyMotionAcceleration(previousBodyVelocity, velocity, elapsed, 180);
        bodyAcceleration.lerp(new THREE.Vector3(acceleration.x, acceleration.y, acceleration.z), 0.35);
        previousBodyVelocity.copy(velocity);
      } else {
        previousBodyVelocity.set(0, 0, 0);
        bodyMotionReady = true;
      }
      previousBodyMid.copy(bodyMid);
      bodyMotionStamp = poseSeen;
    } else if (!poseOn) {
      bodyAcceleration.multiplyScalar(0.88);
      if (bodyAcceleration.lengthSq() < 0.04) bodyAcceleration.set(0, 0, 0);
    }

    if (cameraOn && freshFrame && liveHands.length) {
      const depth = faceOn ? headPos.z : -68;
      liveHands.forEach((hand, handIndex) => {
        if (handIndex > 1 || hand.length < 21) return;
        const tips = [4, 8, 12, 16, 20];
        const bases = [2, 5, 9, 13, 17];
        for (let f = 0; f < 5; f++) {
          const slot = fingers[handIndex * 5 + f];
          const tip = hand[tips[f]];
          const base = hand[bases[f]];
          const targetTip = normToWorld(tip.x, tip.y, depth - tip.z * HAND_Z_TO_CM);
          const targetBase = normToWorld(base.x, base.y, depth - base.z * HAND_Z_TO_CM);
          if (!slot.ready) {
            slot.tip.copy(targetTip);
            slot.base.copy(targetBase);
            slot.ready = true;
          } else {
            const blend = trackingBlend(dt, 20);
            slot.tip.lerp(targetTip, blend);
            slot.base.lerp(targetBase, blend);
          }
        }
      });
      lastHandSeen = now;
      const palms: number[] = [];
      const fingersW: number[] = [];
      let pinchDistance = Number.POSITIVE_INFINITY;
      let pinchPoint: { x: number; y: number; z: number } | null = null;
      for (const hand of liveHands) {
        if (hand.length < 21) continue;
        const a = normToWorld(hand[5].x, hand[5].y, faceOn ? headPos.z : -68);
        const b = normToWorld(hand[17].x, hand[17].y, faceOn ? headPos.z : -68);
        const palm = a.distanceTo(b);
        if (palm > 2 && palm < 18) {
          palms.push(wristFromPalm(palm));
          fingersW.push(fingerFromPalm(palm));
        }
        const d = Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y, hand[4].z - hand[8].z);
        pinchDistance = Math.min(pinchDistance, d);
        if (d < PINCH_MAX * 1.5) {
          pinchPoint = {
            x: (hand[4].x + hand[8].x) / 2,
            y: (hand[4].y + hand[8].y) / 2,
            z: (faceOn ? headPos.z : -68) - hand[8].z * HAND_Z_TO_CM,
          };
        }
      }
      const wasPinching = pinch;
      pinch = updatePinchState(pinch, pinchDistance);
      if (pinch && pinchPoint) {
        pinchDot.position.copy(normToWorld(pinchPoint.x, pinchPoint.y, pinchPoint.z));
        if (pinchWorldReady) {
          pinchFrameVelocity.subVectors(pinchDot.position, lastPinchWorld);
          const speed = pinchFrameVelocity.length();
          if (speed > 3.5) pinchFrameVelocity.multiplyScalar(3.5 / speed);
        } else {
          pinchFrameVelocity.set(0, 0, 0);
          pinchWorldReady = true;
        }
        lastPinchWorld.copy(pinchDot.position);
        pinchDot.visible = true;
        if (!wasPinching) tryGrab(pinchPoint.x, pinchPoint.y, pinchPoint.z);
      } else if (!pinch) {
        pinchDot.visible = false;
        releaseGrab();
      }
      if (palms.length) wristCm = palms.reduce((s, n) => s + n, 0) / palms.length;
      if (fingersW.length) fingerCm = fingersW.reduce((s, n) => s + n, 0) / fingersW.length;
      wristPos.copy(fingers[1].base);
      wristDir.copy(fingers[2].tip).sub(fingers[2].base);
    } else if (!cameraOn) {
      pinchDot.visible = false;
      releaseGrab();
      wristPos.copy(fingers[7].base);
      wristDir.copy(fingers[7].tip).sub(fingers[7].base);
      wristCm = null;
      fingerCm = null;
    } else if (freshFrame) {
      handCount = 0;
      if (now - lastHandSeen > 150) {
        pinch = false;
        pinchDot.visible = false;
        releaseGrab();
        for (const finger of fingers) finger.ready = false;
      }
    }

    if (faceWidth != null) faceWidthHold = faceWidth;
    if (wristCm != null) wristHold = wristCm;
    if (fingerCm != null) fingerHold = fingerCm;
    if (!cameraOn) {
      wristHold = null;
      fingerHold = null;
    }
    const bodyPrior = priorFromHeight(state.heightCm, state.headCircCm);
    let body = bodyPrior;
    if (poseOn && poseWorld && poseImage) {
      const estimated = estimateFromPose({
        world: poseWorld,
        imageVisibility: poseImage.map((p) => p.visibility ?? 0),
        heightCm: state.heightCm,
        headCircEntered: state.headCircCm,
        faceWidthCm: faceWidthHold,
        wristCm,
        fingerCm,
      });
      if (estimated) body = estimated;
    }
    if (faceWidthHold != null) body = { ...body, faceWidthCm: round1(faceWidthHold) };
    if (state.headCircCm != null) body = { ...body, headCircCm: state.headCircCm };
    else if (faceWidthHold != null) body = { ...body, headCircCm: round1(headFromFace(faceWidthHold)) };
    if (wristCm != null) body = { ...body, wristCm: round1(wristCm) };
    if (fingerCm != null) body = { ...body, fingerCm: round1(fingerCm) };

    scene.background = cameraOn ? null : backdrop;
    video.style.visibility = cameraOn ? "visible" : "hidden";
    bust.visible = !cameraOn;
    occ.visible = true;

    capGroup.visible = state.category === "wig";
    hat.visible = state.category === "hat";
    glasses.visible = state.category === "glasses";
    earringL.visible = state.category === "earrings";
    earringR.visible = state.category === "earrings";
    ring.visible = state.category === "ring" && (!cameraOn || handCount > 0);
    watch.visible = state.category === "watch" && (!cameraOn || handCount > 0);
    shirt.visible = state.category === "shirt" && (!cameraOn || poseOn);
    sleeveL.visible = shirt.visible;
    sleeveR.visible = shirt.visible;
    const pantsOn = state.category === "pants" && (!cameraOn || poseOn);
    thighL.visible = pantsOn;
    thighR.visible = pantsOn;
    shinL.visible = pantsOn;
    shinR.visible = pantsOn;
    seat.visible = pantsOn;
    kneePadL.visible = pantsOn;
    kneePadR.visible = pantsOn;
    bustTorso.visible = !cameraOn && state.category !== "shirt" && state.category !== "pants";
    for (const bead of neckBeads) bead.visible = state.category === "necklace";

    paintMaterials(state);
    updateHeadGear(state, dt, time);
    updateJewellery(state, faceWidthHold, wristHold, fingerHold, dt);
    updateNails(state);
    updateShirt(state, dt, garmentEase(body.chestCm, state.wornChest));
    updatePants(garmentEase(body.hipCm ?? body.waistCm, state.wornHip ?? state.wornWaist));
    updateBust();

    if (now - metricT > 140) {
      metricT = now;
      onMetrics({
        camera: cameraOn,
        face: faceOn,
        hands: handCount,
        pose: poseOn,
        pinch,
        grabbed,
        section: sectionNow,
        fps,
        body,
      });
    }

    prevQuat.copy(headQuat);
    renderer.render(scene, camera);
  }

  function paintMaterials(state: TryonState) {
    const look = finish(state.material);
    hairMat.color.set(state.color);
    hairMat.roughness = look.rough;
    hairMat.metalness = look.metal;
    capMat.color.set(state.color);
    clothMat.color.set(state.color);
    clothMat.roughness = state.category === "shirt" || state.category === "pants" ? look.rough : 0.45;
    clothMat.metalness = look.metal;
    pantMat.color.set(state.color);
    pantMat.roughness = look.rough;
    pantMat.metalness = look.metal;
    nailMat.color.set(state.color);
    nailMat.roughness = look.rough;
    nailMat.metalness = look.metal;
    if (state.material === "metal" || state.category === "glasses" || state.category === "earrings" || state.category === "necklace" || state.category === "ring" || state.category === "watch") {
      metalMat.color.set(state.color);
      metalMat.roughness = look.rough;
      metalMat.metalness = Math.max(look.metal, 0.55);
    }
    dial.material = state.category === "watch" ? clothMat : dial.material;
  }

  function updateHeadGear(state: TryonState, dt: number, time: number) {
    const size = state.wigSize;
    capGroup.position.copy(headPos);
    capGroup.quaternion.copy(headQuat);
    capGroup.scale.setScalar(size);
    cap.position.y = 5.6 + state.wigLift / Math.max(size, 0.4);
    cap.visible = state.category === "wig";

    occ.position.copy(headPos);
    occ.quaternion.copy(headQuat);
    occ.scale.setScalar(size);

    hat.quaternion.copy(headQuat);
    hat.scale.set(1.25 * size, 0.42 * size, 1.25 * size);
    tmp.set(0, 8.2 + state.wigLift, -0.4).applyQuaternion(headQuat).add(headPos);
    hat.position.copy(tmp);

    if (state.category !== "wig") {
      for (const strand of strands) strand.mesh.visible = false;
      sectionNow = 0;
      return;
    }
    if (strandStyle !== state.style) {
      rebuildStrands(state.style);
      strandStyle = state.style;
    }
    const total = hairDropCm(state.hairLength, state.style);
    const stiff = hairStiffness(state.sway, state.material === "curly");
    const radius = 8.1 * size;
    const targetPulls = new Float32Array(strands.length);
    const distances = new Int16Array(strands.length);
    sectionNow = 0;
    if (grabStrand >= 0 && grabStrand < strands.length) {
      targetPulls[grabStrand] = 1;
      sectionNow = 1;
      for (const neighbour of sectionWeights(strands.length, grabStrand)) {
        targetPulls[neighbour.index] = neighbour.weight * SECTION_FOLLOW;
        distances[neighbour.index] = Math.abs(neighbour.index - grabStrand);
        sectionNow += 1;
      }
    }
    for (let s = 0; s < strands.length; s++) {
      const strand = strands[s];
      strand.mesh.visible = true;
      strand.influence = hairSectionInfluence(strand.influence, targetPulls[s], dt, distances[s]);
      tmp.copy(strand.local);
      tmp.y += state.wigLift / Math.max(size, 0.4);
      tmp.multiplyScalar(size).applyQuaternion(headQuat).add(headPos);
      const seg = (total * strand.lengthMul) / Math.max(1, strand.nodes.length - 1);
      const pull = strand.influence;
      const joint = targetPulls[s] > 0.01 && pull > 0.01
        ? Math.min(Math.max(grabJoint, 1), strand.nodes.length - 1)
        : -1;
      simulate(
        strand.nodes,
        tmp,
        seg,
        dt,
        stiff,
        joint,
        joint >= 0 ? pinchDot.position : null,
        headPos,
        radius,
        pull || 1,
        hairStrandDamping(strand.lengthMul, Math.max(0, Math.min(1, -strand.local.z / 10))),
        bodyAcceleration,
      );
    }
    // Resolve local strand contacts after integration so neighbouring locks do not
    // fight each other's Verlet constraints during the same update.
    resolveHairContacts(strands, grabStrand, grabJoint);
    resolveHairClumps(strands, dt, grabStrand, grabJoint);
    if (poseOn) {
      resolveHairBackContacts(strands, headPos, headQuat, shL, shR, hipL, hipR);
    }
    for (const strand of strands) {
      writeRibbon(strand, ribbonWidthCm(state.style));
      if (!strand.ready) strand.ready = true;
    }
    if (state.category === "wig" && time < 0) return;
  }

  function updateJewellery(
    state: TryonState,
    faceWidth: number | null,
    wristCm: number | null,
    fingerCm: number | null,
    dt: number,
  ) {
    const showEars = state.category === "earrings";
    placeEarring(earringL, -1, showEars);
    placeEarring(earringR, 1, showEars);

    neckRoot.set(0, -8.2, 3.4).applyQuaternion(headQuat).add(headPos);
    if (state.category === "necklace") {
      sectionNow = neckGrab >= 0 ? 1 : 0;
      simulate(
        neckNodes,
        neckRoot,
        NECKLACE_SEGMENT_CM,
        dt,
        NECKLACE_STIFFNESS,
        neckGrab,
        neckGrab >= 0 ? pinchDot.position : null,
        headPos,
        8.4,
      );
      neckBeads.forEach((bead, i) => {
        bead.visible = true;
        bead.position.copy(neckNodes[i].pos);
      });
    }

    glasses.position.copy(headPos);
    glasses.quaternion.copy(headQuat);
    glasses.scale.setScalar(glassesScale(faceWidth));
    const cat = state.productId === "glasses-cateye" ? CAT_EYE_ROLL : 0;
    lensL.rotation.z = cat;
    lensR.rotation.z = -cat;
    lensL.scale.set(1, cat ? 0.82 : 1, 1);
    lensR.scale.set(1, cat ? 0.82 : 1, 1);

    if (state.category === "ring" && (!cameraOn || handCount > 0)) {
      const finger = fingers[1];
      const dir = tmpC.subVectors(finger.tip, finger.base);
      const len = dir.length() || 1;
      ring.position.copy(finger.base).addScaledVector(dir, 0.62);
      ring.quaternion.setFromUnitVectors(Z_AXIS, dir.multiplyScalar(1 / len));
      ring.scale.setScalar(ringScale(fingerCm ?? fingerCmFrom(finger)));
      ring.visible = true;
    }

    if (state.category === "watch" && (!cameraOn || handCount > 0) && wristDir.lengthSq() > 0.001) {
      watch.position.copy(wristPos);
      watch.quaternion.setFromUnitVectors(Z_AXIS, tmpC.copy(wristDir).normalize());
      watch.scale.setScalar(watchScale(wristCm));
      watch.visible = true;
    }
  }

  function placeEarring(group: THREE.Group, sideSign: number, visible: boolean) {
    group.visible = visible;
    tmp.set(sideSign * 6.8, -2.4, 1.2).applyQuaternion(headQuat).add(headPos);
    group.position.copy(tmp);
    group.quaternion.copy(headQuat);
    const drop = group.children[1] as THREE.Mesh;
    drop.position.set(sideSign * swing * EAR_SWING_X, -2.2, swing * EAR_SWING_Z);
  }

  function updateNails(state: TryonState) {
    const on = state.category === "nails" && (cameraOn ? handCount > 0 : true);
    if (nailShape !== state.nailShape) {
      nailGeo?.dispose();
      nailGeo =
        state.nailShape === "square"
          ? new THREE.BoxGeometry(1.2, 0.32, 1.45)
          : state.nailShape === "stiletto"
            ? new THREE.ConeGeometry(0.42, 1.7, 6)
            : new THREE.SphereGeometry(0.52, 10, 8);
      for (const mesh of nailMeshes) mesh.geometry = nailGeo;
      nailShape = state.nailShape;
    }
    const count = cameraOn ? Math.min(10, handCount * 5) : 10;
    for (let i = 0; i < nailMeshes.length; i++) {
      const mesh = nailMeshes[i];
      if (!on || i >= count) {
        mesh.visible = false;
        continue;
      }
      const finger = fingers[i];
      const dir = tmp.subVectors(finger.tip, finger.base);
      const len = dir.length() || 1;
      mesh.visible = true;
      mesh.position.copy(finger.tip).addScaledVector(dir, -NAIL_SETBACK_CM / len);
      mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.multiplyScalar(1 / len));
      mesh.scale.setScalar(nailScale(state.nailShape));
    }
  }

  function updateShirt(state: TryonState, dt: number, ease: EaseRead) {
    sleeveL.visible = shirt.visible;
    sleeveR.visible = shirt.visible;
    if (!shirt.visible) {
      if (clothGrab >= 0) clothGrab = -1;
      return;
    }
    const across = tmp.subVectors(shR, shL);
    const midS = tmpB.copy(shL).add(shR).multiplyScalar(0.5);
    const midH = tmpC.copy(hipL).add(hipR).multiplyScalar(0.5);
    const up = new THREE.Vector3().subVectors(midS, midH);
    if (up.lengthSq() < 1) up.set(0, 1, 0);
    up.normalize();
    if (across.lengthSq() < 1) across.set(1, 0, 0);
    across.normalize();
    const forward = new THREE.Vector3().crossVectors(across, up).normalize();
    if (prevTorso.lengthSq() > 1) clothPhase += midS.distanceTo(prevTorso) * 0.18;
    clothPhase += dt * (ease.taut ? 0.55 : 2.4);
    prevTorso.copy(midS);
    let twist = Math.atan2(shR.x - shL.x, shR.z - shL.z) - Math.atan2(hipR.x - hipL.x, hipR.z - hipL.z);
    if (twist > Math.PI) twist -= Math.PI * 2;
    if (twist < -Math.PI) twist += Math.PI * 2;
    const bend = THREE.MathUtils.clamp((34 - midS.distanceTo(midH)) / 16, 0, 1);
    const amp = foldAmplitudeCm(state.material) * ease.wrinkle;
    const pos = shirtGeo.attributes.position as THREE.BufferAttribute;

    for (let r = 0; r < SHIRT_ROWS; r++) {
      const t = ROW_T[r];
      pointOn(rowL, shL, hipL, t);
      pointOn(rowR, shR, hipR, t);
      const flare = ease.flareCm * (0.65 + t * 0.55);
      rowL.addScaledVector(across, -flare);
      rowR.addScaledVector(across, flare);
      for (let c = 0; c < SHIRT_COLS; c++) {
        const u = c / (SHIRT_COLS - 1);
        const fold = clothWrinkleCm(t, u, clothPhase, amp, bend, twist);
        for (let layer = 0; layer < 2; layer++) {
          const sign = layer === 0 ? 1 : -1;
          const index = layer * SHIRT_ROWS * SHIRT_COLS + r * SHIRT_COLS + c;
          clothPt.copy(rowL).lerp(rowR, u);
          clothPt.addScaledVector(forward, sign * (3.1 + fold.depth));
          clothPt.addScaledVector(across, fold.slide);
          shirtTargets[index].copy(clothPt);
        }
      }
    }

    shirtPull.fill(0);
    if (clothGrab >= 0 && clothGrab < SHIRT_VERTS) {
      shirtPull[clothGrab] = 1;
      sectionNow = 1;
      for (const pull of clothPullWeights(clothGrab)) {
        shirtPull[pull.index] = pull.weight;
        sectionNow += 1;
      }
    }
    const pinchAt = clothGrab >= 0 ? pinchDot.position : null;
    for (let i = 0; i < SHIRT_VERTS; i++) {
      const base = shirtTargets[i];
      const o = i * 3;
      let ox = shirtOff[o];
      let oy = shirtOff[o + 1];
      let oz = shirtOff[o + 2];
      const weight = shirtPull[i];
      if (weight > 0 && pinchAt) {
        const gain = 0.45 * weight;
        ox += (pinchAt.x - base.x - ox) * gain;
        oy += (pinchAt.y - base.y - oy) * gain;
        oz += (pinchAt.z - base.z - oz) * gain;
      } else {
        const fall = GRAVITY_CM_S2 * dt * dt * 0.12;
        ox *= 0.86;
        oy = oy * 0.86 - fall;
        oz *= 0.86;
      }
      if (ox * ox + oy * oy + oz * oz < 0.04) {
        ox = 0;
        oy = 0;
        oz = 0;
      }
      shirtOff[o] = ox;
      shirtOff[o + 1] = oy;
      shirtOff[o + 2] = oz;
      clothPt.copy(base);
      clothPt.x += ox;
      clothPt.y += oy;
      clothPt.z += oz;
      writeVec(pos, i, clothPt);
    }
    pos.needsUpdate = true;
    shirtGeo.computeVertexNormals();

    const sleeveRadius = 4.1 + Math.max(0, ease.flareCm) * 0.35;
    sleeveEnd.copy(shL).addScaledVector(across, -16).addScaledVector(up, -18).addScaledVector(forward, 3);
    placeTube(sleeveL, shL, sleeveEnd, sleeveRadius);
    sleeveEnd.copy(shR).addScaledVector(across, 16).addScaledVector(up, -18).addScaledVector(forward, 3);
    placeTube(sleeveR, shR, sleeveEnd, sleeveRadius);
  }

  function updatePants(ease: EaseRead) {
    if (!thighL.visible) {
      kneePadL.visible = false;
      kneePadR.visible = false;
      return;
    }
    const span = Math.max(16, hipL.distanceTo(hipR));
    const thigh = thighRadiusCm(span) * THREE.MathUtils.clamp(1 + ease.flareCm / 14, 0.84, 1.32);
    const shin = shinRadiusCm(thigh);
    placeTube(thighL, hipL, kneeL, thigh);
    placeTube(thighR, hipR, kneeR, thigh);
    placeTube(shinL, kneeL, ankL, shin);
    placeTube(shinR, kneeR, ankR, shin);
    const mid = tmp.copy(hipL).add(hipR).multiplyScalar(0.5);
    seat.position.copy(mid);
    seat.scale.set(span * 0.62 + ease.flareCm * 0.8, 9, 11);
    placeKnee(kneePadL, hipL, kneeL, ankL);
    placeKnee(kneePadR, hipR, kneeR, ankR);
  }

  function updateBust() {
    if (!bust.visible) return;
    bustHead.position.copy(headPos);
    bustHead.quaternion.copy(headQuat);
    bustNeck.position.copy(tmp.set(0, -11, 0).applyQuaternion(headQuat).add(headPos));
    bustNeck.quaternion.copy(headQuat);
    placeTube(bustTorso, tmpB.copy(shL).add(shR).multiplyScalar(0.5), tmpC.copy(hipL).add(hipR).multiplyScalar(0.5), 13);
  }

  function tryGrab(nx: number, ny: number, pz: number) {
    if (getState().category === "necklace") {
      if (neckGrab >= 0) { grabbed = true; return; }
      let best = -1;
      let bestD = 0.07;
      for (let i = 1; i < neckNodes.length; i++) {
        const p = projectNorm(neckNodes[i].pos);
        if (!p) continue;
        const d = Math.hypot(p.x - nx, p.y - ny);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      neckGrab = best;
      grabbed = best >= 0;
      grabStrand = -1;
      clothGrab = -1;
      return;
    }
    if (getState().category === "shirt") {
      if (clothGrab >= 0) {
        grabbed = true;
        return;
      }
      let best = -1;
      let bestD = GRAB_RADIUS_NORM;
      for (let i = 0; i < shirtTargets.length; i++) {
        const p = projectNorm(shirtTargets[i]);
        if (!p) continue;
        const d = Math.hypot(p.x - nx, p.y - ny);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      clothGrab = best;
      grabbed = best >= 0;
      grabStrand = -1;
      neckGrab = -1;
      if (!grabbed) pinchDot.position.copy(normToWorld(nx, ny, pz));
      return;
    }
    if (getState().category !== "wig") {
      releaseGrab();
      return;
    }
    if (grabStrand >= 0) {
      grabbed = true;
      return;
    }
    let bestS = -1;
    let bestJ = -1;
    let bestD = GRAB_RADIUS_NORM;
    for (let s = 0; s < strands.length; s++) {
      const nodes = strands[s].nodes;
      for (let j = 1; j < nodes.length; j++) {
        const p = projectNorm(nodes[j].pos);
        if (!p) continue;
        const d = Math.hypot(p.x - nx, p.y - ny);
        if (d < bestD) {
          bestD = d;
          bestS = s;
          bestJ = j;
        }
      }
    }
    grabStrand = bestS;
    grabJoint = bestJ;
    grabbed = bestS >= 0;
    if (!grabbed) pinchDot.position.copy(normToWorld(nx, ny, pz));
  }

  function releaseGrab() {
    if (grabStrand >= 0 && grabStrand < strands.length) {
      const indexFor = (nodes: VNode[]) => Math.min(Math.max(grabJoint, 1), nodes.length - 1);
      const primary = strands[grabStrand].nodes;
      const primaryIndex = indexFor(primary);
      if (primary[primaryIndex]) {
        primary[primaryIndex].prev.copy(primary[primaryIndex].pos).sub(pinchFrameVelocity);
      }
      // A grabbed lock has already transferred motion to nearby locks while held.
      // Preserve that shared momentum on release instead of leaving the neighbours behind.
      for (const neighbour of sectionWeights(strands.length, grabStrand)) {
        const nodes = strands[neighbour.index].nodes;
        const index = indexFor(nodes);
        if (!nodes[index]) continue;
        nodes[index].prev.copy(nodes[index].pos).addScaledVector(pinchFrameVelocity, -neighbour.weight * SECTION_FOLLOW);
      }
    }
    if (neckGrab > 0 && neckNodes[neckGrab]) {
      neckNodes[neckGrab].prev.copy(neckNodes[neckGrab].pos).sub(pinchFrameVelocity);
    }
    grabStrand = -1;
    grabJoint = -1;
    neckGrab = -1;
    clothGrab = -1;
    grabbed = false;
    pinchWorldReady = false;
    pinchFrameVelocity.set(0, 0, 0);
  }

  function rebuildStrands(style: WigStyle) {
    for (const strand of strands) {
      scene.remove(strand.mesh);
      strand.geo.dispose();
    }
    strands = [];
    const count = style === "braids" ? 22 : style === "bob" ? 72 : 86;
    const joints = style === "braids" ? 6 : style === "bob" ? 6 : 8;
    const rim = style === "bob" ? 1.6 : 5.2;
    for (let i = 0; i < count; i++) {
      const angle = 1.5 * Math.PI + (i / (count - 1) - 0.5) * 1.42 * Math.PI;
      pushStrand(Math.cos(angle) * 8.1, rim - stableHairJitter(i, style === "bob" ? 2 : style === "braids" ? 3 : 1) * 0.8, -2.6 + Math.sin(angle) * 9.2, joints, 1);
    }
    if (style === "straight") {
      for (let i = 0; i < 14; i++) {
        const angle = Math.PI / 2 + (i / 13 - 0.5) * 0.85;
        pushStrand(Math.cos(angle) * 6.4, 7.4, -1.2 + Math.sin(angle) * 6.8, 5, 0.32);
      }
    }
  }

  function pushStrand(x: number, y: number, z: number, joints: number, lengthMul: number) {
    const geo = makeRibbon(joints);
    const mesh = new THREE.Mesh(geo, hairMat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    strands.push({
      local: new THREE.Vector3(x, y, z),
      lengthMul,
      nodes: Array.from({ length: joints }, () => ({ pos: new THREE.Vector3(), prev: new THREE.Vector3() })),
      ready: false,
      influence: 0,
      geo,
      mesh,
    });
  }

  function applyBustLocal(target: THREE.Vector3, x: number, y: number, z: number) {
    target.set(x, y, z).applyQuaternion(headQuat).add(headPos);
  }

  function applyHipLocal(target: THREE.Vector3, x: number, y: number, z: number) {
    target.set(x, y, z).applyQuaternion(hipQuat).add(headPos);
  }

  function poseMannequinFingers() {
    for (let hand = 0; hand < 2; hand++) {
      const side = hand === 0 ? -1 : 1;
      for (let f = 0; f < 5; f++) {
        const spread = (f - 2) * 2.2;
        const slot = fingers[hand * 5 + f];
        slot.base.set(side * 18 + spread, -46, 12).applyQuaternion(headQuat).add(headPos);
        slot.tip.set(side * 18 + spread * 1.15, -52.4, 16).applyQuaternion(headQuat).add(headPos);
      }
    }
  }

  function normToWorld(nx: number, ny: number, z: number) {
    const dist = Math.max(8, Math.abs(z));
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * dist;
    const halfW = halfH * camera.aspect;
    return new THREE.Vector3((nx - 0.5) * 2 * halfW, (0.5 - ny) * 2 * halfH, z);
  }

  function projectNorm(v: THREE.Vector3) {
    tmpC.copy(v).project(camera);
    if (tmpC.z < -1 || tmpC.z > 1) return null;
    return { x: (tmpC.x + 1) / 2, y: (1 - tmpC.y) / 2 };
  }

  function fingerCmFrom(finger: Finger) {
  return finger.tip.distanceTo(finger.base) / FINGER_LENGTH_TO_BREADTH;
  }

  let raf = requestAnimationFrame(loop);
  layout();
  const onResize = () => layout();
  window.addEventListener("resize", onResize);
  video.addEventListener("loadedmetadata", layout);

  return {
    async startCamera() {
      if (disposed) return;
      if (stream) return;
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (disposed) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = media;
      video.srcObject = media;
      await video.play();
      cameraOn = true;
      axesLocked = false;
      layout();
      onStatus(faceLandmarker ? "Look at the camera. Pinch hair or a necklace bead to pull it." : "Camera on. Trackers are still loading.");
    },
    stopCamera() {
      cameraOn = false;
      faceOn = false;
      poseOn = false;
      poseWorldHold = null;
      poseImageHold = null;
      axesLocked = false;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
      onStatus("Camera off. The mannequin keeps the fit.");
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      stream?.getTracks().forEach((track) => track.stop());
      faceLandmarker?.close();
      handLandmarker?.close();
      poseLandmarker?.close();
      renderer.dispose();
    },
  };
}

function finish(material: Material) {
  if (material === "satin") return { rough: 0.32, metal: 0.16 };
  if (material === "metal") return { rough: 0.24, metal: 0.84 };
  if (material === "gloss") return { rough: 0.16, metal: 0.42 };
  if (material === "curly") return { rough: 0.62, metal: 0.03 };
  if (material === "silky") return { rough: 0.3, metal: 0.07 };
  return { rough: 0.84, metal: 0.02 };
}

function makeRibbon(joints: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(joints * 2 * 3), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(joints * 2 * 3), 3));
  const idx: number[] = [];
  for (let i = 0; i < joints - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  geo.setIndex(idx);
  return geo;
}


/** Soft local self-collision between adjacent hair ribbons. Keeps roots attached and
 * moves previous positions with corrected positions to avoid injecting fake velocity. */
function resolveHairContacts(strands: Strand[], grabbedStrand: number, grabbedJoint: number) {
  const minGap = 0.34;
  const minGapSq = minGap * minGap;
  const delta = new THREE.Vector3();
  for (let s = 0; s < strands.length; s++) {
    const a = strands[s].nodes;
    for (let neighbour = s + 1; neighbour <= Math.min(strands.length - 1, s + 2); neighbour++) {
      const b = strands[neighbour].nodes;
      const count = Math.min(a.length, b.length);
      for (let j = 1; j < count; j++) {
        if ((s === grabbedStrand && j === grabbedJoint) || (neighbour === grabbedStrand && j === grabbedJoint)) continue;
        const pa = a[j].pos;
        const pb = b[j].pos;
        delta.subVectors(pb, pa);
        const d2 = delta.lengthSq();
        if (d2 >= minGapSq) continue;
        if (d2 < 1e-8) {
          delta.set(0, 0, ((s + neighbour + j) % 2 ? 1 : -1) * (minGap * 0.5));
        } else {
          delta.multiplyScalar(((minGap - Math.sqrt(d2)) / (2 * Math.sqrt(d2))));
        }
        pa.sub(delta);
        pb.add(delta);
        a[j].prev.sub(delta);
        b[j].prev.add(delta);
      }
    }
  }
}


/**
 * Keeps rear-facing hair from passing through the wearer's upper torso.
 * The torso is a conservative ellipsoid built from tracked shoulder/hip
 * landmarks. Corrections are applied to Verlet history as well as position
 * so contact does not inject artificial velocity.
 */
function resolveHairBackContacts(
  strands: Strand[],
  headPos: THREE.Vector3,
  headQuat: THREE.Quaternion,
  shoulderLeft: THREE.Vector3,
  shoulderRight: THREE.Vector3,
  hipLeft: THREE.Vector3,
  hipRight: THREE.Vector3,
) {
  const shoulderSpan = shoulderLeft.distanceTo(shoulderRight);
  const torsoLength = shoulderLeft.clone().add(shoulderRight).multiplyScalar(0.5)
    .distanceTo(hipLeft.clone().add(hipRight).multiplyScalar(0.5));
  if (!Number.isFinite(shoulderSpan) || shoulderSpan < 8 || torsoLength < 8) return;

  const shoulderMid = shoulderLeft.clone().add(shoulderRight).multiplyScalar(0.5);
  const hipMid = hipLeft.clone().add(hipRight).multiplyScalar(0.5);
  const centre = shoulderMid.add(hipMid).multiplyScalar(0.5);
  const radiusX = Math.max(5, shoulderSpan * 0.47);
  const radiusY = Math.max(7, torsoLength * 0.58);
  const radiusZ = 6.2;
  const inverseHead = headQuat.clone().invert();
  const localCentre = centre.sub(headPos).applyQuaternion(inverseHead);
  const local = new THREE.Vector3();
  const shoulderAxis = new THREE.Vector3().subVectors(shoulderRight, shoulderLeft);
  const shoulderLengthSq = shoulderAxis.lengthSq();
  const closestShoulder = new THREE.Vector3();
  const shoulderDelta = new THREE.Vector3();
  const shoulderClearance = 2.8;
  // A compact nape volume prevents lower rear locks from cutting through
  // the neck while leaving the scalp roots and front-facing hair untouched.
  const napeCentre = new THREE.Vector3(0, -9.2, -1.6);
  const napeRadii = new THREE.Vector3(4.6, 5.4, 4.1);
  const napeLocal = new THREE.Vector3();

  for (const strand of strands) {
    for (let j = 2; j < strand.nodes.length; j++) {
      const node = strand.nodes[j];
      // Rounded shoulder capsule: hair slides around the shoulder line instead
      // of being pushed by the broad torso volume alone.
      const shoulderT = shoulderLengthSq > 1e-6
        ? Math.max(0, Math.min(1, shoulderDelta.subVectors(node.pos, shoulderLeft).dot(shoulderAxis) / shoulderLengthSq))
        : 0;
      closestShoulder.copy(shoulderLeft).addScaledVector(shoulderAxis, shoulderT);
      shoulderDelta.subVectors(node.pos, closestShoulder);
      const shoulderPrevious = node.prev.clone().sub(closestShoulder);
      const shoulderContact = resolveEllipsoidContact(
        shoulderDelta,
        shoulderPrevious,
        { x: shoulderClearance, y: shoulderClearance, z: shoulderClearance },
        0,
        0.06,
      );
      if (shoulderContact) {
        node.pos.copy(new THREE.Vector3(
          shoulderContact.position.x,
          shoulderContact.position.y,
          shoulderContact.position.z,
        ).add(closestShoulder));
        node.prev.copy(new THREE.Vector3(
          shoulderContact.previous.x,
          shoulderContact.previous.y,
          shoulderContact.previous.z,
        ).add(closestShoulder));
      }
      local.copy(node.pos).sub(headPos).applyQuaternion(inverseHead);
      if (j >= 3 && local.y < -4 && local.y > -15 && local.z < 0) {
        napeLocal.copy(local).sub(napeCentre);
        const nx = napeLocal.x / napeRadii.x;
        const ny = napeLocal.y / napeRadii.y;
        const nz = napeLocal.z / napeRadii.z;
        const napeDistanceSq = nx * nx + ny * ny + nz * nz;
        if (napeDistanceSq < 1) {
          const previousNape = node.prev.clone().sub(headPos).applyQuaternion(inverseHead).sub(napeCentre);
          const contact = resolveEllipsoidContact(
            napeLocal,
            previousNape,
            napeRadii,
            0.12,
            0.04,
          );
          if (contact) {
            const corrected = new THREE.Vector3(contact.position.x, contact.position.y, contact.position.z)
              .add(napeCentre).applyQuaternion(headQuat).add(headPos);
            const correctedPrevious = new THREE.Vector3(contact.previous.x, contact.previous.y, contact.previous.z)
              .add(napeCentre).applyQuaternion(headQuat).add(headPos);
            node.pos.copy(corrected);
            node.prev.copy(correctedPrevious);
            local.copy(node.pos).sub(headPos).applyQuaternion(inverseHead);
          }
        }
      }
      local.sub(localCentre);
      // Only the rear half of the torso is a blocker. Front hair remains free
      // to fall over the chest rather than being pushed away from the body.
      if (local.z >= 0) continue;
      const previousLocal = node.prev.clone().sub(headPos).applyQuaternion(inverseHead).sub(localCentre);
      const contact = resolveEllipsoidContact(
        local,
        previousLocal,
        { x: radiusX, y: radiusY, z: radiusZ },
        0.18,
        0.08,
      );
      if (!contact) continue;
      const corrected = new THREE.Vector3(contact.position.x, contact.position.y, contact.position.z)
        .add(localCentre).applyQuaternion(headQuat).add(headPos);
      const correctedPrevious = new THREE.Vector3(contact.previous.x, contact.previous.y, contact.previous.z)
        .add(localCentre).applyQuaternion(headQuat).add(headPos);
      node.pos.copy(corrected);
      node.prev.copy(correctedPrevious);
    }
  }
}

/**
 * Soft lock cohesion: neighbouring roots retain a loose shared bundle as the
 * hair swings. This is deliberately weaker than strand-length constraints and
 * never welds the ribbons into one rigid sheet.
 */
function resolveHairClumps(strands: Strand[], dt: number, grabbedStrand: number, grabbedJoint: number) {
  const blend = Math.min(0.12, 0.035 * dt * 60);
  const maxCorrection = 0.08;
  const delta = new THREE.Vector3();
  for (let s = 0; s < strands.length - 1; s++) {
    const a = strands[s];
    const b = strands[s + 1];
    const count = Math.min(a.nodes.length, b.nodes.length);
    const rootGap = a.local.distanceTo(b.local);
    const restGap = rootGap + 0.18;
    for (let j = 2; j < count; j++) {
      if ((s === grabbedStrand && j === grabbedJoint) || (s + 1 === grabbedStrand && j === grabbedJoint)) continue;
      const pa = a.nodes[j].pos;
      const pb = b.nodes[j].pos;
      delta.subVectors(pb, pa);
      const distance = delta.length();
      if (distance <= restGap || distance < 1e-6) continue;
      const amount = Math.min(maxCorrection, (distance - restGap) * blend * 0.5);
      delta.multiplyScalar(amount / distance);
      pa.add(delta);
      pb.sub(delta);
      // Keep Verlet history aligned with the positional correction so clumping
      // does not create an artificial impulse on the next frame.
      a.nodes[j].prev.add(delta);
      b.nodes[j].prev.sub(delta);
    }
  }
}

function writeRibbon(strand: Strand, width: number) {
  const pos = strand.geo.attributes.position as THREE.BufferAttribute;
  const nrm = strand.geo.attributes.normal as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const narr = nrm.array as Float32Array;
  const joints = strand.nodes;
  const side = new THREE.Vector3();
  const prevSide = new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  for (let i = 0; i < joints.length; i++) {
    const p = joints[i].pos;
    const next = joints[Math.min(i + 1, joints.length - 1)].pos;
    const prev = joints[Math.max(i - 1, 0)].pos;
    tangent.subVectors(next, prev);
    if (tangent.lengthSq() < 1e-6) tangent.set(0, -1, 0);
    tangent.normalize();
    toCam.copy(p).negate();
    if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, 1);
    toCam.normalize();
    side.crossVectors(tangent, toCam);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    if (side.dot(prevSide) < 0) side.negate();
    prevSide.copy(side);
    const w = width * (1 - (i / joints.length) * 0.62);
    const o = i * 6;
    arr[o] = p.x + side.x * w;
    arr[o + 1] = p.y + side.y * w;
    arr[o + 2] = p.z + side.z * w;
    arr[o + 3] = p.x - side.x * w;
    arr[o + 4] = p.y - side.y * w;
    arr[o + 5] = p.z - side.z * w;
    for (let k = 0; k < 2; k++) {
      const n = (i * 2 + k) * 3;
      narr[n] = toCam.x;
      narr[n + 1] = toCam.y;
      narr[n + 2] = toCam.z;
    }
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}

function simulate(
  nodes: VNode[],
  root: THREE.Vector3,
  seg: number,
  dt: number,
  stiffness: number,
  grabIndex: number,
  grabAt: THREE.Vector3 | null,
  head: THREE.Vector3,
  headRadius: number,
  pullStrength = 1,
  dampingRetention = VERLET_DAMP,
  bodyAcceleration: THREE.Vector3 | null = null,
) {
  const g = GRAVITY_CM_S2 * dt * dt;
  const blend = constraintBlend(stiffness);
  const damping = Math.pow(Math.max(0.9, Math.min(0.995, dampingRetention)), dt * 60);
  const grabBlend = (1 - Math.pow(1 - GRAB_LERP, dt * 60)) * pullStrength;
  if (!nodes[0].pos.lengthSq() && !nodes[1]?.pos.lengthSq()) {
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].pos.copy(root);
      nodes[i].pos.y -= i * seg;
      nodes[i].prev.copy(nodes[i].pos);
    }
  }
  nodes[0].prev.copy(nodes[0].pos);
  nodes[0].pos.copy(root);
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (i === grabIndex && grabAt) {
      n.prev.copy(n.pos);
      n.pos.lerp(grabAt, grabBlend);
      continue;
    }
    const vx = (n.pos.x - n.prev.x) * damping;
    const vy = (n.pos.y - n.prev.y) * damping;
    const vz = (n.pos.z - n.prev.z) * damping;
    n.prev.copy(n.pos);
    n.pos.set(n.pos.x + vx, n.pos.y + vy - g, n.pos.z + vz);
    if (bodyAcceleration) {
      // Inertial lag is opposite the wearer's measured torso acceleration.
      n.pos.addScaledVector(bodyAcceleration, -0.18 * dt * dt);
    }
  }
  const corr = new THREE.Vector3();
  for (let pass = 0; pass < CONSTRAINT_PASSES; pass++) {
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1].pos;
      const b = nodes[i].pos;
      corr.subVectors(b, a);
      const len = corr.length() || 0.0001;
      corr.multiplyScalar(((len - seg) / len) * blend);
      if (i - 1 > 0 && i - 1 !== grabIndex) a.add(corr);
      if (i !== grabIndex) b.sub(corr);
    }
  }
  for (let i = 1; i < nodes.length; i++) {
    corr.subVectors(nodes[i].pos, head);
    if (corr.lengthSq() < headRadius * headRadius && corr.lengthSq() > 0) {
      corr.normalize().multiplyScalar(headRadius);
      nodes[i].pos.copy(head).add(corr);
    }
  }
}

function buildShirtGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SHIRT_VERTS * 3), 3));
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  const layer = SHIRT_ROWS * SHIRT_COLS;
  for (let r = 0; r < SHIRT_ROWS - 1; r++) {
    for (let c = 0; c < SHIRT_COLS - 1; c++) {
      const i = r * SHIRT_COLS + c;
      quad(i, i + 1, i + SHIRT_COLS + 1, i + SHIRT_COLS);
      const j = layer + i;
      quad(j + 1, j, j + SHIRT_COLS, j + SHIRT_COLS + 1);
    }
  }
  for (let r = 1; r < SHIRT_ROWS - 1; r++) {
    const f = r * SHIRT_COLS;
    const b = layer + f;
    quad(f, b, b + SHIRT_COLS, f + SHIRT_COLS);
    const fr = f + SHIRT_COLS - 1;
    const br = layer + fr;
    quad(fr + SHIRT_COLS, br + SHIRT_COLS, br, fr);
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function clothPullWeights(index: number): { index: number; weight: number }[] {
  const layerSize = SHIRT_ROWS * SHIRT_COLS;
  const layer = index >= layerSize ? 1 : 0;
  const local = index - layer * layerSize;
  const row = Math.floor(local / SHIRT_COLS);
  const col = local % SHIRT_COLS;
  const out: { index: number; weight: number }[] = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = row + dr;
      const cc = col + dc;
      if (rr < 0 || cc < 0 || rr >= SHIRT_ROWS || cc >= SHIRT_COLS) continue;
      const dist = Math.hypot(dr, dc);
      if (dist > 2.2) continue;
      out.push({ index: layer * layerSize + rr * SHIRT_COLS + cc, weight: (1 - dist / 3) * 0.72 });
    }
  }
  return out;
}

function pointOn(out: THREE.Vector3, top: THREE.Vector3, bot: THREE.Vector3, t: number) {
  if (t <= 1) return out.copy(top).lerp(bot, t);
  return out.copy(bot).addScaledVector(clothScratch.subVectors(bot, top), t - 1);
}

const clothScratch = new THREE.Vector3();

function placeKnee(mesh: THREE.Mesh, hip: THREE.Vector3, knee: THREE.Vector3, ankle: THREE.Vector3) {
  const bend = kneeBendAmount(hip, knee, ankle);
  mesh.visible = true;
  mesh.position.copy(knee);
  const dir = clothScratch.subVectors(ankle, hip);
  if (dir.lengthSq() > 0.01) mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
  mesh.scale.set(2.3 + bend * 0.8, 1.15, 2.6 + bend * 3.4);
}

function writeVec(attr: THREE.BufferAttribute, index: number, v: THREE.Vector3) {
  attr.setXYZ(index, v.x, v.y, v.z);
}

function tube() {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.8 }),
  );
}

function placeTube(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  const len = a.distanceTo(b);
  if (len < 0.5) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  mesh.quaternion.setFromUnitVectors(Y_AXIS, dir);
  mesh.scale.set(radius, len, radius);
}

async function makeFace(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
  const build = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
  try {
    return await build("GPU");
  } catch {
    return build("CPU");
  }
}

async function makeHand(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
  const build = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
    });
  try {
    return await build("GPU");
  } catch {
    return build("CPU");
  }
}

async function makePose(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
  const build = (delegate: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  try {
    return await build("GPU");
  } catch {
    return build("CPU");
  }
}
