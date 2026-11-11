/** On-device perception cache. It stores landmarks. It does not generate a garment. */

export type Landmark = { x: number; y: number; visibility?: number };

export type PerceptionSample = {
  atMs: number;
  face: Landmark[] | null;
  pose: Landmark[] | null;
  hands: Landmark[][];
  silhouetteFresh: boolean;
};

export type PerceptionState = {
  atMs: number;
  face: boolean;
  head: boolean;
  shoulders: number;
  torso: boolean;
  arms: number;
  hands: number;
  silhouette: boolean;
  occlusion: "clear" | "partial" | "lost";
  motion: "unknown" | "still" | "moving";
  reused: { face: boolean; pose: boolean; hands: boolean; silhouette: boolean };
};

const VIS = 0.2;
const TTL = { face: 200, pose: 160, hands: 240, silhouette: 700 };

function seen(point: Landmark | undefined): boolean {
  return Boolean(point) && (point?.visibility ?? 1) >= VIS;
}

function count(points: Landmark[] | null, ids: number[]): number {
  if (!points) return 0;
  return ids.filter((id) => seen(points[id])).length;
}

export class PerceptionCache {
  private faceAt = -1;
  private poseAt = -1;
  private handsAt = -1;
  private silhouetteAt = -1;
  private face: Landmark[] | null = null;
  private pose: Landmark[] | null = null;
  private handCount = 0;
  private lastShoulder: { x: number; y: number } | null = null;
  private motion: PerceptionState["motion"] = "unknown";

  update(sample: PerceptionSample): PerceptionState {
    const reused = { face: false, pose: false, hands: false, silhouette: false };
    if (sample.face && sample.face.length > 0) {
      this.face = sample.face;
      this.faceAt = sample.atMs;
    } else if (this.face && sample.atMs - this.faceAt <= TTL.face) {
      reused.face = true;
    } else {
      this.face = null;
    }

    if (sample.pose && count(sample.pose, [11, 12]) > 0) {
      this.pose = sample.pose;
      this.poseAt = sample.atMs;
    } else if (this.pose && sample.atMs - this.poseAt <= TTL.pose) {
      reused.pose = true;
    } else {
      this.pose = null;
    }

    const liveHands = sample.hands.filter((hand) => hand.length >= 21).length;
    if (liveHands > 0) {
      this.handCount = liveHands;
      this.handsAt = sample.atMs;
    } else if (this.handCount > 0 && sample.atMs - this.handsAt <= TTL.hands) {
      reused.hands = true;
    } else {
      this.handCount = 0;
    }

    if (sample.silhouetteFresh) this.silhouetteAt = sample.atMs;
    const silhouette = sample.silhouetteFresh || (this.silhouetteAt >= 0 && sample.atMs - this.silhouetteAt <= TTL.silhouette);
    if (!sample.silhouetteFresh && silhouette) reused.silhouette = true;

    const shoulders = count(this.pose, [11, 12]);
    const hips = count(this.pose, [23, 24]);
    const arms = count(this.pose, [13, 14]);
    const wrists = count(this.pose, [15, 16]);
    const faceOn = Boolean(this.face && this.face.length > 0);
    const head = faceOn || seen(this.pose?.[0]);
    let occlusion: PerceptionState["occlusion"] = "clear";
    if (!this.pose) occlusion = "lost";
    else if (shoulders < 2 || !silhouette || arms < 2) occlusion = "partial";

    if (shoulders === 2 && this.pose) {
      const left = this.pose[11]!;
      const right = this.pose[12]!;
      const mid = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      // A reused sample is the same pose. Do not treat that hold as "still" and wipe the last motion.
      if (!reused.pose && this.lastShoulder) {
        const delta = Math.hypot(mid.x - this.lastShoulder.x, mid.y - this.lastShoulder.y);
        this.motion = delta > 0.015 ? "moving" : "still";
      }
      if (!reused.pose) this.lastShoulder = mid;
    } else if (!this.pose) {
      this.motion = "unknown";
    }

    return {
      atMs: sample.atMs,
      face: faceOn,
      head,
      shoulders,
      torso: shoulders === 2 && hips === 2,
      arms,
      hands: Math.max(this.handCount, wrists > 0 ? 1 : 0),
      silhouette,
      occlusion,
      motion: this.motion,
      reused,
    };
  }
}

const mirrorPerception = new PerceptionCache();

/** Fed by the camera loop. A failure here must not be allowed to stop the composite. */
export function notePerception(sample: PerceptionSample): PerceptionState {
  return mirrorPerception.update(sample);
}
