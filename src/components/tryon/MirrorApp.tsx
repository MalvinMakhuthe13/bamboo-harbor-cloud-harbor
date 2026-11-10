import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL, CATEGORY_ORDER, findProduct } from "@/lib/tryon/catalog";
import { matchSize } from "@/lib/tryon/math";
import { garmentEase } from "@/lib/tryon/physics";
import { useWardrobe } from "@/lib/tryon/store";
import type { LiveMetrics, TryonState } from "@/lib/tryon/types";
import type { EngineHandle } from "@/lib/tryon/engine";

export function MirrorApp({ initialProductId }: { initialProductId?: string }) {
  const { data, commit } = useWardrobe();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const product = findProduct(data.products, initialProductId);
  const [productId, setProductId] = useState(product.id);
  const active = findProduct(data.products, productId);
  const [color, setColor] = useState(active.color);
  const [wigSize, setWigSize] = useState(1.05);
  const [wigLift, setWigLift] = useState(0.4);
  const [hairLength, setHairLength] = useState(1.15);
  const [sway, setSway] = useState(0.28);
  const [status, setStatus] = useState("Starting the mirror");
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [wornPick, setWornPick] = useState<string | null>(null);

  const fit = useMemo(() => {
    if (!metrics) return null;
    return matchSize(active.sizes, metrics.body);
  }, [active.sizes, metrics]);
  const wornLabel = wornPick ?? fit?.size ?? active.sizes[0]?.label ?? null;
  const wornRow = active.sizes.find((row) => row.label === wornLabel) ?? null;
  const ease =
    active.category === "pants"
      ? garmentEase(metrics?.body.hipCm ?? metrics?.body.waistCm ?? null, wornRow?.hip ?? wornRow?.waist)
      : active.category === "shirt"
        ? garmentEase(metrics?.body.chestCm ?? null, wornRow?.chest)
        : null;

  const stateRef = useRef<TryonState>(null!);
  stateRef.current = {
    productId: active.id,
    category: active.category,
    color,
    material: active.material,
    style: active.style ?? "straight",
    nailShape: active.nailShape ?? "almond",
    wigSize,
    wigLift,
    hairLength,
    sway,
    heightCm: data.heightCm,
    headCircCm: data.headCircCm,
    wornChest: wornRow?.chest ?? null,
    wornWaist: wornRow?.waist ?? null,
    wornHip: wornRow?.hip ?? null,
  };

  useEffect(() => {
    const next = findProduct(data.products, initialProductId);
    if (initialProductId && next.id === initialProductId) {
      setProductId(next.id);
      setColor(next.color);
    }
  }, [initialProductId, data.products]);

  useEffect(() => {
    let dead = false;
    let handle: EngineHandle | null = null;
    const stage = stageRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!stage || !video || !canvas) return;
    void import("@/lib/tryon/engine").then((mod) => {
      if (dead) return;
      handle = mod.startEngine({
        stage,
        video,
        canvas,
        getState: () => stateRef.current,
        onMetrics: setMetrics,
        onStatus: setStatus,
      });
      handleRef.current = handle;
    });
    return () => {
      dead = true;
      handle?.dispose();
      handleRef.current = null;
    };
  }, []);

  async function toggleCamera() {
    setCamError(null);
    const handle = handleRef.current;
    if (!handle) return;
    try {
      if (metrics?.camera) handle.stopCamera();
      else await handle.startCamera();
    } catch (error) {
      setCamError(error instanceof Error ? error.message : "Camera permission was blocked");
    }
  }

  function chooseSize() {
    if (!fit) return;
    setChosen(fit.size);
    commit((current) => ({
      ...current,
      events: [
        {
          id: `${Date.now()}`,
          at: Date.now(),
          productId: active.id,
          productName: active.name,
          size: fit.size,
          source: metrics?.body.source ?? "height-prior",
        },
        ...current.events,
      ].slice(0, 200),
    }));
  }

  const body = metrics?.body;

  return (
    <div className="fixed inset-0 flex flex-col bg-ink text-paper md:flex-row">
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-ink">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} playsInline muted autoPlay />
        <canvas ref={canvasRef} className="absolute" style={{ transform: "scaleX(-1)" }} />
        <div className="absolute top-4 right-4 left-4 flex items-start justify-between gap-3">
          <Link to="/" className="inline-flex min-h-11 items-center rounded-full bg-ink/80 px-4 text-sm text-paper">
            Isibuko
          </Link>
          <p className="max-w-xs rounded-2xl bg-ink/80 px-3 py-2 text-sm text-brass-2">{status}</p>
        </div>
      </div>
      <aside className="h-96 overflow-y-auto border-t border-line bg-ink-2 px-4 py-4 md:h-auto md:w-96 md:border-t-0 md:border-l">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((category) => (
            <button
              key={category}
              type="button"
              className={`min-h-11 rounded-full px-3 text-sm ${
                active.category === category ? "bg-brass text-ink" : "bg-ink text-muted"
              }`}
              onClick={() => {
                const next = data.products.find((item) => item.category === category);
                if (!next) return;
                setProductId(next.id);
                setColor(next.color);
                setChosen(null);
                setWornPick(null);
              }}
            >
              {CATEGORY_LABEL[category]}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto">
          {data.products
            .filter((item) => item.category === active.category)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className={`min-h-11 shrink-0 rounded-full px-3 text-sm ${
                  item.id === active.id ? "bg-paper text-ink" : "text-muted"
                }`}
                onClick={() => {
                  setProductId(item.id);
                  setColor(item.color);
                  setChosen(null);
                  setWornPick(null);
                }}
              >
                {item.name}
              </button>
            ))}
        </div>

        <p className="mt-3 text-sm text-muted">{active.blurb}</p>
        {active.image && (
          <img src={active.image} alt="" className="mt-3 h-32 w-full rounded-2xl object-cover" />
        )}
        {active.priceZar != null && (
          <p className="mt-2 text-sm text-brass-2">R {active.priceZar.toLocaleString("en-ZA")}</p>
        )}

        {active.sizes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {active.sizes.map((row) => (
              <button
                key={row.label}
                type="button"
                className={`min-h-11 rounded-full px-3 text-sm ${
                  row.label === wornLabel ? "bg-brass text-ink" : "border border-line text-muted"
                }`}
                onClick={() => setWornPick(row.label)}
              >
                {row.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" className="min-h-11 rounded-full bg-brass text-ink" onClick={() => void toggleCamera()}>
            {metrics?.camera ? "Stop camera" : "Use my camera"}
          </button>
          <Link to="/science" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line text-sm">
            Fit math
          </Link>
        </div>
        <Link to="/rail" className="mt-3 inline-flex min-h-11 items-center text-sm text-brass-2">
          Try a different piece
        </Link>
        {camError && <p className="mt-2 text-sm text-brass-2">{camError}</p>}

        <label className="mt-4 block text-sm text-muted">
          Height {data.heightCm.toFixed(0)} cm
          <input
            type="range"
            min={140}
            max={210}
            step={1}
            value={data.heightCm}
            onChange={(event) => commit((current) => ({ ...current, heightCm: Number(event.target.value) }))}
          />
        </label>

        {(active.category === "wig" || active.category === "hat") && (
          <>
            <Slider label={`Size ${wigSize.toFixed(2)}`} min={0.8} max={1.45} step={0.01} value={wigSize} onChange={setWigSize} />
            <Slider label={`Lift ${wigLift.toFixed(1)} cm`} min={-3} max={4} step={0.1} value={wigLift} onChange={setWigLift} />
          </>
        )}
        {active.category === "wig" && (
          <>
            <Slider label={`Length ${hairLength.toFixed(2)}`} min={0.55} max={2.1} step={0.01} value={hairLength} onChange={setHairLength} />
            <Slider label={`Sway ${sway.toFixed(2)}`} min={0.06} max={0.55} step={0.01} value={sway} onChange={setSway} />
          </>
        )}
        <label className="mt-3 block text-sm text-muted">
          Colour
          <input className="mt-1 h-11 w-full" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>

        <section className="mt-5 rounded-2xl border border-line p-4">
          <p className="text-sm text-muted">{body?.source === "live-scan" ? "Live scan" : "Height prior"}</p>
          <p className="font-display mt-1 text-3xl">{wornLabel ?? (fit ? fit.size : "One size")}</p>
          {fit && wornLabel && fit.size !== wornLabel && (
            <p className="mt-1 text-sm text-muted">Suggested {fit.size}. You are wearing {wornLabel}.</p>
          )}
          {ease && (active.category === "shirt" || active.category === "pants") && (
            <p className="mt-2 text-sm text-brass-2">
              {ease.easeCm >= 0 ? `${ease.easeCm.toFixed(1)} cm of ease` : `${Math.abs(ease.easeCm).toFixed(1)} cm tight`}
              {ease.taut
                ? ". The cloth sits close, so the folds stay small."
                : ease.easeCm > 6
                  ? ". There is room, so the folds hang and follow the turn."
                  : ". The folds follow the body."}
            </p>
          )}
          {fit?.warning && <p className="mt-2 text-sm text-brass-2">{fit.warning}</p>}
          {fit?.detail && <p className="mt-2 text-sm text-muted">{fit.detail}</p>}
          {!fit && <p className="mt-2 text-sm text-muted">This piece has no size chart.</p>}
          <p className="mt-3 text-sm text-muted">
            Within a few centimetres. Enough to name a size, not a tailor's cut.
          </p>
          {body && (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Measure label="Chest" value={body.chestCm} />
              <Measure label="Waist" value={body.waistCm} />
              <Measure label="Hip" value={body.hipCm} />
              <Measure label="Head" value={body.headCircCm} />
              <Measure label="Face" value={body.faceWidthCm} />
              <Measure label="Wrist" value={body.wristCm} />
              <Measure label="Finger" value={body.fingerCm} />
              <Measure label="Inseam" value={body.inseamCm} />
            </dl>
          )}
          {fit && (
            <button type="button" className="mt-4 min-h-11 w-full rounded-full bg-paper text-ink" onClick={chooseSize}>
              {chosen === fit.size ? `Saved ${fit.size}` : `Choose ${fit.size}`}
            </button>
          )}
          <p className="mt-3 text-xs text-muted">
            {metrics?.camera ? "Camera on" : "Mannequin"} · face {metrics?.face ? "yes" : "no"} · hands {metrics?.hands ?? 0} · pose{" "}
            {metrics?.pose ? "yes" : "no"}
            {metrics?.pinch ? " · pinch" : ""}
            {metrics?.grabbed ? (metrics.section > 1 ? ` · section of ${metrics.section}` : " · holding") : ""}
            {metrics ? ` · ${metrics.fps} fps` : ""}
          </p>
        </section>
      </aside>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-3 block text-sm text-muted">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Measure({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{value == null ? "—" : `${value.toFixed(0)} cm`}</dd>
    </div>
  );
}
