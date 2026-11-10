import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage } from "@/components/mirror/Stage";
import { CameraTest } from "@/components/mirror/CameraTest";
import { Nav } from "@/components/site/Nav";
import { CATEGORY_LABEL, CATEGORY_ORDER, findProduct, productsIn } from "@/lib/isibuko-ai/catalog";
import { conditionProduct } from "@/lib/isibuko-ai/condition";
import type { Drag } from "@/lib/isibuko-ai/engine";
import { matchSize, sizeScaleFor } from "@/lib/isibuko-ai/fit";
import { useWardrobe } from "@/lib/isibuko-ai/store";
import type { Category, FrameRequest, LiveMetrics, Product, TryEvent } from "@/lib/isibuko-ai/types";

type Search = { product?: string };

export const Route = createFileRoute("/mirror")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    product: typeof search.product === "string" ? search.product : undefined,
  }),
  component: MirrorPage,
});

function MirrorPage() {
  const search = Route.useSearch();
  const { data, commit } = useWardrobe();
  const initial = findProduct(data.products, search.product);
  const [productId, setProductId] = useState(initial.id);
  const [swatchId, setSwatchId] = useState(initial.swatches[0]?.id ?? "natural");
  const [sizeLabel, setSizeLabel] = useState<string | null>(initial.sizes[0]?.label ?? null);
  const [held, setHeld] = useState<string | null>(null);
  const [status, setStatus] = useState("Opening the mirror");
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [handoff, setHandoff] = useState(false);
  const [emptyNote, setEmptyNote] = useState("");
  const [height, setHeight] = useState(data.heightCm);
  const [switches, setSwitches] = useState(0);
  const [sessionSeen, setSessionSeen] = useState<number | null>(null);
  const controlsRef = useRef<{ setDelegate: (delegate: "CPU" | "GPU") => void } | null>(null);
  const active = findProduct(data.products, productId);
  const swatch = active.swatches.find((item) => item.id === swatchId) ?? active.swatches[0];
  const fit = useMemo(() => (metrics ? matchSize(active.sizes, metrics.body) : null), [active.sizes, metrics]);

  const requestRef = useRef<FrameRequest>({
    productId: active.id,
    category: active.category,
    image: active.image,
    tint: swatch?.tint ?? null,
    sizeScale: sizeScaleFor(sizeLabel),
    nail: active.nail,
    heightCm: height,
  });
  requestRef.current = {
    productId: active.id,
    category: active.category,
    image: active.image,
    tint: swatch?.tint ?? null,
    sizeScale: sizeScaleFor(sizeLabel),
    nail: active.nail,
    heightCm: height,
  };
  const dragRef = useRef<Drag>({ x: 0, y: 0, hold: false });

  useEffect(() => {
    if (metrics?.source !== "camera") return;
    if (sessionSeen !== metrics.cameraSession) {
      setSessionSeen(metrics.cameraSession);
      setSwitches(0);
    }
  }, [metrics?.source, metrics?.cameraSession, sessionSeen]);

  function selectProduct(product: Product) {
    if (metrics?.source === "camera" && product.id !== productId) setSwitches((count) => count + 1);
    setProductId(product.id);
    setSwatchId(product.swatches[0]?.id ?? "natural");
    setSizeLabel(product.sizes[0]?.label ?? null);
    setHandoff(false);
    setEmptyNote("");
  }

  function choose(category: Category) {
    const next = productsIn(data.products, category)[0];
    if (next) selectProduct(next);
    else setEmptyNote(`${CATEGORY_LABEL[category]} has no house piece. Add a photograph in the wardrobe. A photograph is not a measurement, and the camera is not restarted.`);
  }

  const condition = conditionProduct(active, swatch?.tint ?? null);
  const payload = {
    sku: active.id,
    name: active.name,
    size: sizeLabel,
    colour: swatch?.name ?? "As photographed",
    priceZar: active.priceZar,
    cut: condition.cut,
    fabric: active.fabric ?? null,
    source: metrics?.source === "camera" ? "live-camera" : "studio-photo",
    missing: condition.missing,
  };

  return (
    <main className="flex h-dvh flex-col bg-ink text-paper">
      <Nav tone="ink" />
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_22rem]">
        <Stage requestRef={requestRef} dragRef={dragRef} controlsRef={controlsRef} onMetrics={setMetrics} onStatus={setStatus} />
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-line bg-ink-2 px-4 py-4 md:border-t-0 md:border-l">
          <p className="text-sm text-brass-2">{status}</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_ORDER.map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={active.category === category}
                className={`min-h-11 shrink-0 rounded-full px-3 text-sm ${active.category === category ? "bg-brass text-ink" : "bg-ink text-muted"}`}
                onClick={() => choose(category)}
              >
                {CATEGORY_LABEL[category]}
              </button>
            ))}
          </div>
          {emptyNote && <p className="text-sm text-clay">{emptyNote}</p>}
          <div className="flex flex-wrap gap-2">
            {productsIn(data.products, active.category).map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => selectProduct(product)}
                className={`min-h-11 shrink-0 rounded-full px-3 text-sm ${product.id === active.id ? "bg-paper text-ink" : "text-muted"}`}
              >
                {product.name}
              </button>
            ))}
          </div>
          <div>
            <h1 className="font-display text-3xl">{active.name}</h1>
            <p className="mt-2 text-sm text-muted">{active.blurb}</p>
            <p className="mt-2 text-sm text-brass-2">R {active.priceZar.toLocaleString("en-ZA")}</p>
          </div>
          {active.swatches.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {active.swatches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSwatchId(item.id)}
                  className={`min-h-11 rounded-full px-3 text-sm ${item.id === swatch?.id ? "bg-brass text-ink" : "bg-ink text-muted"}`}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
          {active.sizes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {active.sizes.map((row) => (
                <button
                  key={row.label}
                  type="button"
                  onClick={() => setSizeLabel(row.label)}
                  className={`min-h-11 rounded-full px-3 text-sm ${row.label === sizeLabel ? "bg-paper text-ink" : "bg-ink text-muted"}`}
                >
                  {row.label}
                  {fit?.size === row.label ? " · suggested" : ""}
                </button>
              ))}
            </div>
          )}
          {fit?.warning && <p className="text-sm text-clay">{fit.warning}</p>}
          {fit?.detail && <p className="text-sm text-muted">{fit.detail}</p>}
          <label className="text-sm text-muted">
            Height in centimetres
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ink px-3 text-paper"
              type="number"
              min={120}
              max={220}
              value={height}
              onChange={(event) => {
                const next = Number(event.target.value);
                setHeight(next);
                commit((current) => ({ ...current, heightCm: next }));
              }}
            />
          </label>
          <p className="text-sm text-muted">{metrics?.body.note}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-full bg-brass px-4 text-sm text-ink"
              onClick={() => {
                setHandoff(true);
                const event: TryEvent = {
                  id: `${Date.now()}`,
                  at: Date.now(),
                  productId: active.id,
                  productName: active.name,
                  size: sizeLabel,
                  colour: swatch?.name ?? "As photographed",
                  source: metrics?.source === "camera" ? "camera" : "studio",
                };
                commit((current) => ({
                  ...current,
                  events: [event, ...current.events].slice(0, 80),
                }));
              }}
            >
              Continue to merchant
            </button>
            <button
              type="button"
              className="min-h-11 rounded-full border border-line px-4 text-sm"
              onClick={() => {
                if (held && held !== active.id) selectProduct(findProduct(data.products, held));
                else setHeld(active.id);
              }}
            >
              {held && held !== active.id ? "Back to held piece" : held ? "Held" : "Hold to compare"}
            </button>
          </div>
          {handoff && (
            <div className="rounded-2xl border border-line bg-ink p-4">
              <p className="font-display text-xl">Hand back to the shop</p>
              <p className="mt-2 text-sm text-muted">
                Isibuko does not take payment. This is the selection a merchant page would receive.
              </p>
              <pre className="mt-3 overflow-x-auto text-sm text-brass-2">{JSON.stringify(payload, null, 2)}</pre>
              {active.merchantUrl && (
                <a className="mt-3 inline-flex min-h-11 items-center text-sm text-paper underline" href={active.merchantUrl}>
                  Open merchant page
                </a>
              )}
            </div>
          )}
          <CameraTest
            metrics={metrics}
            switches={switches}
            onDelegate={(delegate) => controlsRef.current?.setDelegate(delegate)}
          />
          <p className="text-sm text-muted">Changing product, colour, or size does not stop the camera. The studio photo is only a labelled test. Picture fps is the display. The hertz numbers are how often each model returns, and they are allowed to be slower than the picture.</p>
        </aside>
      </div>
    </main>
  );
}
