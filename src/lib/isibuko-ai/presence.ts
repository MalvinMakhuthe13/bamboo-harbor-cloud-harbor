/**
 * Hold, then fade, when a tracker loses a category.
 * A new sighting eases in. Nothing here predicts a body the camera cannot see.
 */
export class PresenceGate {
  alpha = 0;
  private missingSince: number | null = null;

  update(now: number, present: boolean, confidence: number): number {
    const trusted = present && confidence >= 0.35;
    if (trusted) {
      this.missingSince = null;
      this.alpha = Math.min(1, this.alpha + 0.4);
      return this.alpha;
    }
    if (this.missingSince == null) this.missingSince = now;
    const gone = now - this.missingSince;
    if (gone < 160) return this.alpha;
    const faded = Math.max(0, 1 - (gone - 160) / 220);
    this.alpha = Math.min(this.alpha, faded);
    return this.alpha;
  }

  reset(): void {
    this.alpha = 0;
    this.missingSince = null;
  }
}
