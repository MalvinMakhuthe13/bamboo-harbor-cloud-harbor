import { estimateFromWorld } from "@/lib/isibuko-ai/fit";
import { buildShirtMesh } from "@/lib/isibuko-ai/garment-mesh";
import { FrameBudgetMonitor } from "@/lib/isibuko-ai/budget";
import { fuseHeadPose, HeadPoseSmoother, type HeadPose } from "@/lib/isibuko-ai/head-pose";
import {
  braceletSprite,
  clothingQuad,
  earringSprite,
  glassesSprite,
  hairFrame,
  hasSleeves,
  isPlausibleClothingQuad,
  hatSprite,
  nailSegments,
  nailShapeFactors,
  necklaceSprite,
  regionMode,
  ringSprite,
  smoothPoint,
  watchSprite,
  wigSprite,
  type Sprite,
} from "@/lib/isibuko-ai/placement";
import { COMPOSITE_FRAG, FULLSCREEN_VERT, GARMENT_MESH_FRAG, GARMENT_MESH_VERT, SPRITE_FRAG, SPRITE_VERT } from "@/lib/isibuko-ai/shaders";
import { applySessionEvent, reuseLiveCamera } from "@/lib/isibuko-ai/session";
import { noteLiveFrame } from "@/lib/isibuko-gen/live-track";
import { notePerception } from "@/lib/isibuko-gen/perception";
import {
  FULL_FRAME,
  GPU_STALL_MS,
  cadenceMs,
  due,
  inferenceEdge,
  isFullFrame,
  maskIsFresh,
  pixelCrop,
  remapList,
  roiFromPoints,
  shouldRefreshFull,
  type NormRect,
} from "@/lib/isibuko-ai/schedule";
import type { FrameRequest, LiveMetrics, Pt } from "@/lib/isibuko-ai/types";


export type Drag = { x: number; y: number; hold: boolean };

export type EngineHandle = {
  startCamera: () => Promise<void>;
  startStudio: () => Promise<void>;
  setDelegate: (delegate: "CPU" | "GPU") => void;
  stop: () => void;
  dispose: () => void;
};

type Lm = { x: number; y: number; z?: number; visibility?: number };
type Job = "face" | "pose" | "hands" | "segment";

function flip(lm: Lm): Pt {
  return { x: 1 - lm.x, y: lm.y };
}

function seen(lm: Lm | undefined, min = 0.25): lm is Lm {
  if (!lm) return false;
  const v = lm.visibility ?? 1;
  return v >= min && lm.x >= -0.2 && lm.x <= 1.2 && lm.y >= -0.2 && lm.y <= 1.4;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "Shader failed to compile.";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function program(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("Could not create a program.");
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "Program failed to link.");
  }
  return p;
}

function makeTex(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Could not create a texture.");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The product photograph could not be loaded."));
    img.src = url;
  });
}

export function startEngine(opts: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  getRequest: () => FrameRequest;
  drag: Drag;
  onMetrics: (metrics: LiveMetrics) => void;
  onStatus: (status: string) => void;
}): EngineHandle {
  const { video, canvas, getRequest, drag, onMetrics, onStatus } = opts;
  const glMaybe = canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: false, antialias: false });
  if (!glMaybe) throw new Error("WebGL2 is not available in this browser.");
  const gl: WebGL2RenderingContext = glMaybe;

  const composite = program(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
  const garmentMeshProg = program(gl, GARMENT_MESH_VERT, GARMENT_MESH_FRAG);
  const spriteProg = program(gl, SPRITE_VERT, SPRITE_FRAG);
  const camTex = makeTex(gl, gl.LINEAR);
  const prodTex = makeTex(gl, gl.LINEAR);
  const maskTex = makeTex(gl, gl.NEAREST);
  const spriteTex = makeTex(gl, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.bindTexture(gl.TEXTURE_2D, prodTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.bindTexture(gl.TEXTURE_2D, spriteTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

  const garmentMeshBuf = gl.createBuffer();
  const garmentMeshIndexBuf = gl.createBuffer();
  const garmentMeshVao = gl.createVertexArray();
  gl.bindVertexArray(garmentMeshVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, garmentMeshBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 256 * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, garmentMeshIndexBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, 1024 * 2, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  const garmentUniform = {
    product: gl.getUniformLocation(garmentMeshProg, "uProduct"),
    mask: gl.getUniformLocation(garmentMeshProg, "uMask"),
    camera: gl.getUniformLocation(garmentMeshProg, "uCamera"),
    hasMask: gl.getUniformLocation(garmentMeshProg, "uHasMask"),
    invResolution: gl.getUniformLocation(garmentMeshProg, "uInvResolution"),
    hand0: gl.getUniformLocation(garmentMeshProg, "uHand0"),
    hand1: gl.getUniformLocation(garmentMeshProg, "uHand1"),
    handR: gl.getUniformLocation(garmentMeshProg, "uHandR"),
    hasHands: gl.getUniformLocation(garmentMeshProg, "uHasHands"),
    protectC: gl.getUniformLocation(garmentMeshProg, "uProtectC"),
    protectH: gl.getUniformLocation(garmentMeshProg, "uProtectHalf"),
    protectCos: gl.getUniformLocation(garmentMeshProg, "uProtectCos"),
    protectSin: gl.getUniformLocation(garmentMeshProg, "uProtectSin"),
    tint: gl.getUniformLocation(garmentMeshProg, "uTint"),
    tintOn: gl.getUniformLocation(garmentMeshProg, "uTintOn"),
  };

  const spriteBuf = gl.createBuffer();
  const spriteVao = gl.createVertexArray();
  gl.bindVertexArray(spriteVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 4096 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindVertexArray(null);

  const loc = (name: string) => gl.getUniformLocation(composite, name);
  const u = {
    mode: loc("uMode"),
    hasMask: loc("uHasMask"),
    hasArms: loc("uHasArms"),
    cover: loc("uCoverSkin"),
    full: loc("uFullTex"),
    topL: loc("uTopL"),
    topR: loc("uTopR"),
    botL: loc("uBotL"),
    botR: loc("uBotR"),
    shL: loc("uShL"),
    shR: loc("uShR"),
    elL: loc("uElbowL"),
    wrL: loc("uWristL"),
    elR: loc("uElbowR"),
    wrR: loc("uWristR"),
    armW: loc("uArmW"),
    hairC: loc("uHairC"),
    hairH: loc("uHairHalf"),
    hairCos: loc("uHairCos"),
    hairSin: loc("uHairSin"),
    protectC: loc("uProtectC"),
    protectH: loc("uProtectHalf"),
    drag: loc("uDrag"),
    tint: loc("uTint"),
    tintOn: loc("uTintOn"),
    hand0: loc("uHand0"),
    hand1: loc("uHand1"),
    handR: loc("uHandR"),
    hasHands: loc("uHasHands"),
    nails: loc("uNails"),
    nailCount: loc("uNailCount"),
    polish: loc("uPolish"),
    nailHalf: loc("uNailHalf"),
    nailTip: loc("uNailTip"),
    nailStart: loc("uNailStart"),
    backdrop: loc("uBackdrop"),
    hasProduct: loc("uHasProduct"),
  };
  const spriteTint = gl.getUniformLocation(spriteProg, "uTint");
  const spriteTintOn = gl.getUniformLocation(spriteProg, "uTintOn");
  const spriteLens = gl.getUniformLocation(spriteProg, "uLens");

  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((item) => (typeof item === "string" ? item : "")).join(" ");
    if (text.includes("INFO:") || text.includes("XNNPACK") || text.includes("TensorFlow")) return;
    originalError.apply(console, args as never);
  };
  let disposed = false;
  let raf = 0;
  let clock = 0;
  let faceReady = false;
  let bodyReady = false;
  let segReady = false;
  let faceInflight = false;
  let bodyInflight = false;
  let segInflight = false;
  let delegateName = "CPU";
  let delegateNote = "CPU. The picture is painted on its own loop. GPU is optional and reverts if a pass stalls.";
  let tracks = 0;
  let trackMark = performance.now();
  let trackFps = 0;
  const faceWorker = new Worker("/isibuko/tracker.js");
  const bodyWorker = new Worker("/isibuko/tracker.js");
  const segWorker = new Worker("/isibuko/tracker.js");
  let source: LiveMetrics["source"] = "off";
  let cameraSession = 0;
  let stopSource: (() => void) | null = null;
  let stillUploaded = false;
  let studioImg: HTMLImageElement | null = null;
  let status = "";
  let productUrl = "";
  let productImg: HTMLImageElement | null = null;
  let spriteUrl = "";
  let loadingUrl = "";
  let hasMask = false;
  const memory = new Map<string, Pt>();
  const nailBuf = new Float32Array(40);
  let faceLm: Lm[] | null = null;
  let headPose: HeadPose | null = null;
  let headPoseMs = 0;
  const headPoseSmoother = new HeadPoseSmoother();
  let poseLm: Lm[] | null = null;
  let poseWorld: { x: number; y: number; z: number }[] | null = null;
  let handLms: Lm[][] = [];
  let faceMiss = 0;
  let poseMiss = 0;
  const times = { face: 0, pose: 0, hand: 0, segment: 0, composite: 0 };
  let frames = 0;
  let fpsMark = performance.now();
  let fps = 0;
  let lastMetric = 0;
  let lastLoopAt = 0;
  const frameBudget = new FrameBudgetMonitor();
  const blit = document.createElement("canvas");
  const blitCtx = blit.getContext("2d", { alpha: false });
  const scratch = document.createElement("canvas");
  const scratchCtx = scratch.getContext("2d", { alpha: false });
  const probe = document.createElement("canvas");
  probe.width = 4;
  probe.height = 4;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  let backdrop: [number, number, number] = [0.72, 0.7, 0.67];
  let loggedFace = false;
  let probeTick = 0;
  let faceTick = 0;
  let poseTick = 0;
  let handTick = 0;
  let poseCrop = false;
  let segmentEdge = 144;
  const sentAt = { face: 0, pose: 0, hands: 0, segment: 0 };
  const hits = { face: 0, pose: 0, hands: 0, segment: 0 };
  const rate = { face: 0, pose: 0, hands: 0, segment: 0 };
  let rateMark = performance.now();
  let lastMaskAt = 0;
  const pendingRoi: Partial<Record<Job, NormRect>> = {};
  let gpuFallback = false;
  let motion: LiveMetrics["motion"] = "unknown";
  let motionHold: LiveMetrics["motion"] = "unknown";
  let shoulderPrev: { x: number; y: number; span: number; at: number } | null = null;

  function setStatus(next: string) {
    if (next === status) return;
    status = next;
    onStatus(next);
  }

  function remember(key: string, point: Pt): Pt {
    const next = smoothPoint(memory.get(key) ?? null, point, 0.48);
    memory.set(key, next);
    return next;
  }

  let closing = false;
  function clearSource() {
    closing = true;
    try {
      lastLoopAt = 0;
      frameBudget.reset();
      stopSource?.();
      stopSource = null;
      studioImg = null;
      stillUploaded = false;
      faceLm = null;
      headPose = null;
      headPoseMs = 0;
      headPoseSmoother.reset();
      poseLm = null;
      poseWorld = null;
      handLms = [];
      hasMask = false;
      lastMaskAt = 0;
      shoulderPrev = null;
      motion = "unknown";
      motionHold = "unknown";
      source = "off";
    } finally {
      closing = false;
    }
  }

  function frameSize(): { w: number; h: number } | null {
    if (source === "studio" && studioImg?.naturalWidth) return { w: studioImg.naturalWidth, h: studioImg.naturalHeight };
    if (video.readyState >= 2 && video.videoWidth) return { w: video.videoWidth, h: video.videoHeight };
    return null;
  }

  function frameSource(): HTMLVideoElement | HTMLImageElement | null {
    if (source === "studio" && studioImg) return studioImg;
    if (video.readyState >= 2 && video.videoWidth) return video;
    return null;
  }

  async function applyStream(stream: MediaStream, extra?: () => void) {
    clearSource();
    video.srcObject = stream;
    video.muted = true;
    try {
      await video.play();
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
      throw error;
    }
    source = "camera";
    cameraSession = applySessionEvent({ session: cameraSession, source: "off" }, "camera").session;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (closing || disposed || source !== "camera") return;
        clearSource();
        setStatus("The camera stopped. Start it again when you are ready.");
      });
    }
    stopSource = () => {
      extra?.();
      stream.getTracks().forEach((track) => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
    };
  }

  async function startCamera() {
    const existing = video.srcObject;
    const tracks = existing instanceof MediaStream ? existing.getVideoTracks() : [];
    if (reuseLiveCamera(source, tracks)) {
      setStatus("Live camera. Frames stay on this device. Changing the piece does not stop the camera.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    await applyStream(stream);
    setStatus("Live camera. Frames stay on this device.");
  }

  async function startStudio() {
    const img = await loadImage("/studio/person.jpg");
    clearSource();
    studioImg = img;
    stillUploaded = false;
    source = "studio";
    cameraSession = applySessionEvent({ session: cameraSession, source: "off" }, "studio").session;
    stopSource = () => {
      studioImg = null;
    };
    setStatus("Studio photograph for testing only. This is not your camera.");
  }

  function resize() {
    const size = frameSize();
    if (!size) return;
    const scale = Math.min(1, 840 / Math.max(size.w, size.h));
    const w = Math.max(2, Math.round(size.w * scale));
    const h = Math.max(2, Math.round(size.h * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function vec(name: WebGLUniformLocation | null, p: Pt) {
    gl.uniform2f(name, p.x, p.y);
  }

  function appendSprite(data: number[], sprite: Sprite) {
    const W = canvas.width;
    const H = canvas.height;
    const px = sprite.cx * W;
    const py = sprite.cy * H;
    const pw = sprite.w * W;
    const ph = sprite.h * H;
    const c = Math.cos(sprite.rot);
    const s = Math.sin(sprite.rot);
    const corners: [number, number, number, number][] = [
      [-pw / 2, -ph / 2, 0, 1],
      [pw / 2, -ph / 2, 1, 1],
      [pw / 2, ph / 2, 1, 0],
      [-pw / 2, ph / 2, 0, 0],
    ];
    const pts = corners.map(([lx, ly, uu, vv]) => {
      const x = px + lx * c - ly * s;
      const y = py + lx * s + ly * c;
      return [(x / W) * 2 - 1, 1 - (y / H) * 2, uu, vv] as const;
    });
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = pts[i]!;
      data.push(p[0], p[1], p[2], p[3]);
    }
  }

  function ensureProduct(url: string | null) {
    if (!url || url === productUrl || url === loadingUrl) return;
    loadingUrl = url;
    void loadImage(url)
      .then((img) => {
        if (disposed || loadingUrl !== url) return;
        productImg = img;
        productUrl = url;
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.bindTexture(gl.TEXTURE_2D, prodTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.bindTexture(gl.TEXTURE_2D, spriteTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        spriteUrl = url;
      })
      .catch(() => {
        if (!disposed) setStatus("The product photograph failed to load.");
      });
  }

  let switchKey = "";
  let switchStarted = 0;
  let switchMs: number | null = null;

  function watchSwitch(request: FrameRequest) {
    const key = `${request.productId ?? ""}|${request.image ?? ""}|${(request.tint ?? []).join(",")}|${request.sizeScale}|${request.category ?? ""}`;
    if (key === switchKey) return;
    switchKey = key;
    switchStarted = source === "off" ? 0 : performance.now();
  }

  function draw(request: FrameRequest) {
    const t0 = performance.now();
    const category = request.category;
    const mode = regionMode(category);
    const modeId = mode === "clothing" ? 1 : mode === "hair" ? 2 : 0;
    const tint = request.tint;
    const dragPt = { x: drag.x, y: drag.y };
    const picture = frameSource();

    gl.useProgram(composite);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, camTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (picture && source === "studio") {
      if (!stillUploaded) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
        stillUploaded = true;
      }
    } else if (picture && blitCtx) {
      if (blit.width !== canvas.width || blit.height !== canvas.height) {
        blit.width = canvas.width;
        blit.height = canvas.height;
      }
      blitCtx.drawImage(picture, 0, 0, blit.width, blit.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blit);
    } else if (picture) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    }
    gl.uniform1i(gl.getUniformLocation(composite, "uCam"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prodTex);
    gl.uniform1i(gl.getUniformLocation(composite, "uProd"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(gl.getUniformLocation(composite, "uMask"), 2);
    gl.uniform1i(u.mode, modeId);
    gl.uniform1f(u.hasMask, hasMask ? 1 : 0);
    gl.uniform1f(u.cover, 1);
    gl.uniform1f(u.full, category === "pants" || category === "dress" || category === "skirt" ? 1 : 0);
    gl.uniform3f(u.tint, tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1);
    gl.uniform1f(u.tintOn, tint ? 1 : 0);
    gl.uniform2f(u.drag, mode === "hair" ? dragPt.x : 0, mode === "hair" ? dragPt.y : 0);
    gl.uniform1f(u.hasProduct, productImg ? 1 : 0);
    gl.uniform3f(u.backdrop, backdrop[0], backdrop[1], backdrop[2]);

    const facePts = faceLm;
    const hair = facePts
      ? hairFrame(
          remember("forehead", flip(facePts[10]!)),
          remember("chin", flip(facePts[152]!)),
          remember("cheekL", flip(facePts[234]!)),
          remember("cheekR", flip(facePts[454]!)),
        )
      : null;
    if (hair) {
      gl.uniform2f(u.hairC, hair.center.x, hair.center.y);
      gl.uniform2f(u.hairH, hair.halfW, hair.halfH);
      gl.uniform1f(u.hairCos, Math.cos(hair.rot));
      gl.uniform1f(u.hairSin, Math.sin(hair.rot));
      gl.uniform2f(u.protectC, hair.protect.center.x, hair.protect.center.y);
      gl.uniform2f(u.protectH, hair.protect.halfW, hair.protect.halfH);
    } else {
      gl.uniform2f(u.hairC, 0.5, 0.4);
      gl.uniform2f(u.hairH, 0.2, 0.3);
      gl.uniform1f(u.hairCos, 1);
      gl.uniform1f(u.hairSin, 0);
      gl.uniform2f(u.protectC, 0.5, 0.4);
      gl.uniform2f(u.protectH, 0.12, 0.16);
    }

    const poseOk = poseLm && seen(poseLm[11], 0.2) && seen(poseLm[12], 0.2);
    let shL: Pt | null = null;
    let shR: Pt | null = null;
    let hipL: Pt | null = null;
    let hipR: Pt | null = null;
    if (poseOk && poseLm) {
      shL = remember("shL", flip(poseLm[11]!));
      shR = remember("shR", flip(poseLm[12]!));
      const shoulderW = Math.hypot(shR.x - shL.x, shR.y - shL.y);
      const hipFallback = shoulderW * 1.05;
      hipL = seen(poseLm[23], 0.15) ? remember("hipL", flip(poseLm[23]!)) : { x: shL.x, y: Math.min(0.98, shL.y + hipFallback) };
      hipR = seen(poseLm[24], 0.15) ? remember("hipR", flip(poseLm[24]!)) : { x: shR.x, y: Math.min(0.98, shR.y + hipFallback) };
      if (hipL.y > 1.02) hipL = { ...hipL, y: Math.min(hipL.y, shL.y + shoulderW * 1.2) };
      if (hipR.y > 1.02) hipR = { ...hipR, y: Math.min(hipR.y, shR.y + shoulderW * 1.2) };
    }
    const elL = poseLm && shL && seen(poseLm[13], 0.2) ? remember("elL", flip(poseLm[13]!)) : shL;
    const elR = poseLm && shR && seen(poseLm[14], 0.2) ? remember("elR", flip(poseLm[14]!)) : shR;
    const wrL = poseLm && elL && seen(poseLm[15], 0.2) ? remember("wrL", flip(poseLm[15]!)) : elL;
    const wrR = poseLm && elR && seen(poseLm[16], 0.2) ? remember("wrR", flip(poseLm[16]!)) : elR;
    const proposedClothing =
      mode === "clothing" && shL && shR && hipL && hipR && category && category !== "wig" && category !== "hat"
        ? clothingQuad({
            shoulderL: shL,
            shoulderR: shR,
            hipL,
            hipR,
            category: category as "shirt" | "jacket" | "dress" | "pants" | "skirt",
            ankleL: poseLm && seen(poseLm[27], 0.2) ? remember("anL", flip(poseLm[27]!)) : null,
            ankleR: poseLm && seen(poseLm[28], 0.2) ? remember("anR", flip(poseLm[28]!)) : null,
            scale: request.sizeScale,
            sleevesInPhoto: false,
          })
        : null;
    // Never render a garment from stale, collapsed, or runaway pose landmarks.
    const clothing = proposedClothing && isPlausibleClothingQuad(proposedClothing) ? proposedClothing : null;
    const shirtMesh =
      category === "shirt" && clothing && productImg && hasMask && shL && shR && hipL && hipR
        ? buildShirtMesh({
            shoulderL: { x: shL.x + dragPt.x, y: shL.y + dragPt.y },
            shoulderR: { x: shR.x + dragPt.x, y: shR.y + dragPt.y },
            hipL: { x: hipL.x + dragPt.x, y: hipL.y + dragPt.y },
            hipR: { x: hipR.x + dragPt.x, y: hipR.y + dragPt.y },
            elbowL: elL ? { x: elL.x + dragPt.x, y: elL.y + dragPt.y } : null,
            elbowR: elR ? { x: elR.x + dragPt.x, y: elR.y + dragPt.y } : null,
            wristL: wrL ? { x: wrL.x + dragPt.x, y: wrL.y + dragPt.y } : null,
            wristR: wrR ? { x: wrR.x + dragPt.x, y: wrR.y + dragPt.y } : null,
          }, { scale: Math.min(1.3, Math.max(0.75, request.sizeScale)) })
        : null;
    const useShirtMesh = Boolean(shirtMesh && shirtMesh.parts.some((part) => part.kind === "torso"));
    gl.uniform1i(u.mode, useShirtMesh ? 0 : modeId);
    const chin = memory.get("chin") ?? null;
    if (clothing && chin && shL && shR && (category === "shirt" || category === "jacket" || category === "dress")) {
      const shoulderY = (shL.y + shR.y) / 2;
      const neckY = chin.y + Math.max(0.015, (shoulderY - chin.y) * 0.16);
      const dy = neckY - (clothing.topL.y + clothing.topR.y) / 2;
      clothing.topL = { ...clothing.topL, y: clothing.topL.y + dy };
      clothing.topR = { ...clothing.topR, y: clothing.topR.y + dy };
    }
    const shift = mode === "clothing" ? dragPt : { x: 0, y: 0 };
    const move = (p: Pt): Pt => ({ x: p.x + shift.x, y: p.y + shift.y });
    if (clothing && shL && shR) {
      vec(u.topL, move(clothing.topL));
      vec(u.topR, move(clothing.topR));
      vec(u.botL, move(clothing.botL));
      vec(u.botR, move(clothing.botR));
      vec(u.shL, move(shL));
      vec(u.shR, move(shR));
      vec(u.elL, move(elL ?? shL));
      vec(u.wrL, move(wrL ?? elL ?? shL));
      vec(u.elR, move(elR ?? shR));
      vec(u.wrR, move(wrR ?? elR ?? shR));
      const span = Math.hypot(shR.x - shL.x, shR.y - shL.y);
      const arm = Math.hypot((elL ?? shL).x - shL.x, (elL ?? shL).y - shL.y);
      gl.uniform1f(u.armW, Math.max(arm * 0.42, span * 0.2));
      gl.uniform1f(u.hasArms, hasSleeves(category) && elL && wrL && elR && wrR ? 1 : 0);
    } else {
      gl.uniform1f(u.hasArms, 0);
      vec(u.topL, { x: 0, y: 0 });
      vec(u.topR, { x: 0, y: 0 });
      vec(u.botL, { x: 0, y: 0 });
      vec(u.botR, { x: 0, y: 0 });
      vec(u.shL, { x: 0, y: 0 });
      vec(u.shR, { x: 0, y: 0 });
    }

    const palms: Pt[] = [];
    let handR = 0.06;
    for (const hand of handLms) {
      if (hand.length < 21 || !hand[9]) continue;
      palms.push(remember(`palm${palms.length}`, flip(hand[9])));
      if (hand[0] && hand[9]) {
        const reach = Math.hypot(hand[0].x - hand[9].x, hand[0].y - hand[9].y);
        handR = Math.max(handR, reach * 0.85);
      }
    }
    gl.uniform1f(u.hasHands, palms.length ? 1 : 0);
    gl.uniform2f(u.hand0, palms[0]?.x ?? -2, palms[0]?.y ?? -2);
    gl.uniform2f(u.hand1, palms[1]?.x ?? -2, palms[1]?.y ?? -2);
    gl.uniform1f(u.handR, handR);

    // Phase 1 shirt path: draw a body-constrained mesh over the camera.
    // The legacy fragment-warp remains active whenever this mesh cannot be
    // built, the product image is absent, or segmentation is unavailable.
    if (useShirtMesh && shirtMesh && productImg && hasMask) {
      const packed: number[] = [];
      for (const vertex of shirtMesh.vertices) {
        packed.push(vertex.x * 2 - 1, 1 - vertex.y * 2, vertex.u, 1 - vertex.v);
      }
      gl.useProgram(garmentMeshProg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prodTex);
      gl.uniform1i(garmentUniform.product, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.uniform1i(garmentUniform.mask, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      gl.uniform1i(garmentUniform.camera, 2);
      gl.uniform1f(garmentUniform.hasMask, 1);
      gl.uniform2f(garmentUniform.invResolution, 1 / Math.max(1, canvas.width), 1 / Math.max(1, canvas.height));
      gl.uniform2f(garmentUniform.hand0, palms[0]?.x ?? -2, palms[0]?.y ?? -2);
      gl.uniform2f(garmentUniform.hand1, palms[1]?.x ?? -2, palms[1]?.y ?? -2);
      gl.uniform1f(garmentUniform.handR, handR);
      gl.uniform1f(garmentUniform.hasHands, palms.length ? 1 : 0);
      gl.uniform2f(garmentUniform.protectC, hair?.protect.center.x ?? 0.5, hair?.protect.center.y ?? 0.4);
      gl.uniform2f(garmentUniform.protectH, hair?.protect.halfW ?? 0.12, hair?.protect.halfH ?? 0.16);
      gl.uniform1f(garmentUniform.protectCos, hair ? Math.cos(hair.protect.rot) : 1);
      gl.uniform1f(garmentUniform.protectSin, hair ? Math.sin(hair.protect.rot) : 0);
      gl.uniform3f(garmentUniform.tint, tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1);
      gl.uniform1f(garmentUniform.tintOn, tint ? 1 : 0);
      gl.bindVertexArray(garmentMeshVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, garmentMeshBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(packed), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, garmentMeshIndexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(shirtMesh.indices), gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, shirtMesh.indices.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND);
    }

    nailBuf.fill(0);
    const segments = category === "nails" ? nailSegments(handLms.map((hand) => hand.map((lm) => flip(lm)))) : [];
    segments.forEach((seg, i) => {
      nailBuf[i * 4] = seg.tip.x;
      nailBuf[i * 4 + 1] = seg.tip.y;
      nailBuf[i * 4 + 2] = seg.base.x;
      nailBuf[i * 4 + 3] = seg.base.y;
    });
    gl.uniform4fv(u.nails, nailBuf);
    gl.uniform1i(u.nailCount, segments.length);
    const polish = tint ?? [0.9, 0.72, 0.74];
    gl.uniform3f(u.polish, polish[0], polish[1], polish[2]);
    const shape = nailShapeFactors(request.nail);
    gl.uniform1f(u.nailHalf, shape.half);
    gl.uniform1f(u.nailTip, shape.tip);
    gl.uniform1f(u.nailStart, shape.start);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const sprites: Sprite[] = [];
    const aspect = productImg && productImg.naturalWidth ? productImg.naturalHeight / productImg.naturalWidth : 1;
    const scale = request.sizeScale;
    if (productImg && facePts && hair) {
      const eyeL = remember("eyeL", {
        x: (flip(facePts[33]!).x + flip(facePts[133]!).x) / 2,
        y: (flip(facePts[33]!).y + flip(facePts[133]!).y) / 2,
      });
      const eyeR = remember("eyeR", {
        x: (flip(facePts[263]!).x + flip(facePts[362]!).x) / 2,
        y: (flip(facePts[263]!).y + flip(facePts[362]!).y) / 2,
      });
      const rot = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
      const level = eyeL.x <= eyeR.x ? rot : rot + Math.PI;
      const upright = Math.atan2(Math.sin(level), Math.cos(level));
      const forehead = memory.get("forehead")!;
      const cheekL = memory.get("cheekL")!;
      const cheekR = memory.get("cheekR")!;
      const chin = memory.get("chin")!;
      const faceW = Math.hypot(cheekR.x - cheekL.x, cheekR.y - cheekL.y);
      if (category === "glasses") sprites.push(nudge(glassesSprite(eyeL, eyeR, aspect, scale)));
      if (category === "hat") sprites.push(nudge(hatSprite(forehead, cheekL, cheekR, upright, aspect, scale, request.productId === "hat-cap")));
      if (category === "wig" && hasMask) {
        const opening = request.productId === "wig-bob" ? 0.37 : request.productId === "wig-braids" ? 0.11 : 0.12;
        sprites.push(nudge(wigSprite(forehead, chin, cheekL, cheekR, aspect, scale, opening, 0.42)));
      }
      if (category === "earrings") {
        const midX = (cheekL.x + cheekR.x) / 2;
        sprites.push(nudge(earringSprite(cheekL, faceW, aspect, scale, 0, cheekL.x < midX ? -1 : 1)));
        sprites.push(nudge(earringSprite(cheekR, faceW, aspect, scale, 0, cheekR.x < midX ? -1 : 1)));
      }
      if (category === "necklace") {
        const left = shL ?? { x: chin.x - faceW, y: chin.y + faceW * 0.85 };
        const right = shR ?? { x: chin.x + faceW, y: chin.y + faceW * 0.85 };
        sprites.push(nudge(necklaceSprite(chin, left, right, aspect, scale, 0)));
      }
    }
    if (productImg && (category === "watch" || category === "bracelet") && poseLm) {
      for (const [e, w] of [
        [13, 15],
        [14, 16],
      ] as const) {
        if (seen(poseLm[e], 0.25) && seen(poseLm[w], 0.25)) {
          const elbow = remember(`e${e}`, flip(poseLm[e]!));
          const wrist = remember(`w${w}`, flip(poseLm[w]!));
          sprites.push(nudge(category === "bracelet" ? braceletSprite(elbow, wrist, aspect, scale) : watchSprite(elbow, wrist, aspect, scale)));
        }
      }
    }
    if (productImg && category === "ring") {
      for (const hand of handLms) {
        if (hand.length >= 21 && hand[15] && hand[16]) {
          sprites.push(nudge(ringSprite(flip(hand[15]), flip(hand[16]), aspect, scale)));
        }
      }
    }
    if (sprites.length && spriteUrl) {
      const data: number[] = [];
      for (const sprite of sprites) appendSprite(data, sprite);
      gl.useProgram(spriteProg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, spriteTex);
      gl.uniform1i(gl.getUniformLocation(spriteProg, "uSprite"), 0);
      gl.uniform3f(spriteTint, tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1);
      gl.uniform1f(spriteTintOn, tint ? 1 : 0);
      gl.uniform1f(spriteLens, category === "glasses" ? 1 : 0);
      gl.bindVertexArray(spriteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
      const arr = new Float32Array(data);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 4);
      gl.disable(gl.BLEND);
    }
    if (switchStarted && (!request.image || productUrl === request.image)) {
      switchMs = Math.round(performance.now() - switchStarted);
      switchStarted = 0;
    }
    times.composite = performance.now() - t0;
    try {
      noteLiveFrame({
        atMs: performance.now(),
        cameraSession,
        productId: request.productId,
        pose: Boolean(poseLm),
        fps,
        compositeMs: times.composite,
        receipt: null,
      });
      notePerception({
        atMs: performance.now(),
        face: faceLm,
        pose: poseLm,
        hands: handLms,
        silhouetteFresh: hasMask && lastMaskAt > 0 && performance.now() - lastMaskAt < 700,
      });
    } catch {
      // A feasibility log must not stop the camera or the photographic composite.
    }
  }

  function nudge(sprite: Sprite): Sprite {
    return { ...sprite, cx: sprite.cx + drag.x, cy: sprite.cy + drag.y };
  }

  function sampleBackdrop(picture: HTMLVideoElement | HTMLImageElement, w: number, h: number) {
    if (!probeCtx) return;
    probeTick += 1;
    if (probeTick % 12 !== 1) return;
    probeCtx.drawImage(picture, 0, 0, w, h, 0, 0, 4, 4);
    const data = probeCtx.getImageData(0, 0, 4, 4).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const i of [0, 3, 12, 15]) {
      r += data[i * 4] ?? 0;
      g += data[i * 4 + 1] ?? 0;
      b += data[i * 4 + 2] ?? 0;
    }
    backdrop = [r / 4 / 255, g / 4 / 255, b / 4 / 255];
  }

  function deliver(worker: Worker, job: Job, edge: number, roi: NormRect, release: () => void) {
    const picture = frameSource();
    const size = frameSize();
    if (!picture || !size) {
      release();
      return;
    }
    const crop = pixelCrop(roi, size.w, size.h);
    const scale = Math.min(1, edge / Math.max(crop.sw, crop.sh));
    const w = Math.max(2, Math.round(crop.sw * scale));
    const h = Math.max(2, Math.round(crop.sh * scale));
    clock = Math.max(clock + 1, Math.round(performance.now()));
    const ts = clock;
    if (regionMode(getRequest().category) === "hair") sampleBackdrop(picture, size.w, size.h);
    pendingRoi[job] = roi;
    const options = { resizeWidth: w, resizeHeight: h, resizeQuality: "low" as const };
    const bitmapPromise = createImageBitmap(picture, crop.sx, crop.sy, crop.sw, crop.sh, options).catch(() => {
      if (!scratchCtx) throw new Error("Could not copy a frame for tracking.");
      scratch.width = w;
      scratch.height = h;
      scratchCtx.drawImage(picture, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
      return createImageBitmap(scratch);
    });
    void bitmapPromise
      .then((bitmap) => {
        if (disposed) {
          bitmap.close();
          release();
          return;
        }
        worker.postMessage({ type: "frame", job, bitmap, ts }, [bitmap]);
      })
      .catch((error) => {
        console.warn(error instanceof Error ? error.message : "Could not copy a frame for tracking.");
        release();
      });
  }

  function faceRoi(): NormRect {
    faceTick += 1;
    if (!faceLm || shouldRefreshFull(faceTick, 5)) return FULL_FRAME;
    const ids = [10, 152, 234, 454];
    return roiFromPoints(ids.map((id) => faceLm?.[id]), 0.6) ?? FULL_FRAME;
  }

  function poseRoi(): NormRect {
    poseTick += 1;
    if (!poseLm || shouldRefreshFull(poseTick, 4)) return FULL_FRAME;
    const ids = [0, 11, 12, 13, 14, 15, 16, 23, 24];
    return roiFromPoints(ids.map((id) => poseLm?.[id]), 0.55) ?? FULL_FRAME;
  }

  function handsRoi(): NormRect {
    handTick += 1;
    if (handLms.length === 0 || shouldRefreshFull(handTick, 3)) return FULL_FRAME;
    return roiFromPoints(handLms.flat(), 0.8) ?? FULL_FRAME;
  }

  function pumpFace() {
    if (faceInflight || !faceReady || disposed || !frameSource()) return;
    const now = performance.now();
    const gap = cadenceMs(getRequest().category, times.segment).face;
    if (!due(now, sentAt.face, gap, false)) return;
    faceInflight = true;
    sentAt.face = now;
    const roi = faceRoi();
    deliver(faceWorker, "face", inferenceEdge("face", times.face, !isFullFrame(roi)), roi, () => {
      faceInflight = false;
    });
  }

  function pumpBody() {
    if (bodyInflight || !bodyReady || disposed || !frameSource()) return;
    const now = performance.now();
    const cadence = cadenceMs(getRequest().category, times.segment);
    const poseDue = due(now, sentAt.pose, cadence.pose, false);
    const handsDue = due(now, sentAt.hands, cadence.hands, false);
    const job: Job | null = poseDue ? "pose" : handsDue ? "hands" : null;
    if (!job) return;
    bodyInflight = true;
    sentAt[job] = now;
    const roi = job === "pose" ? poseRoi() : handsRoi();
    if (job === "pose") poseCrop = !isFullFrame(roi);
    const last = job === "pose" ? times.pose : times.hand;
    deliver(bodyWorker, job, inferenceEdge(job, last, !isFullFrame(roi)), roi, () => {
      bodyInflight = false;
    });
  }

  function pumpSeg() {
    if (segInflight || !segReady || disposed || !frameSource()) return;
    const category = getRequest().category;
    const needs = regionMode(category) === "clothing" || regionMode(category) === "hair";
    if (!needs) return;
    const now = performance.now();
    const gap = cadenceMs(category, times.segment).segment;
    if (hasMask && maskIsFresh(now, lastMaskAt, gap)) return;
    if (!due(now, sentAt.segment, gap, false)) return;
    segInflight = true;
    sentAt.segment = now;
    segmentEdge = inferenceEdge("segment", times.segment, false);
    deliver(segWorker, "segment", segmentEdge, FULL_FRAME, () => {
      segInflight = false;
    });
  }

  function uploadMask(width: number, height: number, data: Uint8Array) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) rgba[i * 4] = data[i] ?? 0;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    hasMask = true;
  }

  function applyResult(msg: {
    job?: Job;
    ms?: number;
    face?: Lm[] | null;
    pose4?: number[] | null;
    pose?: Lm[] | null;
    world?: { x: number; y: number; z: number }[] | null;
    hands?: Lm[][];
    mask?: { width: number; height: number; data: Uint8Array } | null;
    error?: string;
  }) {
    const now = performance.now();
    tracks += 1;
    if (now - trackMark > 1000) {
      trackFps = Math.round((tracks * 1000) / (now - trackMark));
      tracks = 0;
      trackMark = now;
    }
    const ms = msg.ms ?? 0;
    if (msg.job === "face" || msg.job === "pose" || msg.job === "hands" || msg.job === "segment") {
      hits[msg.job] += 1;
    }
    if (now - rateMark > 1000) {
      const seconds = (now - rateMark) / 1000;
      rate.face = Math.round(hits.face / seconds);
      rate.pose = Math.round(hits.pose / seconds);
      rate.hands = Math.round(hits.hands / seconds);
      rate.segment = Math.round(hits.segment / seconds);
      hits.face = 0;
      hits.pose = 0;
      hits.hands = 0;
      hits.segment = 0;
      rateMark = now;
    }
    if (delegateName === "GPU" && ms > GPU_STALL_MS && !gpuFallback) {
      gpuFallback = true;
      delegateNote = `GPU pass took ${Math.round(ms)} ms and was stalling the tracker. Reverted to CPU. The picture kept its own loop.`;
      bootDelegate("CPU");
    }
    if (msg.error) console.warn(msg.job, msg.error);
    const roi = (msg.job && pendingRoi[msg.job]) || FULL_FRAME;
    if (!loggedFace && msg.job === "face") {
      loggedFace = true;
      const info = msg as { count?: number; width?: number; height?: number };
      console.info(`face frame ${info.width}x${info.height} faces ${info.count ?? 0} in ${ms.toFixed(0)} ms`);
    }
    if (msg.job === "face") {
      times.face = ms;
      const face = remapList(msg.face, roi);
      if (face) {
        faceLm = face;
        faceMiss = 0;
        const poseStarted = performance.now();
        const estimate = fuseHeadPose(msg.pose4, face);
        if (estimate) headPose = headPoseSmoother.update(estimate, now);
        headPoseMs = performance.now() - poseStarted;
      } else if (++faceMiss > 8) {
        faceLm = null;
        headPose = null;
        headPoseMs = 0;
        headPoseSmoother.reset();
      }
    } else if (msg.job === "pose") {
      times.pose = ms;
      const pose = remapList(msg.pose, roi);
      if (pose) {
        poseLm = pose;
        poseWorld = msg.world ?? null;
        poseMiss = 0;
      } else if (++poseMiss > 6) {
        poseLm = null;
        poseWorld = null;
      }
    } else if (msg.job === "hands") {
      times.hand = ms;
      handLms = (msg.hands ?? []).map((hand) => remapList(hand, roi) ?? hand);
    } else if (msg.job === "segment" && msg.mask) {
      times.segment = ms;
      uploadMask(msg.mask.width, msg.mask.height, msg.mask.data);
      lastMaskAt = performance.now();
    } else if (msg.job === "segment") {
      times.segment = ms;
    }
  }

  function publish(request: FrameRequest) {
    const now = performance.now();
    frames += 1;
    if (now - fpsMark > 500) {
      fps = Math.round((frames * 1000) / (now - fpsMark));
      frames = 0;
      fpsMark = now;
    }
    if (now - lastMetric < 250) return;
    lastMetric = now;
    let faceWidthCm: number | null = null;
    let wristCm: number | null = null;
    if (poseLm && faceLm && seen(poseLm[11]) && seen(poseLm[12])) {
      const shoulderPx = Math.hypot(poseLm[11]!.x - poseLm[12]!.x, poseLm[11]!.y - poseLm[12]!.y);
      const facePx = Math.hypot(faceLm[234]!.x - faceLm[454]!.x, faceLm[234]!.y - faceLm[454]!.y);
      const shoulderCm = poseWorld ? Math.hypot(poseWorld[11]!.x - poseWorld[12]!.x, poseWorld[11]!.y - poseWorld[12]!.y, poseWorld[11]!.z - poseWorld[12]!.z) * 100 : null;
      if (shoulderCm && shoulderPx > 0.04) faceWidthCm = (shoulderCm * facePx) / shoulderPx;
    }
    const hand = handLms[0];
    if (hand && hand[5] && hand[17]) {
      const palm = Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y, (hand[5].z ?? 0) - (hand[17].z ?? 0));
      if (palm > 0.03 && palm < 0.16) wristCm = palm * 100 * 2.1;
    }
    const body = estimateFromWorld({
      world: poseWorld,
      heightCm: request.heightCm,
      faceWidthCm,
      wristCm,
    });
    readMotion(poseLm, now);
    const elbows = countJoints(poseLm, [13, 14]);
    const wrists = countJoints(poseLm, [15, 16]);
    const budget = frameBudget.snapshot();
    onMetrics({
      fps,
      face: Boolean(faceLm),
      pose: Boolean(poseLm),
      hands: handLms.length,
      segment: hasMask,
      faceMs: Math.round(times.face),
      poseMs: Math.round(times.pose),
      handMs: Math.round(times.hand),
      segmentMs: Math.round(times.segment),
      compositeMs: Math.round(times.composite),
      headPose,
      headPoseMs: Math.round(headPoseMs * 10) / 10,
      frameIntervalMs: budget.frameIntervalMs,
      frameWorkMs: budget.frameWorkMs,
      meanFrameIntervalMs: budget.meanFrameIntervalMs,
      p95FrameIntervalMs: budget.p95FrameIntervalMs,
      meanFrameWorkMs: budget.meanFrameWorkMs,
      jankFrames: budget.jankFrames,
      longestFrameIntervalMs: budget.longestFrameIntervalMs,
      frameSamples: budget.sampleCount,
      budgetRung: budget.rung,
      budgetReason: budget.reason,
      switchMs,
      delegate: faceReady || bodyReady || segReady ? delegateName : "loading",
      delegateNote,
      trackFps,
      faceHz: rate.face,
      poseHz: rate.pose,
      handHz: rate.hands,
      segmentHz: rate.segment,
      maskAgeMs: hasMask && lastMaskAt ? Math.round(now - lastMaskAt) : 0,
      shoulders: Boolean(poseLm && seen(poseLm[11], 0.2) && seen(poseLm[12], 0.2)),
      elbows,
      wrists,
      motion,
      cameraSession,
      poseCrop,
      segmentEdge,
      source,
      body,
      productId: request.productId,
    });
  }

  function countJoints(pose: Lm[] | null, ids: number[]): number {
    if (!pose) return 0;
    return ids.filter((id) => seen(pose[id], 0.2)).length;
  }

  function readMotion(pose: Lm[] | null, now: number) {
    if (!pose || !seen(pose[11], 0.2) || !seen(pose[12], 0.2)) {
      motion = "unknown";
      motionHold = "unknown";
      return;
    }
    const x = (pose[11]!.x + pose[12]!.x) / 2;
    const y = (pose[11]!.y + pose[12]!.y) / 2;
    const span = Math.hypot(pose[12]!.x - pose[11]!.x, pose[12]!.y - pose[11]!.y);
    if (!shoulderPrev) {
      shoulderPrev = { x, y, span, at: now };
      motion = "unknown";
      return;
    }
    const dt = now - shoulderPrev.at;
    if (dt < 280) return;
    const moved = Math.hypot(x - shoulderPrev.x, y - shoulderPrev.y);
    const spanRatio = shoulderPrev.span > 0.02 ? Math.abs(span - shoulderPrev.span) / shoulderPrev.span : 0;
    const next = spanRatio > 0.08 ? "turning" : moved > 0.02 ? "moving" : "still";
    if (next === "still") motion = "still";
    else if (next === motion) motion = next;
    else if (motionHold === next) motion = next;
    motionHold = next;
    shoulderPrev = { x, y, span, at: now };
  }

  let pageHidden = false;
  const onVisibility = () => {
    pageHidden = document.visibilityState === "hidden";
    if (pageHidden) lastLoopAt = 0;
  };
  document.addEventListener("visibilitychange", onVisibility);

  function loop(_now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (pageHidden) {
      lastLoopAt = 0;
      return;
    }
    if (!frameSource()) {
      lastLoopAt = 0;
      return;
    }
    const frameStarted = performance.now();
    const frameIntervalMs = lastLoopAt > 0 ? frameStarted - lastLoopAt : 0;
    lastLoopAt = frameStarted;
    if (!drag.hold) {
      drag.x *= 0.86;
      drag.y *= 0.86;
    }
    resize();
    const request = getRequest();
    watchSwitch(request);
    ensureProduct(request.image);
    pumpFace();
    pumpBody();
    pumpSeg();
    try {
      draw(request);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The composite failed.");
    }
    frameBudget.observe(frameIntervalMs, performance.now() - frameStarted);
    publish(request);
    if (source !== "off") {
      if (trackerFault) setStatus(trackerFault);
      else if (!faceReady && !bodyReady) {
        setStatus(source === "camera" ? "Live camera is on. The tracker is still loading. The picture keeps moving." : "Studio photograph for testing only. The tracker is still loading.");
      } else if (!faceLm && request.category !== "pants" && request.category !== "skirt" && request.category !== "nails" && request.category !== "bracelet") setStatus("Looking for a face. Face the mirror.");
      else if (regionMode(request.category) === "clothing" && !poseLm) setStatus("Step back so both shoulders are in frame.");
      else if (request.category === "nails" && handLms.length === 0) setStatus("Hold a hand up so the nails can be read.");
      else if (source === "camera") setStatus("Live camera. You are wearing it. Move — changing the piece does not stop the camera.");
      else setStatus("Studio photograph for testing only. This is not your camera.");
    }
  }

  function releaseInflight(kind: "face" | "body" | "seg") {
    if (kind === "face") faceInflight = false;
    else if (kind === "body") bodyInflight = false;
    else segInflight = false;
  }

  let trackerRecoveries = 0;
  let trackerFault = "";
  function attach(worker: Worker, kind: "face" | "body" | "seg") {
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; message?: string; delegate?: string; job?: Job };
      if (msg.type === "ready") {
        if (kind === "face") faceReady = true;
        else if (kind === "body") bodyReady = true;
        else segReady = true;
        if (msg.delegate) delegateName = msg.delegate;
        return;
      }
      if (msg.type === "progress") return;
      if (msg.type === "error") {
        releaseInflight(kind);
        trackerFault = msg.message || "The live tracker failed to start.";
        setStatus(trackerFault);
        return;
      }
      if (msg.type === "result") {
        if (msg.job === "segment") segInflight = false;
        else if (msg.job === "face") faceInflight = false;
        else bodyInflight = false;
        applyResult(event.data as Parameters<typeof applyResult>[0]);
      }
    };
    worker.onerror = () => {
      releaseInflight(kind);
      if (disposed) return;
      if (trackerRecoveries < 1) {
        trackerRecoveries += 1;
        trackerFault = "";
        setStatus("The tracker hit an error and is starting again. The picture stays up.");
        bootDelegate(delegateName === "GPU" ? "GPU" : "CPU");
        return;
      }
      setStatus("The live tracker stopped. Stop the mirror and start it again.");
    };
  }

  function bootDelegate(delegate: "CPU" | "GPU") {
    faceReady = false;
    bodyReady = false;
    segReady = false;
    trackerFault = "";
    faceInflight = false;
    bodyInflight = false;
    segInflight = false;
    delegateName = delegate;
    if (delegate === "CPU" && !gpuFallback) {
      delegateNote = "CPU. Face, body and segmentation run on separate workers. The picture is not waiting on them.";
    }
    faceWorker.postMessage({ type: "init", models: ["face"], delegate });
    bodyWorker.postMessage({ type: "init", models: ["pose", "hands"], delegate });
    segWorker.postMessage({ type: "init", models: ["segment"], delegate });
  }

  function boot() {
    setStatus("Turn on your camera to wear this live.");
    attach(faceWorker, "face");
    attach(bodyWorker, "body");
    attach(segWorker, "seg");
    bootDelegate("CPU");
    raf = requestAnimationFrame(loop);
  }

  boot();

  return {
    startCamera,
    startStudio,
    setDelegate(delegate) {
      gpuFallback = false;
      if (delegate === "GPU") {
        delegateNote = "GPU requested. If a pass stalls, the tracker returns to CPU without stopping the camera.";
      }
      bootDelegate(delegate);
    },
    stop() {
      clearSource();
      setStatus("Mirror paused.");
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearSource();
      faceWorker.terminate();
      bodyWorker.terminate();
      segWorker.terminate();
      document.removeEventListener("visibilitychange", onVisibility);
      console.error = originalError;
    },
  };
}
