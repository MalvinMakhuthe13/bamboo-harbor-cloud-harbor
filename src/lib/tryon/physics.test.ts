import test from "node:test";
import assert from "node:assert/strict";
import { angleDeltaRadians, bodyMotionAcceleration, relativeMotionVelocity, frameDeltaSeconds, stepPendulum, trackingBlend, updatePinchState, stableHairJitter, hairSectionInfluence, hairSectionResponseHz, hairStrandDamping, VERLET_DAMP } from "./physics.ts";

test("uses a 60 FPS initial timestep", () => {
  assert.equal(frameDeltaSeconds(100, null), 1 / 60);
});

test("converts elapsed milliseconds into seconds", () => {
  assert.equal(frameDeltaSeconds(1016.6667, 1000), (1016.6667 - 1000) / 1000);
});

test("clamps long stalls to one 30 FPS step", () => {
  assert.equal(frameDeltaSeconds(5000, 1000), 1 / 30);
});

test("clamps very short frame deltas to a stable minimum", () => {
  assert.equal(frameDeltaSeconds(1001, 1000), 1 / 240);
});

test("handles invalid and backwards timestamps safely", () => {
  assert.equal(frameDeltaSeconds(1000, 1000), 1 / 60);
  assert.equal(frameDeltaSeconds(Number.NaN, 1000), 1 / 60);
});

test("pendulum remains finite at common frame rates", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const result = stepPendulum(0.2, 0.1, 0.03, dt);
    assert.ok(Number.isFinite(result.swing));
    assert.ok(Number.isFinite(result.vel));
  }
});

test("ear swing stays consistent across frame rates for the same head turn", () => {
  const simulate = (fps: number) => {
    const dt = 1 / fps;
    let swing = 0;
    let velocity = 0;
    for (let frame = 0; frame < fps; frame++) {
      const yawDelta = 0.8 * dt;
      const next = stepPendulum(swing, velocity, yawDelta, dt);
      swing = next.swing;
      velocity = next.vel;
    }
    return { swing, velocity };
  };
  const at30 = simulate(30);
  const at60 = simulate(60);
  const at120 = simulate(120);
  assert.ok(Math.abs(at30.swing - at60.swing) < 0.015);
  assert.ok(Math.abs(at60.swing - at120.swing) < 0.015);
  assert.ok(Math.abs(at30.velocity - at60.velocity) < 0.08);
  assert.ok(Math.abs(at60.velocity - at120.velocity) < 0.08);
});

test("pendulum safely ignores invalid motion samples", () => {
  const result = stepPendulum(0.2, 0.1, Number.NaN, 1 / 60);
  assert.ok(Number.isFinite(result.swing));
  assert.ok(Number.isFinite(result.vel));
});


test("tracking blend is stable and increases with response rate", () => {
  const slow = trackingBlend(1 / 60, 6);
  const fast = trackingBlend(1 / 60, 18);
  assert.ok(slow > 0 && slow < 1);
  assert.ok(fast > slow && fast < 1);
});

test("tracking blend is frame-rate consistent over equal elapsed time", () => {
  const at30 = 1 - Math.pow(1 - trackingBlend(1 / 30, 12), 1);
  const at60 = 1 - Math.pow(1 - trackingBlend(1 / 60, 12), 2);
  assert.ok(Math.abs(at30 - at60) < 1e-10);
});


test("pinch requires a deliberate close threshold", () => {
  assert.equal(updatePinchState(false, 0.06), false);
  assert.equal(updatePinchState(false, 0.05), true);
});

test("pinch hysteresis prevents flicker near the close threshold", () => {
  assert.equal(updatePinchState(true, 0.06), true);
  assert.equal(updatePinchState(true, 0.079), false);
});

test("invalid pinch samples do not cause an accidental release", () => {
  assert.equal(updatePinchState(true, Number.NaN), true);
});


test("an open hand releases an active pinch", () => {
  assert.equal(updatePinchState(true, Number.POSITIVE_INFINITY), false);
});


test("hair lock placement is deterministic across rebuilds", () => {
  assert.equal(stableHairJitter(12, 1), stableHairJitter(12, 1));
  assert.notEqual(stableHairJitter(12, 1), stableHairJitter(13, 1));
});

test("hair lock jitter stays in the unit interval", () => {
  for (let i = 0; i < 200; i++) {
    const value = stableHairJitter(i, 2);
    assert.ok(value >= 0 && value < 1);
  }
});


test("nearby hair locks follow faster than distant neighbouring locks", () => {
  const near = hairSectionInfluence(0, 1, 1 / 60, 1);
  const far = hairSectionInfluence(0, 1, 1 / 60, 3);
  assert.ok(near > far);
  assert.ok(far > 0);
  assert.ok(near < 1);
  assert.ok(hairSectionResponseHz(1) > hairSectionResponseHz(3));
});

test("hair follow influence is frame-rate consistent over equal elapsed time", () => {
  const at30 = hairSectionInfluence(0, 1, 1 / 30, 2);
  const at60 = hairSectionInfluence(hairSectionInfluence(0, 1, 1 / 60, 2), 1, 1 / 60, 2);
  assert.ok(Math.abs(at30 - at60) < 1e-10);
});

test("neighbour influence decays smoothly after a grab is released", () => {
  const held = hairSectionInfluence(0, 0.42, 1 / 60, 1);
  const released = hairSectionInfluence(held, 0, 1 / 60, 1);
  assert.ok(released >= 0);
  assert.ok(released < held);
});

test("invalid hair follow inputs remain bounded", () => {
  assert.equal(hairSectionInfluence(Number.NaN, Number.POSITIVE_INFINITY, 1 / 60, 1), 0);
  assert.ok(hairSectionInfluence(0.4, 1, 1 / 60, Number.NaN) >= 0);
});


test("ellipsoid projection leaves outside points untouched", async () => {
  const { projectOutsideEllipsoid } = await import("./physics.ts");
  assert.equal(projectOutsideEllipsoid({ x: 5, y: 0, z: 0 }, { x: 2, y: 3, z: 4 }), null);
});

test("ellipsoid projection clears interior points along the surface normal", async () => {
  const { projectOutsideEllipsoid } = await import("./physics.ts");
  const projected = projectOutsideEllipsoid({ x: 1, y: 0, z: 0 }, { x: 2, y: 3, z: 4 }, 0.2)!;
  assert.ok(Math.abs(projected.x - 2.2) < 1e-10);
  assert.equal(projected.y, 0);
  assert.equal(projected.z, 0);
});

test("ellipsoid projection handles the exact centre with a stable fallback normal", async () => {
  const { projectOutsideEllipsoid } = await import("./physics.ts");
  const projected = projectOutsideEllipsoid({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 }, 0.1)!;
  assert.ok(Number.isFinite(projected.x) && Number.isFinite(projected.y) && Number.isFinite(projected.z));
  assert.ok(projected.z < 0);
});

test("ellipsoid projection rejects invalid radii and clearance", async () => {
  const { projectOutsideEllipsoid } = await import("./physics.ts");
  assert.equal(projectOutsideEllipsoid({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 4 }), null);
  assert.equal(projectOutsideEllipsoid({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 }, -1), null);
});


test("ellipsoid contact removes inward velocity but preserves tangential sliding", async () => {
  const { resolveEllipsoidContact } = await import("./physics.ts");
  const result = resolveEllipsoidContact(
    { x: 1, y: 0, z: 0 },
    { x: 1.2, y: -1, z: 0 },
    { x: 2, y: 3, z: 4 },
    0.1,
    0,
  )!;
  const vx = result.position.x - result.previous.x;
  const vy = result.position.y - result.previous.y;
  assert.ok(Math.abs(vx) < 1e-10);
  assert.ok(vy > 0.99);
});

test("ellipsoid contact applies friction only to tangential velocity", async () => {
  const { resolveEllipsoidContact } = await import("./physics.ts");
  const result = resolveEllipsoidContact(
    { x: 1, y: 0, z: 0 },
    { x: 1.2, y: -1, z: 0 },
    { x: 2, y: 3, z: 4 },
    0.1,
    0.25,
  )!;
  const vx = result.position.x - result.previous.x;
  const vy = result.position.y - result.previous.y;
  assert.ok(Math.abs(vx) < 1e-10);
  assert.ok(Math.abs(vy - 0.75) < 1e-10);
});

test("ellipsoid contact rejects invalid previous positions and friction", async () => {
  const { resolveEllipsoidContact } = await import("./physics.ts");
  const point = { x: 1, y: 0, z: 0 };
  const radii = { x: 2, y: 3, z: 4 };
  assert.equal(resolveEllipsoidContact(point, { x: Number.NaN, y: 0, z: 0 }, radii), null);
  assert.equal(resolveEllipsoidContact(point, { x: 0, y: 0, z: 0 }, radii, 0, 2), null);
});


test("long rear hair retains more momentum than short front sections", () => {
  const front = hairStrandDamping(0.32, 0);
  const rear = hairStrandDamping(1, 1);
  assert.ok(rear > front);
  assert.ok(front >= VERLET_DAMP - 0.02);
  assert.ok(rear < 1);
});

test("strand damping remains bounded for invalid and extreme inputs", () => {
  assert.equal(hairStrandDamping(Number.NaN, 1), VERLET_DAMP);
  assert.equal(hairStrandDamping(100, 100), 0.985);
  assert.equal(hairStrandDamping(-10, -10), 0.932);
});


test("head yaw delta takes the short path across the angle wrap", () => {
  const delta = angleDeltaRadians(-Math.PI + 0.02, Math.PI - 0.02);
  assert.ok(Math.abs(delta - 0.04) < 1e-10);
  assert.ok(Math.abs(angleDeltaRadians(Math.PI - 0.02, -Math.PI + 0.02) + 0.04) < 1e-10);
});

test("head yaw delta rejects non-finite angles", () => {
  assert.equal(angleDeltaRadians(Number.NaN, 1), 0);
  assert.equal(angleDeltaRadians(1, Number.POSITIVE_INFINITY), 0);
});


test("body motion acceleration is bounded and preserves direction", () => {
  const result = bodyMotionAcceleration(
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
    0.1,
    180,
  );
  assert.ok(Math.abs(result.x - 180) < 1e-9);
  assert.equal(result.y, 0);
  assert.equal(result.z, 0);
});

test("body motion acceleration rejects invalid samples and elapsed time", () => {
  assert.deepEqual(
    bodyMotionAcceleration({ x: 0, y: 0, z: 0 }, { x: Number.NaN, y: 1, z: 1 }, 0.1),
    { x: 0, y: 0, z: 0 },
  );
  assert.deepEqual(
    bodyMotionAcceleration({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, 0),
    { x: 0, y: 0, z: 0 },
  );
});


test("relative motion cancels shared whole-body translation", () => {
  assert.deepEqual(
    relativeMotionVelocity({ x: 12, y: -4, z: 2 }, { x: 12, y: -4, z: 2 }),
    { x: 0, y: 0, z: 0 },
  );
});

test("relative motion preserves movement of the head against a steady torso", () => {
  assert.deepEqual(
    relativeMotionVelocity({ x: 8, y: -3, z: 1 }, { x: 0, y: 0, z: 0 }),
    { x: 8, y: -3, z: 1 },
  );
});

test("relative motion rejects invalid landmark velocities", () => {
  assert.deepEqual(
    relativeMotionVelocity({ x: Number.NaN, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    { x: 0, y: 0, z: 0 },
  );
});
