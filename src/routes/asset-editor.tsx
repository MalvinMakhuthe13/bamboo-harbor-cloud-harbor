import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { analyzeProductAlpha, type AlphaGeometry } from "@/lib/isibuko-ai/anchors";
import { prepareGarmentAsset, type GarmentAssetPlan } from "@/lib/isibuko-ai/garment-asset";
import { getGarmentFitProfile } from "@/lib/isibuko-ai/garment-profiles";
import type { Category, ProductAnchorPoint } from "@/lib/isibuko-ai/types";

export const Route = createFileRoute("/asset-editor")({ component: AssetEditorPage });

const CATEGORIES: Category[] = ["shirt", "jacket", "dress", "pants", "skirt", "wig", "hat", "glasses", "earrings", "necklace", "watch", "bracelet", "ring", "nails"];
const STORAGE_KEY = "isibuko-garment-asset-draft-v1";

function AssetEditorPage() {
  const [category, setCategory] = useState<Category>("shirt");
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [alpha, setAlpha] = useState<AlphaGeometry | null>(null);
  const [anchors, setAnchors] = useState<Record<string, ProductAnchorPoint>>({});
  const [activeAnchor, setActiveAnchor] = useState("shoulderL");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const profile = useMemo(() => getGarmentFitProfile(category), [category]);
  const plan: GarmentAssetPlan | null = useMemo(
    () => alpha ? prepareGarmentAsset(category, alpha) : null,
    [alpha, category],
  );
  const anchorNames = useMemo(
    () => [...(profile?.requiredAnchors ?? []), ...(profile?.optionalAnchors ?? [])],
    [profile],
  );

  useEffect(() => {
    if (!anchorNames.includes(activeAnchor)) setActiveAnchor(anchorNames[0] ?? "");
  }, [anchorNames, activeAnchor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.complete || !image.naturalWidth) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const maxWidth = 900;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (alpha?.bounds) {
      const b = alpha.bounds;
      context.save();
      context.strokeStyle = "#16a36a";
      context.lineWidth = Math.max(2, canvas.width / 350);
      context.setLineDash([8, 5]);
      context.strokeRect(b.left * canvas.width, b.top * canvas.height, (b.right - b.left) * canvas.width, (b.bottom - b.top) * canvas.height);
      context.restore();
    }
    for (const [key, point] of Object.entries(anchors)) {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      context.beginPath();
      context.arc(x, y, Math.max(5, canvas.width / 100), 0, Math.PI * 2);
      context.fillStyle = key === activeAnchor ? "#e56b35" : "#1d7caa";
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = "#fff";
      context.stroke();
      context.font = "600 12px Outfit, sans-serif";
      context.fillStyle = "#171411";
      context.fillText(key, x + 9, y - 8);
    }
  }, [alpha, anchors, activeAnchor, imageSize]);

  async function loadFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, WebP or JPEG product image.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        URL.revokeObjectURL(url);
        setError("This browser could not read the image pixels.");
        return;
      }
      try {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const result = analyzeProductAlpha(pixels, canvas.width, canvas.height);
        if (!result) throw new Error("The image could not be analysed.");
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageRef.current = image;
        setImageUrl(url);
        setImageName(file.name);
        setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
        setAlpha(result);
        setAnchors({});
        setError(null);
        setSaved(false);
      } catch (caught) {
        URL.revokeObjectURL(url);
        setError(caught instanceof Error ? caught.message : "Image analysis failed.");
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("The selected image could not be decoded.");
    };
    image.src = url;
  }

  function placeAnchor(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !activeAnchor) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setAnchors((current) => ({ ...current, [activeAnchor]: { x, y, confidence: 1 } }));
    setSaved(false);
  }

  function saveDraft() {
    if (!plan || !imageUrl) return;
    const draft = {
      version: "isibuko.asset-draft/1",
      name: name.trim(),
      category,
      sourceImage: imageName,
      imageSize,
      alphaGeometry: alpha,
      preparation: plan,
      fittingAnchors: {
        version: "isibuko.anchors/1",
        points: anchors,
      },
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    setSaved(true);
  }

  function exportDraft() {
    if (!plan || !alpha) return;
    const draft = {
      version: "isibuko.asset-draft/1",
      name: name.trim(),
      category,
      sourceImage: imageName,
      imageSize,
      alphaGeometry: alpha,
      preparation: plan,
      fittingAnchors: { version: "isibuko.anchors/1", points: anchors },
    };
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(name.trim() || "isibuko-garment").replace(/[^a-z0-9-_]+/gi, "-")}.asset.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const required = profile?.requiredAnchors ?? [];
  const completeRequired = required.filter((key) => anchors[key]).length;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <div className="mx-auto max-w-7xl px-5 py-8">
        <p className="text-xs uppercase tracking-[0.2em] text-clay">Isibuko · Product preparation</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl md:text-5xl">Garment asset editor</h1>
            <p className="mt-2 max-w-2xl text-sm text-ink-muted">Prepare a product image, inspect its silhouette and manually place fitting landmarks. Everything runs in this browser.</p>
          </div>
          <span className="rounded-full border border-line/50 px-3 py-1 text-xs text-ink-muted">Local draft · no upload</span>
        </div>

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
          <div className="min-w-0 rounded-3xl border border-line/50 bg-white/50 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl">Product image</h2>
              <label className="cursor-pointer rounded-full bg-ink px-4 py-2 text-sm text-white">
                Choose image
                <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void loadFile(event.target.files?.[0])} />
              </label>
            </div>
            {imageUrl ? (
              <div className="mt-4 overflow-auto rounded-2xl bg-[#eeeae3] p-2">
                <canvas ref={canvasRef} onPointerDown={placeAnchor} className="mx-auto block max-h-[72vh] max-w-full cursor-crosshair touch-none object-contain" aria-label="Product image. Click to place the selected fitting anchor." />
              </div>
            ) : (
              <div className="mt-4 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line/60 bg-[#eeeae3] p-8 text-center">
                <span className="text-4xl">＋</span>
                <p className="mt-3 font-medium">Choose a clean product photograph</p>
                <p className="mt-1 max-w-sm text-sm text-ink-muted">Transparent PNG or WebP cut-outs give the best alpha analysis. JPEGs can be inspected, but their background may be opaque.</p>
              </div>
            )}
            {imageUrl && <p className="mt-2 text-xs text-ink-muted">{imageName} · {imageSize.width} × {imageSize.height} px · click the image to place the selected anchor</p>}
            {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          </div>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-line/50 p-5">
              <h2 className="font-display text-2xl">Asset details</h2>
              <label className="mt-4 block text-sm">Product name
                <input className="mt-1 w-full rounded-xl border border-line/50 bg-transparent px-3 py-2.5" value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} placeholder="e.g. Black satin slip dress" />
              </label>
              <label className="mt-3 block text-sm">Category
                <select className="mt-1 w-full rounded-xl border border-line/50 bg-paper px-3 py-2.5" value={category} onChange={(event) => { setCategory(event.target.value as Category); setSaved(false); }}>
                  {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </section>

            <section className="rounded-3xl border border-line/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl">Fitting anchors</h2>
                <span className="text-xs text-ink-muted">{completeRequired}/{required.length} required</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">Select a landmark, then click its position on the image. These are wearer landmarks, not automatic garment detections.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {anchorNames.map((anchor) => {
                  const isRequired = required.includes(anchor);
                  const placed = Boolean(anchors[anchor]);
                  return <button type="button" key={anchor} onClick={() => setActiveAnchor(anchor)} className={`rounded-xl border px-3 py-2 text-left text-xs ${activeAnchor === anchor ? "border-clay bg-clay/10" : "border-line/50"}`}>
                    <span className="block font-medium">{anchor}</span>
                    <span className="mt-1 block text-ink-muted">{placed ? "Placed" : isRequired ? "Required · missing" : "Optional · missing"}</span>
                  </button>;
                })}
              </div>
              {activeAnchor && <p className="mt-3 text-sm">Selected: <strong>{activeAnchor}</strong></p>}
              <button type="button" onClick={() => setAnchors((current) => { const next = { ...current }; delete next[activeAnchor]; return next; })} disabled={!anchors[activeAnchor]} className="mt-3 text-xs underline disabled:opacity-40">Remove selected anchor</button>
            </section>

            <section className="rounded-3xl border border-line/50 p-5">
              <h2 className="font-display text-2xl">Image analysis</h2>
              {plan ? <>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#eeeae3] p-3"><p className="text-xs text-ink-muted">Alpha coverage</p><p className="mt-1 text-xl font-semibold">{(plan.alphaCoverage * 100).toFixed(1)}%</p></div>
                  <div className="rounded-xl bg-[#eeeae3] p-3"><p className="text-xs text-ink-muted">Silhouette rows</p><p className="mt-1 text-xl font-semibold">{plan.silhouetteSamples}</p></div>
                </div>
                <p className="mt-3 text-xs text-ink-muted">Preparation: <strong>{plan.state}</strong> · {plan.uvRegions.length} proposed UV regions</p>
                {plan.warnings.map((warning) => <p key={warning} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{warning}</p>)}
              </> : <p className="mt-2 text-sm text-ink-muted">Choose an image to calculate alpha bounds and silhouette samples.</p>}
            </section>
            <section className="rounded-3xl border border-line/50 p-5">
              <h2 className="font-display text-xl">Save preparation</h2>
              <p className="mt-1 text-xs text-ink-muted">Drafts are saved locally in this browser. Export creates a JSON sidecar; the original image remains on your device.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={saveDraft} disabled={!plan} className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-40">Save draft</button>
                <button type="button" onClick={exportDraft} disabled={!plan} className="rounded-full border border-line/60 px-4 py-2 text-sm disabled:opacity-40">Export JSON</button>
              </div>
              {saved && <p className="mt-2 text-xs text-green-700">Draft saved in this browser.</p>}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
