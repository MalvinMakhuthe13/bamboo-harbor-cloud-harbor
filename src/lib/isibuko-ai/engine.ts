import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { estimateFromWorld } from "@/lib/isibuko-ai/fit";
import {
  clothingQuad,
  armsAreRaised,
  earringSprite,
  glassesSprite,
  hairFrame,
  hasSleeves,
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
import { COMPOSITE_FRAG, FULLSCREEN_VERT, SPRITE_FRAG, SPRITE_VERT } from "@/lib/isibuko-ai/shaders";
import type { FrameRequest, LiveMetrics, Pt } from "@/lib/isibuko-ai/types";

const WASM = "/mediapipe";
const FACE_MODEL = "/models/face_landmarker.task";
const HAND_MODEL = "/models/hand_landmarker.task";
const POSE_MODEL = "/models/pose_landmarker_lite.task";
const SEG_MODEL = "/models/selfie_multiclass.tflite";

export type Drag = { x: number; y: number; hold: boolean };

export type EngineHandle = {
  startCamera: () => Promise<void>;
  startStudio: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
};

type Lm = NormalizedLandmark;

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
  autoStudio?: boolean;
}): EngineHandle {
  const { video, canvas, getRequest, drag, onMetrics, onStatus, autoStudio } = opts;
  const glMaybe = canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: false, antialias: false });
  if (!glMaybe) throw new Error("WebGL2 is not available in this browser.");
  const gl: WebGL2RenderingContext = glMaybe;

  const composite = program(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
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
  };
  const spriteTint = gl.getUniformLocation(spriteProg, "uTint");
  const spriteTintOn = gl.getUniformLocation(spriteProg, "uTintOn");
  const spriteLens = gl.getUniformLocation(spriteProg, "uLens");

  const infer = document.createElement("canvas");
  const inferCtx = infer.getContext("2d", { willReadFrequently: true });
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((item) => (typeof item === "string" ? item : "")).join(" ");
    if (text.includes("INFO:") || text.includes("XNNPACK") || text.includes("TensorFlow")) return;
    originalError.apply(console, args as never);
  };
  let face: FaceLandmarker | null = null;
  let pose: PoseLandmarker | null = null;
  let hands: HandLandmarker | null = null;
  let segmenter: ImageSegmenter | null = null;
  let disposed = false;
  let raf = 0;
  let clock = 0;
  let frameN = 0;
  let source: LiveMetrics["source"] = "off";
  let stopSource: (() => void) | null = null;
  let status = "";
  let productUrl = "";
  let productImg: HTMLImageElement | null = null;
  let spriteUrl = "";
  let loadingUrl = "";
  let hasMask = false;
  let maskNote = "mask off";
  let maskBuf: Uint8Array | null = null;
  const memory = new Map<string, Pt>();
  const nailBuf = new Float32Array(40);
  let faceLm: Lm[] | null = null;
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

  function clearSource() {
    stopSource?.();
    stopSource = null;
    source = "off";
  }

  async function useStream(stream: MediaStream, kind: "camera" | "studio", extra?: () => void) {
    clearSource();
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    source = kind;
    stopSource = () => {
      extra?.();
      stream.getTracks().forEach((track) => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
    };
  }

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    await useStream(stream, "camera");
    setStatus("Live camera. Frames stay on this device.");
  }

  async function startStudio() {
    const img = await loadImage("/studio/person.jpg");
    const still = document.createElement("canvas");
    still.width = img.naturalWidth;
    still.height = img.naturalHeight;
    const ctx = still.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the studio photograph.");
    const paint = () => {
      ctx.drawImage(img, 0, 0);
    };
    paint();
    const stream = still.captureStream(20);
    const timer = window.setInterval(paint, 250);
    await useStream(stream, "studio", () => window.clearInterval(timer));
    setStatus("Studio photograph. Start the camera for a live mirror. Same pipeline.");
  }

  function inferenceFrame() {
    if (!inferCtx || video.readyState < 2 || !video.videoWidth) return false;
    const scale = Math.min(1, 256 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(2, Math.round(video.videoWidth * scale));
    const h = Math.max(2, Math.round(video.videoHeight * scale));
    if (infer.width !== w || infer.height !== h) {
      infer.width = w;
      infer.height = h;
    }
    inferCtx.drawImage(video, 0, 0, w, h);
    return true;
  }

  function resize() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, 840 / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
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

  function draw(request: FrameRequest) {
    const t0 = performance.now();
    const category = request.category;
    const mode = regionMode(category);
    const modeId = mode === "clothing" ? 1 : mode === "hair" ? 2 : 0;
    const tint = request.tint;
    const dragPt = { x: drag.x, y: drag.y };

    gl.useProgram(composite);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, camTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (video.readyState >= 2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
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
    gl.uniform1f(u.full, category === "pants" || category === "dress" ? 1 : 0);
    gl.uniform3f(u.tint, tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1);
    gl.uniform1f(u.tintOn, tint ? 1 : 0);
    gl.uniform2f(u.drag, mode === "hair" ? dragPt.x : 0, mode === "hair" ? dragPt.y : 0);

    const facePts = faceLm;
    let hair = facePts
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
    const clothing =
      mode === "clothing" && shL && shR && hipL && hipR && category && category !== "wig" && category !== "hat"
        ? clothingQuad({
            shoulderL: shL,
            shoulderR: shR,
            hipL,
            hipR,
            category: category as "shirt" | "jacket" | "dress" | "pants",
            ankleL: poseLm && seen(poseLm[27], 0.2) ? remember("anL", flip(poseLm[27]!)) : null,
            ankleR: poseLm && seen(poseLm[28], 0.2) ? remember("anR", flip(poseLm[28]!)) : null,
            scale: request.sizeScale,
          })
        : null;
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
      const elL = poseLm && seen(poseLm[13], 0.2) ? remember("elL", flip(poseLm[13]!)) : shL;
      const elR = poseLm && seen(poseLm[14], 0.2) ? remember("elR", flip(poseLm[14]!)) : shR;
      const wrL = poseLm && seen(poseLm[15], 0.2) ? remember("wrL", flip(poseLm[15]!)) : elL;
      const wrR = poseLm && seen(poseLm[16], 0.2) ? remember("wrR", flip(poseLm[16]!)) : elR;
      vec(u.elL, move(elL));
      vec(u.wrL, move(wrL));
      vec(u.elR, move(elR));
      vec(u.wrR, move(wrR));
      const arm = Math.hypot(elL.x - shL.x, elL.y - shL.y);
      const raised = armsAreRaised({ shoulderL: shL, shoulderR: shR, elbowL: elL, elbowR: elR, wristL: wrL, wristR: wrR });
      gl.uniform1f(u.armW, Math.max(arm * 0.34, 0.035));
      gl.uniform1f(u.hasArms, hasSleeves(category) && raised ? 1 : 0);
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
      const forehead = memory.get("forehead")!;
      const cheekL = memory.get("cheekL")!;
      const cheekR = memory.get("cheekR")!;
      const chin = memory.get("chin")!;
      const faceW = Math.hypot(cheekR.x - cheekL.x, cheekR.y - cheekL.y);
      if (category === "glasses") sprites.push(nudge(glassesSprite(eyeL, eyeR, aspect, scale)));
      if (category === "wig") sprites.push(nudge(wigSprite(forehead, chin, cheekL, cheekR, aspect, scale)));
      if (category === "hat") sprites.push(nudge(hatSprite(forehead, cheekL, cheekR, rot, aspect, scale, request.productId === "hat-cap")));
      if (category === "earrings") {
        sprites.push(nudge(earringSprite(cheekL, faceW, aspect, scale, 0, -1)));
        sprites.push(nudge(earringSprite(cheekR, faceW, aspect, scale, 0, 1)));
      }
      if (category === "necklace") {
        const left = shL ?? { x: chin.x - faceW, y: chin.y + faceW * 0.85 };
        const right = shR ?? { x: chin.x + faceW, y: chin.y + faceW * 0.85 };
        sprites.push(nudge(necklaceSprite(chin, left, right, aspect, scale, 0)));
      }
    }
    if (productImg && category === "watch" && poseLm) {
      for (const [e, w] of [
        [13, 15],
        [14, 16],
      ] as const) {
        if (seen(poseLm[e], 0.25) && seen(poseLm[w], 0.25)) {
          sprites.push(nudge(watchSprite(remember(`e${e}`, flip(poseLm[e]!)), remember(`w${w}`, flip(poseLm[w]!)), aspect, scale)));
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
    times.composite = performance.now() - t0;
  }

  function nudge(sprite: Sprite): Sprite {
    return { ...sprite, cx: sprite.cx + drag.x, cy: sprite.cy + drag.y };
  }

  function track(now: number) {
    const request = getRequest();
    const category = request.category;
    clock = Math.max(clock + 1, now);
    try {
      if (face && frameN % 2 === 0) {
        const t = performance.now();
        const res = face.detectForVideo(infer, clock);
        times.face = performance.now() - t;
        if (res.faceLandmarks[0]) {
          faceLm = res.faceLandmarks[0];
          faceMiss = 0;
        } else if (++faceMiss > 8) faceLm = null;
      }
      const wantPose = !category || category === "shirt" || category === "jacket" || category === "dress" || category === "pants" || category === "watch" || category === "necklace";
      const wantHands = category === "nails" || category === "ring";
      const wantSeg = regionMode(category) !== "none";
      if (pose && wantPose && frameN % 4 === 1) {
        const t = performance.now();
        const res = pose.detectForVideo(infer, clock);
        times.pose = performance.now() - t;
        if (res.landmarks[0]) {
          poseLm = res.landmarks[0];
          poseWorld = res.worldLandmarks[0] ?? null;
          poseMiss = 0;
        } else if (++poseMiss > 6) {
          poseLm = null;
          poseWorld = null;
        }
      }
      if (hands && wantHands && frameN % 6 === 5) {
        const t = performance.now();
        const res = hands.detectForVideo(infer, clock);
        times.hand = performance.now() - t;
        handLms = res.landmarks;
      }
      if (segmenter && wantSeg && frameN % 8 === 3) {
        const t = performance.now();
        const res = segmenter.segmentForVideo(infer, clock);
        times.segment = performance.now() - t;
        const mask = res.categoryMask;
        if (mask) {
          const src = mask.getAsUint8Array();
          if (!maskBuf || maskBuf.length !== src.length) maskBuf = new Uint8Array(src.length);
          maskBuf.set(src);
          const counts = [0, 0, 0, 0, 0, 0, 0];
          for (let i = 0; i < maskBuf.length; i += 47) {
            const value = maskBuf[i] ?? 0;
            counts[Math.min(6, value)] = (counts[Math.min(6, value)] ?? 0) + 1;
          }
          maskNote = `${mask.width}x${mask.height} ${counts.join("/")}`;
          const rgba = new Uint8Array(mask.width * mask.height * 4);
          for (let i = 0; i < src.length; i++) rgba[i * 4] = src[i] ?? 0;
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.bindTexture(gl.TEXTURE_2D, maskTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mask.width, mask.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          hasMask = true;
          mask.close();
        } else maskNote = "no category mask";
      }
    } catch (error) {
      maskNote = error instanceof Error ? error.message : "Tracking failed on this frame.";
    }
    frameN += 1;
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
      delegate: "CPU",
      source,
      body,
      productId: request.productId,
    });
  }

  function loop(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (!drag.hold) {
      drag.x *= 0.86;
      drag.y *= 0.86;
    }
    if (video.readyState < 2 || !video.videoWidth) return;
    if (!inferenceFrame()) return;
    resize();
    const request = getRequest();
    ensureProduct(request.image);
    track(now);
    try {
      draw(request);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The composite failed.");
    }
    publish(request);
    if (source !== "off") {
      if (!faceLm && request.category !== "pants" && request.category !== "nails") setStatus("Looking for a face. Face the mirror.");
      else if (regionMode(request.category) === "clothing" && !poseLm) setStatus("Step back so both shoulders are in frame.");
      else if (request.category === "nails" && handLms.length === 0) setStatus("Hold a hand up so the nails can be read.");
      else if (source === "camera") setStatus("Live camera. Changing products does not restart it.");
      else setStatus("Studio photograph. Start the camera when you want the live mirror.");
    }
  }

  async function boot() {
    setStatus("Loading Isibuko models on this device.");
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM);
      const base = { delegate: "CPU" as const };
      face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { ...base, modelAssetPath: FACE_MODEL },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      pose = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { ...base, modelAssetPath: POSE_MODEL },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      hands = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...base, modelAssetPath: HAND_MODEL },
        runningMode: "VIDEO",
        numHands: 2,
      });
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { ...base, modelAssetPath: SEG_MODEL },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      if (disposed) return;
      setStatus("Models ready.");
      if (autoStudio) {
        try {
          await startStudio();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "The studio photograph could not start.");
        }
      }
      raf = requestAnimationFrame(loop);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Isibuko models failed to load.");
    }
  }

  void boot();

  return {
    startCamera,
    startStudio,
    stop() {
      clearSource();
      setStatus("Mirror paused.");
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearSource();
      face?.close();
      pose?.close();
      hands?.close();
      segmenter?.close();
      console.error = originalError;
    },
  };
}
