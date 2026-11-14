import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flickImpulse, handPushOnHair, restHairCard, restStrands, stepHairCard, stepStrandGroups } from "./hair-motion.ts";

describe("wig card motion", () => {
  it("settles near a slight hang when the head is still", () => {
    let state = restHairCard();
    state = { ...state, y: 0.03, py: 0.03 };
    for (let i = 0; i < 90; i++) {
      state = stepHairCard(state, { dt: 1 / 60, headVelocity: { x: 0, y: 0 }, handPush: { x: 0, y: 0 } }).state;
    }
    assert.ok(Math.abs(state.x) < 0.004);
    assert.ok(state.y > 0 && state.y < 0.02);
  });

  it("swings opposite a head turn and stays bounded", () => {
    let state = restHairCard();
    let hemX = 0;
    for (let i = 0; i < 8; i++) {
      const step = stepHairCard(state, { dt: 1 / 60, headVelocity: { x: 1.4, y: 0 }, handPush: { x: 0, y: 0 } });
      state = step.state;
      hemX = step.hemX;
    }
    assert.ok(hemX < 0);
    assert.ok(hemX >= -0.042);
  });

  it("lets the left group lead the right group on a flick", () => {
    assert.equal(flickImpulse(0.2, 0.4), 0);
    assert.ok(flickImpulse(0.2, 2.4) > 1);
    let strands = restStrands();
    let left = 0;
    let right = 0;
    for (let i = 0; i < 6; i++) {
      const step = stepStrandGroups(strands, {
        dt: 1 / 60,
        headVelocity: { x: 2, y: 0 },
        handPush: { x: 0, y: 0 },
        impulse: 3,
      });
      strands = step.state;
      left = step.leftX;
      right = step.rightX;
    }
    assert.ok(left < right);
  });

  it("gives way when a hand is in the hair and ignores a distant hand", () => {
    const close = handPushOnHair({ x: 0.5, y: 0.3 }, [{ x: 0.42, y: 0.34 }], 0.16);
    assert.ok(close.x > 0);
    const far = handPushOnHair({ x: 0.5, y: 0.3 }, [{ x: 0.05, y: 0.9 }], 0.16);
    assert.equal(far.x, 0);
    assert.equal(far.y, 0);
  });
});
