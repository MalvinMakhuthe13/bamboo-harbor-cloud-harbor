/**
 * Browser-local video frame extraction for seller-provided demonstration clips.
 *
 * The source File is decoded through a temporary object URL. No video bytes or
 * frames are uploaded. Consumers own each yielded ImageBitmap and must close it.
 */

export type VideoFrameSample = {
  timestampMs: number;
  width: number;
  height: number;
  bitmap: ImageBitmap;
};

export type VideoFrameOptions = {
  intervalMs?: number;
  maxDurationMs?: number;
  maxDimension?: number;
};

export const DEFAULT_VIDEO_FRAME_OPTIONS = {
  intervalMs: 200,
  maxDurationMs: 90_000,
  maxDimension: 640,
} as const;

export function validateMotionVideoFile(file: File): string | null {
  if (!file.size) return "The selected video is empty.";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const supportedExtension = ["mp4", "webm", "mov", "m4v"].includes(extension);
  if (!file.type.startsWith("video/") && !supportedExtension) {
    return "Choose an MP4, WebM, MOV or M4V video.";
  }
  if (file.size > 250 * 1024 * 1024) {
    return "Choose a video smaller than 250 MB.";
  }
  return null;
}

export function buildFrameTimestamps(
  durationMs: number,
  intervalMs = DEFAULT_VIDEO_FRAME_OPTIONS.intervalMs,
  maxDurationMs = DEFAULT_VIDEO_FRAME_OPTIONS.maxDurationMs,
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Frame interval must be a positive number.");
  }
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new RangeError("Maximum duration must be a positive number.");
  }
  const sampledDuration = Math.min(durationMs, maxDurationMs);
  const frameCount = Math.max(1, Math.ceil(sampledDuration / intervalMs));
  return Array.from({ length: frameCount }, (_, index) =>
    Math.min(index * intervalMs, Math.max(0, sampledDuration - 1)),
  ).filter((timestamp, index, all) => index === 0 || timestamp > all[index - 1]);
}

/** Decode and yield frames one at a time to keep memory bounded on phones. */
export async function* extractVideoFrames(
  file: File,
  options: VideoFrameOptions = {},
): AsyncGenerator<VideoFrameSample> {
  const validationError = validateMotionVideoFile(file);
  if (validationError) throw new Error(validationError);

  const intervalMs = options.intervalMs ?? DEFAULT_VIDEO_FRAME_OPTIONS.intervalMs;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_VIDEO_FRAME_OPTIONS.maxDurationMs;
  const maxDimension = options.maxDimension ?? DEFAULT_VIDEO_FRAME_OPTIONS.maxDimension;
  if (!Number.isFinite(maxDimension) || maxDimension < 32) {
    throw new RangeError("Maximum frame dimension must be at least 32 pixels.");
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    if (video.readyState < 1) await waitForMediaEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("The selected video has no readable duration.");
    }
    const timestamps = buildFrameTimestamps(video.duration * 1000, intervalMs, maxDurationMs);
    if (!timestamps.length) throw new Error("No video frames could be scheduled.");

    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not create a video frame canvas.");

    for (const timestampMs of timestamps) {
      const targetTime = timestampMs / 1000;
      if (Math.abs(video.currentTime - targetTime) > 0.001) {
        const seeked = waitForMediaEvent(video, "seeked");
        video.currentTime = targetTime;
        await seeked;
      }
      context.drawImage(video, 0, 0, width, height);
      const bitmap = await createImageBitmap(canvas);
      yield { timestampMs, width, height, bitmap };
    }
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: "loadedmetadata" | "seeked",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      media.removeEventListener(eventName, onSuccess);
      media.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not decode this video. Try an MP4 or WebM file."));
    };
    media.addEventListener(eventName, onSuccess, { once: true });
    media.addEventListener("error", onError, { once: true });
  });
}
