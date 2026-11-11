/** Product-side parser decision. Mirrors services/isibuko-infer/parser_adapter.py. */

export const FASHN_LABEL_COUNT = 18;

export type ParserRouteInput = {
  parserId: string;
  segmentationFree: boolean;
  garmentPhotoType: string;
};

export type ParserRoute = {
  code: string;
  run: boolean;
  usesNvidiaParser: boolean;
};

export function routeParser(input: ParserRouteInput): ParserRoute {
  if (input.parserId === "fashn-human-parser") {
    return { code: "PARSER_NON_COMMERCIAL", run: false, usesNvidiaParser: true };
  }
  if (input.parserId === "mediapipe-selfie" || input.parserId === "sam2") {
    return { code: "INSUFFICIENT_LABELS", run: false, usesNvidiaParser: false };
  }
  if (input.parserId === "none" && input.segmentationFree && input.garmentPhotoType === "flat-lay") {
    return { code: "PARSER_SKIPPED", run: true, usesNvidiaParser: false };
  }
  return { code: "PARSER_REQUIRED", run: false, usesNvidiaParser: false };
}
