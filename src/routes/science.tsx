import { createFileRoute, Link } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { ChainLab, FoldLab, PendulumLab } from "@/components/science/Labs";
import { CATEGORY_LABEL } from "@/lib/tryon/catalog";
import {
  CRANIUM_AND_HEEL_M,
  PINCH_MAX,
  STATURE_PRIORS,
  ellipseCircumference,
  matchSize,
  priorFromHeight,
  torsoTape,
} from "@/lib/tryon/math";
import {
  CAT_EYE_ROLL,
  CHEST_BREADTH_OF_SHOULDER,
  CHEST_DEPTH_OF_BREADTH,
  CONSTRAINT_PASSES,
  FACE_TO_HEAD,
  FINGER_LENGTH_TO_BREADTH,
  GLASSES_REF_FACE_CM,
  GRAB_LERP,
  GRAB_RADIUS_NORM,
  GRAVITY_CM_S2,
  HAND_Z_TO_CM,
  HIP_DEPTH_OF_BREADTH,
  NAIL_SETBACK_CM,
  NECKLACE_BEADS,
  NECKLACE_SEGMENT_CM,
  NECKLACE_STIFFNESS,
  PALM_TO_FINGER,
  PALM_TO_WRIST,
  POSE_Z_TO_CM,
  RING_REF_FINGER_CM,
  SECTION_FOLLOW,
  SECTION_RADIUS,
  VERLET_DAMP,
  WATCH_REF_WRIST_CM,
  glassesScale,
  garmentEase,
  nailScale,
  ringScale,
  sectionWeights,
  shinRadiusCm,
  thighRadiusCm,
  watchScale,
} from "@/lib/tryon/physics";
import { useWardrobe } from "@/lib/tryon/store";

export const Route = createFileRoute("/science")({ component: Science });

const JUMPS = [
  ["body", "Body"],
  ["size", "Size"],
  ["hair", "Hair"],
  ["jewellery", "Jewellery"],
  ["cloth", "Cloth"],
  ["hands", "Hands"],
  ["limits", "Limits"],
] as const;

function Science() {
  const { data, commit } = useWardrobe();
  const prior = priorFromHeight(data.heightCm, data.headCircCm);
  const shoulder = prior.shoulderCm ?? 0;
  const breadth = shoulder * CHEST_BREADTH_OF_SHOULDER;
  const ellipseTape = torsoTape(breadth, CHEST_DEPTH_OF_BREADTH);
  const a = breadth / 2;
  const b = (breadth * CHEST_DEPTH_OF_BREADTH) / 2;
  const hEllipse = a + b > 0 ? ((a - b) * (a - b)) / ((a + b) * (a + b)) : 0;
  const neighbours = sectionWeights(86, 40, SECTION_RADIUS);
  const hipSpan = (prior.hipBreadthCm ?? 30) || 30;
  const thigh = thighRadiusCm(hipSpan);
  const face = prior.faceWidthCm ?? GLASSES_REF_FACE_CM;

  const sized = data.products.filter((product) => product.sizes.length > 0);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <article className="mx-auto max-w-3xl px-5 py-10">
        <p className="text-sm tracking-widest text-clay uppercase">The model, not a slogan</p>
        <h1 className="font-display mt-3 text-5xl leading-tight">Every number the mirror uses</h1>
        <p className="mt-4 text-ink-muted">
          Fit math and the live engine call the same functions. Change the height here and the priors
          move. Open the mirror and a pose replaces them. Nothing below is a separate demo formula.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2">
          {JUMPS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full border border-line/40 px-3 text-sm">
              {label}
            </a>
          ))}
        </nav>

        <label className="mt-8 block text-sm">
          Standing height, {data.heightCm.toFixed(0)} cm
          <input
            className="mt-2"
            type="range"
            min={140}
            max={210}
            step={1}
            value={data.heightCm}
            onChange={(event) => commit((current) => ({ ...current, heightCm: Number(event.target.value) }))}
          />
        </label>
        <label className="mt-4 block text-sm">
          Head circumference, optional
          <input
            className="mt-2 w-full rounded-xl border border-line/50 bg-paper px-3 py-3"
            inputMode="decimal"
            placeholder="Leave blank to estimate"
            value={data.headCircCm ?? ""}
            onChange={(event) => {
              const raw = event.target.value.trim();
              const next = raw === "" ? null : Number(raw);
              commit((current) => ({
                ...current,
                headCircCm: next != null && Number.isFinite(next) ? next : null,
              }));
            }}
          />
        </label>

        <h2 id="body" className="font-display mt-12 text-3xl">
          Body, before anyone is in frame
        </h2>
        <p className="mt-3 text-ink-muted">
          Priors are fractions of stature. They are population averages, labelled as priors in the
          mirror, and thrown away once shoulders and ankles read cleanly.
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Shoulder" value={prior.shoulderCm} hint={`× ${STATURE_PRIORS.shoulderBreadth}`} />
          <Stat label="Chest prior" value={prior.chestCm} hint={`× ${STATURE_PRIORS.chestCirc}`} />
          <Stat label="Waist prior" value={prior.waistCm} hint={`× ${STATURE_PRIORS.waistCirc}`} />
          <Stat label="Hip prior" value={prior.hipCm} hint={`× ${STATURE_PRIORS.hipCirc}`} />
          <Stat label="Inseam" value={prior.inseamCm} hint={`× ${STATURE_PRIORS.inseam}`} />
          <Stat label="Head" value={prior.headCircCm} hint={data.headCircCm == null ? `× ${STATURE_PRIORS.headCirc}` : "typed"} />
          <Stat label="Face width" value={prior.faceWidthCm} hint={`× ${STATURE_PRIORS.faceWidth}`} />
          <Stat label="Wrist" value={prior.wristCm} hint={`× ${STATURE_PRIORS.wristCirc}`} />
          <Stat label="Finger" value={prior.fingerCm} hint={`× ${STATURE_PRIORS.fingerBreadth}`} />
        </dl>

        <h2 className="font-display mt-12 text-3xl">Stature scale</h2>
        <p className="mt-3 text-ink-muted">
          Pose world-landmarks are metres and they drift. Nose-to-ankle misses the skull and the heel,
          so {CRANIUM_AND_HEEL_M * 100} cm is added back. Scale is your height divided by that
          reconstructed stature. If the ankles are not reliable, the metre estimate is used as-is.
        </p>
        <Formula>{`scale = heightCm / 100 / (noseToAnkle + ${CRANIUM_AND_HEEL_M})
shoulderCm = shoulderMetres × scale × 100`}</Formula>

        <h2 className="font-display mt-12 text-3xl">The tape a camera cannot see</h2>
        <p className="mt-3 text-ink-muted">
          A live scan does not use the chest fraction above. It takes chest breadth as{" "}
          {CHEST_BREADTH_OF_SHOULDER} of the measured shoulders, assumes depth is {CHEST_DEPTH_OF_BREADTH}{" "}
          of that breadth, and wraps Ramanujan’s ellipse around both. At your height, if the shoulders
          were the prior, that ellipse is {ellipseTape.toFixed(1)} cm — not the same as the{" "}
          {prior.chestCm?.toFixed(1)} cm population prior. Hip depth is {HIP_DEPTH_OF_BREADTH} of hip
          breadth. Expect a few centimetres. It names a size. It is not a tailor’s cut.
        </p>
        <Formula>{`a = ${a.toFixed(2)} cm,  b = ${b.toFixed(2)} cm
h = ((a − b) / (a + b))² = ${hEllipse.toFixed(4)}
tape = π (a + b) (1 + 3h / (10 + √(4 − 3h))) = ${ellipseCircumference(a, b).toFixed(1)} cm`}</Formula>

        <h2 className="font-display mt-12 text-3xl">Where the pose sits in the mirror</h2>
        <p className="mt-3 text-ink-muted">
          Image landmarks are the screen position. World z, relative to the shoulders, is multiplied by{" "}
          {POSE_Z_TO_CM} and given a sign locked on the first good frame, so the chest stays in front of
          the back. Hand depth uses landmark z × {HAND_Z_TO_CM} cm. The head pose comes from the face
          matrix; its scale is ignored and your wig size is applied instead.
        </p>

        <h2 id="size" className="font-display mt-12 text-3xl">
          Which size wins
        </h2>
        <p className="mt-3 text-ink-muted">
          Each row is a range in centimetres. Score is the squared distance from the middle of the range,
          divided by half the range, averaged over the measurements that exist. Lowest score wins. More
          than 2.5 cm outside the winning range is called tight or loose. The size is still named.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line/30 text-ink-muted">
                <th className="py-2 pr-3 font-medium">Piece</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Size</th>
                <th className="py-2 font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {sized.map((product) => {
                const fit = matchSize(product.sizes, prior);
                return (
                  <tr key={product.id} className="border-b border-line/20">
                    <td className="py-3 pr-3">{product.name}</td>
                    <td className="py-3 pr-3 text-ink-muted">{CATEGORY_LABEL[product.category]}</td>
                    <td className="py-3 pr-3">{fit ? fit.size : "—"}</td>
                    <td className="py-3">{fit ? fit.score.toFixed(2) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Nails, earrings and the chain have no chart. They are one size. A warning, when there is one,
          is on the mirror next to the chosen size.
        </p>

        <h2 id="hair" className="font-display mt-12 text-3xl">
          Hair
        </h2>
        <p className="mt-3 text-ink-muted">
          A strand is a chain. Straight hair is 86 strands plus 14 of fringe, a bob is 72, braids are 22
          and thicker. Rest length is the length slider times 24 cm (straight), 16 cm (bob) or 30 cm
          (braids). Stiffness is 1 − sway, and curly hair multiplies sway by 0.7, clamped between 0.2
          and 0.92. Damping per step is {VERLET_DAMP}. Constraint blend is 0.45 + 0.45 × stiffness,{" "}
          {CONSTRAINT_PASSES} passes.
        </p>
        <ChainLab />
        <p className="mt-6 text-ink-muted">
          A pinch is thumb-to-index under {PINCH_MAX} in normalised hand space. The nearest link within{" "}
          {GRAB_RADIUS_NORM} is grabbed and lerps toward the pinch by {GRAB_LERP} each frame. Strands
          within {SECTION_RADIUS} indices follow at {SECTION_FOLLOW} × their neighbour weight. The rest of
          the wig is not pulled. On a full straight wig, grabbing strand 40 also moves:
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink-muted">
          {neighbours.map((item) => (
            <li key={item.index}>
              Strand {item.index}, follow weight {(item.weight * SECTION_FOLLOW).toFixed(2)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-ink-muted">
          Ribbons face the camera. An invisible head writes depth and no colour, so hair behind the skull
          is hidden and the camera shows through. That is occlusion, not a drawing order trick.
        </p>

        <h2 id="jewellery" className="font-display mt-12 text-3xl">
          Earrings, chain, glasses
        </h2>
        <p className="mt-3 text-ink-muted">
          Earrings hang at the ear and use the pendulum below. The chain is the hair solver again:{" "}
          {NECKLACE_BEADS} beads, {NECKLACE_SEGMENT_CM} cm apart, stiffness {NECKLACE_STIFFNESS}. Pinch
          grabs one bead. Glasses scale by face width / {GLASSES_REF_FACE_CM}, clamped. At your prior
          face that scale is {glassesScale(face).toFixed(2)}. Cat-eye rolls the lenses by {CAT_EYE_ROLL}{" "}
          rad. Head circumference, if you did not type one, is face width × {FACE_TO_HEAD.toFixed(3)}.
        </p>
        <PendulumLab />

        <h2 id="cloth" className="font-display mt-12 text-3xl">
          Shirt and trousers
        </h2>
        <p className="mt-3 text-ink-muted">
          The shirt is a 9 by 7 sheet, front and back, with sleeves. Ease is the middle of the size you
          are wearing, minus your chest. At this height a regular medium (90–98 cm) has{" "}
          {garmentEase(prior.chestCm, [90, 98]).easeCm.toFixed(1)} cm of ease and a wrinkle gain of{" "}
          {garmentEase(prior.chestCm, [90, 98]).wrinkle.toFixed(2)}. An oversized medium (108–118 cm) has{" "}
          {garmentEase(prior.chestCm, [108, 118]).easeCm.toFixed(1)} cm and a gain of{" "}
          {garmentEase(prior.chestCm, [108, 118]).wrinkle.toFixed(2)}. Positive ease flares the side seams
          and deepens the fold. Negative ease pulls the seams in and the cloth goes almost smooth. The
          same wave also shifts when the shoulders twist against the hips, and it gathers if the torso
          shortens. A pinch takes the nearest patch, then lets it fall back. It is still not a cloth
          solver.
        </p>
        <p className="mt-3 text-ink-muted">
          Trouser thigh radius starts at 0.28 × hip span, clamped, then scaled by hip ease. At your prior
          hip span of {hipSpan.toFixed(1)} cm the thigh is {thigh.toFixed(1)} cm before that scale, and
          the shin is {shinRadiusCm(thigh).toFixed(1)} cm. A bent knee thickens into a crease. The legs
          follow hip, knee and ankle.
        </p>
        <FoldLab />

        <h2 id="hands" className="font-display mt-12 text-3xl">
          Nails, ring, watch
        </h2>
        <p className="mt-3 text-ink-muted">
          Palm breadth is the distance between hand landmarks 5 and 17, in centimetres at the current
          depth. Wrist circumference is palm × {PALM_TO_WRIST}. Finger breadth is palm ×{" "}
          {PALM_TO_FINGER.toFixed(3)}. At your prior wrist of {prior.wristCm?.toFixed(1)} cm the watch
          scale is {watchScale(prior.wristCm).toFixed(2)} against a {WATCH_REF_WRIST_CM} cm reference. A
          finger of {prior.fingerCm?.toFixed(2)} cm scales the ring to {ringScale(prior.fingerCm).toFixed(2)}{" "}
          around a {RING_REF_FINGER_CM} cm reference. If the palm is not visible, ring breadth falls back
          to finger length / {FINGER_LENGTH_TO_BREADTH}.
        </p>
        <p className="mt-3 text-ink-muted">
          Each nail sits on the fingertip, {NAIL_SETBACK_CM} cm back along the finger, aimed from base to
          tip. Almond scale {nailScale("almond")}, square {nailScale("square")}, stiletto{" "}
          {nailScale("stiletto")}. Ten nails, both hands. No size chart — the shape is the product.
        </p>

        <h2 id="limits" className="font-display mt-12 text-3xl">
          What this will not pretend
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-muted">
          <li>No captured wig mesh and no Gaussian splat. Hair is grown from the rules above.</li>
          <li>No foot or shoe tracking. Trousers end at the ankle.</li>
          <li>No finite-element cloth, no wind field, no collision with the hands except the pinch target.</li>
          <li>Video is read on the device and dropped. The studio only stores what you type, in this browser.</li>
        </ul>
        <p className="mt-8">
          <Link to="/mirror" className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-paper">
            Open the mirror
          </Link>
        </p>
      </article>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div className="rounded-2xl border border-line/40 px-3 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-display text-2xl">{value == null ? "—" : `${value.toFixed(1)}`}</dd>
      <dd className="text-xs text-ink-muted">{hint}</dd>
    </div>
  );
}

function Formula({ children }: { children: string }) {
  return <pre className="mt-4 overflow-x-auto rounded-2xl bg-ink p-4 text-sm text-brass-2">{children}</pre>;
}
