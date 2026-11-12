/* global importScripts, Vision */

/* Classic worker.
   MediaPipe's FilesetResolver points at /mediapipe/vision_wasm_internal.js and then
   calls importScripts. A module worker has no importScripts, so the library falls
   through to dynamic import(), and Vite rewrites that to vision_wasm_internal.js?import
   which fails. importScripts of an already-loaded classic script does not run it again,
   but each task calls ModuleFactory and then deletes it. Re-eval the loader every time.
*/
var nativeImportScripts = importScripts;
var wasmSource = new Map();

function loadWasmLoader(url) {
  var code = wasmSource.get(url);
  if (!code) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error("WASM loader HTTP " + xhr.status + " for " + url);
    }
    code = xhr.responseText;
    wasmSource.set(url, code);
  }
  var factory = (0, eval)(code + "\n;ModuleFactory");
  if (typeof factory !== "function") throw new Error("WASM loader did not create ModuleFactory");
  self.ModuleFactory = factory;
}

self.importScripts = function () {
  for (var i = 0; i < arguments.length; i++) {
    var url = String(arguments[i]);
    if (url.indexOf("vision_wasm") !== -1 && url.indexOf(".js") !== -1) loadWasmLoader(url);
    else nativeImportScripts(url);
  }
};

importScripts("/mediapipe/vision_bundle.js");

var FaceLandmarker = Vision.FaceLandmarker;
var PoseLandmarker = Vision.PoseLandmarker;
var HandLandmarker = Vision.HandLandmarker;
var ImageSegmenter = Vision.ImageSegmenter;
var FilesetResolver = Vision.FilesetResolver;

var face = null;
var pose = null;
var hands = null;
var segmenter = null;
var want = { face: true, pose: true, hands: true, segment: true };

var originalError = console.error;
console.error = function () {
  var text = Array.prototype.join.call(arguments, " ");
  if (text.indexOf("INFO:") !== -1 || text.indexOf("XNNPACK") !== -1 || text.indexOf("TensorFlow") !== -1) return;
  originalError.apply(console, arguments);
};

function pack(lms) {
  if (!lms || !lms.length) return null;
  var out = [];
  for (var i = 0; i < lms.length; i++) {
    var lm = lms[i];
    out.push({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility });
  }
  return out;
}

function closeAll() {
  try { if (face) face.close(); } catch { /* A partially initialized tracker may not close cleanly. */ }
  try { if (pose) pose.close(); } catch { /* A partially initialized tracker may not close cleanly. */ }
  try { if (hands) hands.close(); } catch { /* A partially initialized tracker may not close cleanly. */ }
  try { if (segmenter) segmenter.close(); } catch { /* A partially initialized tracker may not close cleanly. */ }
  face = pose = hands = segmenter = null;
}

function note(message) {
  self.postMessage({ type: "progress", message: message });
}

async function build(delegate) {
  var vision = await FilesetResolver.forVisionTasks("/mediapipe");
  if (want.face) {
    note("Loading the face tracker (" + delegate + ").");
    face = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
  }
  if (want.pose) {
    note("Loading the body tracker (" + delegate + ").");
    pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate: delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  }
  if (want.hands) {
    note("Loading the hand tracker (" + delegate + ").");
    hands = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate: delegate },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }
  if (want.segment) {
    note("Loading the clothing segmenter (" + delegate + ").");
    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/models/selfie_multiclass.tflite", delegate: delegate },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  }
}

self.onmessage = async function (event) {
  var data = event.data;
  if (data.type === "init") {
    if (data.models && data.models.length) {
      want = { face: false, pose: false, hands: false, segment: false };
      for (var m = 0; m < data.models.length; m++) want[data.models[m]] = true;
    }
    try {
      closeAll();
      var delegate = data.delegate === "GPU" ? "GPU" : "CPU";
      // CPU is the default. GPU shares the browser graphics device with the mirror
      // and has stalled the picture on software GL. The page can request GPU and
      // will revert if a pass exceeds the stall budget.
      await build(delegate);
      self.postMessage({ type: "ready", delegate: delegate });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error && error.message ? error.message : "The live tracker failed to start.",
      });
    }
    return;
  }
  if (data.type !== "frame" || !data.bitmap || !data.job) return;
  var bitmap = data.bitmap;
  var ts = data.ts || 1;
  var job = data.job;
  var started = performance.now();
  try {
    if (job === "face" && face) {
      var fres = face.detectForVideo(bitmap, ts);
      var transform = fres.facialTransformationMatrixes && fres.facialTransformationMatrixes[0];
      var pose4 = transform && transform.data ? Array.from(transform.data) : null;
      self.postMessage({
        type: "result",
        job: job,
        ms: performance.now() - started,
        width: bitmap.width,
        height: bitmap.height,
        count: fres.faceLandmarks ? fres.faceLandmarks.length : 0,
        face: pack(fres.faceLandmarks && fres.faceLandmarks[0]),
        pose4: pose4,
      });
    } else if (job === "pose" && pose) {
      var pres = pose.detectForVideo(bitmap, ts);
      var world = null;
      if (pres.worldLandmarks && pres.worldLandmarks[0]) {
        world = [];
        for (var i = 0; i < pres.worldLandmarks[0].length; i++) {
          var w = pres.worldLandmarks[0][i];
          world.push({ x: w.x, y: w.y, z: w.z });
        }
      }
      self.postMessage({
        type: "result",
        job: job,
        ms: performance.now() - started,
        pose: pack(pres.landmarks && pres.landmarks[0]),
        world: world,
      });
    } else if (job === "hands" && hands) {
      var hres = hands.detectForVideo(bitmap, ts);
      var packed = [];
      var marks = hres.landmarks || [];
      for (var h = 0; h < marks.length; h++) {
        var one = pack(marks[h]);
        if (one) packed.push(one);
      }
      self.postMessage({ type: "result", job: job, ms: performance.now() - started, hands: packed });
    } else if (job === "segment" && segmenter) {
      var sres = segmenter.segmentForVideo(bitmap, ts);
      var mask = sres.categoryMask;
      if (mask) {
        var width = mask.width;
        var height = mask.height;
        var copy = new Uint8Array(mask.getAsUint8Array());
        mask.close();
        self.postMessage(
          { type: "result", job: job, ms: performance.now() - started, mask: { width: width, height: height, data: copy } },
          [copy.buffer],
        );
      } else {
        self.postMessage({ type: "result", job: job, ms: performance.now() - started, mask: null });
      }
    } else {
      self.postMessage({ type: "result", job: job, ms: performance.now() - started });
    }
  } catch (error) {
    self.postMessage({
      type: "result",
      job: job,
      ms: performance.now() - started,
      error: error && error.message ? error.message : "Tracking missed a frame.",
    });
  } finally {
    bitmap.close();
  }
};
