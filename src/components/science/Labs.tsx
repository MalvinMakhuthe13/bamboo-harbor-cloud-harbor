import { useEffect, useRef, useState } from "react";
import type { Material } from "@/lib/tryon/types";
import {
  FOLD_FREQ,
  FOLD_SPEED,
  GRAVITY_CM_S2,
  PENDULUM_DAMP,
  PENDULUM_DRIVE,
  PENDULUM_K,
  foldAmplitudeCm,
  foldWaveCm,
  hairStiffness,
  hangChain,
  stepChain2d,
  stepPendulum,
} from "@/lib/tryon/physics";

export function ChainLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sway, setSway] = useState(0.28);
  const [curly, setCurly] = useState(false);
  const swayRef = useRef(sway);
  const curlyRef = useRef(curly);
  swayRef.current = sway;
  curlyRef.current = curly;
  const [readout, setReadout] = useState("Drag a link, then let go.");
  const stiff = hairStiffness(sway, curly);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const segment = 3.2;
    const nodes = hangChain(8, 0, 0, segment);
    let grab = -1;
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let alive = true;
    let last = performance.now();
    let readoutAt = 0;
    const scale = 11;

    const resize = () => {
      const width = canvas.clientWidth || 320;
      const height = 320;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const toCm = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - rect.width / 2) / scale,
        y: (event.clientY - rect.top - 36) / scale,
      };
    };
    const down = (event: PointerEvent) => {
      const point = toCm(event);
      let best = -1;
      let bestD = 1.8;
      for (let i = 1; i < nodes.length; i++) {
        const d = Math.hypot(nodes[i].x - point.x, nodes[i].y - point.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return;
      grab = best;
      pointer = point;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (grab < 0) return;
      pointer = toCm(event);
    };
    const up = () => {
      grab = -1;
      pointer = null;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
      last = now;
      const stiffness = hairStiffness(swayRef.current, curlyRef.current);
      stepChain2d(nodes, { x: 0, y: 0 }, segment, dt, stiffness, grab, pointer, 1);
      const width = canvas.clientWidth || 320;
      const height = 320;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#14110e";
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, 36);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      for (const node of nodes) ctx.lineTo(node.x, node.y);
      ctx.strokeStyle = "#e6d3b3";
      ctx.lineWidth = 0.16;
      ctx.stroke();
      nodes.forEach((node, index) => {
        ctx.beginPath();
        ctx.fillStyle = index === grab ? "#9c4a32" : index === 0 ? "#f3eadf" : "#c4a574";
        ctx.arc(node.x, node.y, index === 0 ? 0.42 : 0.3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      if (now - readoutAt > 180) {
        readoutAt = now;
        const tip = nodes[nodes.length - 1];
        setReadout(
          grab >= 0
            ? `Holding link ${grab} of ${nodes.length - 1}. Stiffness ${stiffness.toFixed(2)}.`
            : `Tip is ${tip.y.toFixed(1)} cm under the root. Stiffness ${stiffness.toFixed(2)}.`,
        );
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <div>
      <canvas ref={canvasRef} className="mt-4 h-80 w-full touch-none rounded-2xl" />
      <p className="mt-3 text-sm text-ink-muted">{readout}</p>
      <label className="mt-4 block text-sm">
        Sway {sway.toFixed(2)} — stiffness {stiff.toFixed(2)}
        <input
          className="mt-2"
          type="range"
          min={0.06}
          max={0.55}
          step={0.01}
          value={sway}
          onChange={(event) => setSway(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        className="mt-3 min-h-11 rounded-full border border-line/40 px-4 text-sm"
        onClick={() => setCurly((value) => !value)}
      >
        {curly ? "Curly hair (less stiff)" : "Straight hair"}
      </button>
      <p className="mt-3 text-sm text-ink-muted">
        Gravity is {GRAVITY_CM_S2} cm/s². Each frame stores the previous point, moves by the damped
        difference, then adds gravity. Three constraint passes pull links back to {3.2} cm. The mirror
        runs the same step in 3D and refuses to let a point inside the head sphere.
      </p>
    </div>
  );
}

export function PendulumLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kick = useRef(0);
  const [swing, setSwing] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let angle = 0;
    let vel = 0;
    let raf = 0;
    let alive = true;
    let last = performance.now();
    let shown = 0;

    const resize = () => {
      const width = canvas.clientWidth || 320;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(220 * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
      last = now;
      const yaw = kick.current;
      kick.current = 0;
      const next = stepPendulum(angle, vel, yaw, dt);
      angle = next.swing;
      vel = next.vel;
      const width = canvas.clientWidth || 320;
      const height = 220;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#14110e";
      ctx.fillRect(0, 0, width, height);
      const ox = width / 2;
      const oy = 36;
      const len = 120;
      const x = ox + Math.sin(angle) * len;
      const y = oy + Math.cos(angle) * len * 0.35 + len * 0.65;
      ctx.strokeStyle = "#c4a574";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = "#e6d3b3";
      ctx.beginPath();
      ctx.arc(ox, oy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9c4a32";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      if (now - shown > 120) {
        shown = now;
        setSwing(angle);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div>
      <canvas ref={canvasRef} className="mt-4 h-56 w-full rounded-2xl" />
      <p className="mt-3 text-sm text-ink-muted">Swing {swing.toFixed(3)} rad.</p>
      <button
        type="button"
        className="mt-3 min-h-11 rounded-full bg-ink px-4 text-sm text-paper"
        onClick={() => {
          kick.current = 1.1;
        }}
      >
        Turn the head
      </button>
      <p className="mt-3 text-sm text-ink-muted">
        Acceleration is −{PENDULUM_K} × swing. Velocity is then multiplied by {PENDULUM_DAMP}, and a
        head-turn adds {PENDULUM_DRIVE} × yaw rate. The earring drop is offset by that swing. It is a
        pendulum, not a cloth.
      </p>
    </div>
  );
}

export function FoldLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [material, setMaterial] = useState<Material>("cotton");
  const materialRef = useRef(material);
  materialRef.current = material;
  const amp = foldAmplitudeCm(material);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let alive = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const width = canvas.clientWidth || 320;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(200 * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now: number) => {
      if (!alive) return;
      const time = reduce ? 0 : now / 1000;
      const amplitude = foldAmplitudeCm(materialRef.current);
      const width = canvas.clientWidth || 320;
      const height = 200;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#14110e";
      ctx.fillRect(0, 0, width, height);
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * 1.12;
        const x = 24 + (i / 48) * (width - 48);
        const wave = foldWaveCm(t, time, amplitude, t > 0.25 && t < 0.85);
        const y = 28 + t * 130 + wave * 10;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#c4a574";
      ctx.lineWidth = 3;
      ctx.stroke();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div>
      <canvas ref={canvasRef} className="mt-4 h-52 w-full rounded-2xl" />
      <div className="mt-3 flex flex-wrap gap-2">
        {(["cotton", "satin"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`min-h-11 rounded-full px-4 text-sm ${item === material ? "bg-ink text-paper" : "border border-line/40"}`}
            onClick={() => setMaterial(item)}
          >
            {item === "cotton" ? "Cotton" : "Satin"} · {foldAmplitudeCm(item).toFixed(2)} cm
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        Offset = sin(row × {FOLD_FREQ} + time × {FOLD_SPEED}) × {amp.toFixed(2)} cm, and the belly
        rows get the full wave. This is a kinematic fold. It is not a finite-element cloth solve, and
        the page says so because a phone cannot run one live.
      </p>
    </div>
  );
}
