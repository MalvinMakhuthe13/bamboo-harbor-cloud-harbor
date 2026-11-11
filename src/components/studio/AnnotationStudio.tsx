import { useEffect, useRef, useState } from "react";
import {
  PARTS,
  TRAINING_CATEGORIES,
  FUTURE_CATEGORIES,
  addPoint,
  closePolygon,
  emptySession,
  importSample,
  markAbsent,
  missingParts,
  removePartGeometry,
  sessionFromJson,
  sessionJson,
  setBox,
  setCategory,
  setGarmentPolygon,
  setPartConfidence,
  type AnnotationSession,
  type PartName,
  type Point,
} from "@/lib/isibuko-gen/annotate";
import { packageImageName, storeZip } from "@/lib/isibuko-gen/dataset-zip";

const STORAGE_KEY = "isibuko-annotation-session";

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function AnnotationStudio() {
  const [session, setSession] = useState<AnnotationSession>(emptySession);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [part, setPart] = useState<PartName>("collar");
  const [tool, setTool] = useState<"polygon" | "box" | "outline">("polygon");
  const [zoom, setZoom] = useState(2);
  const [showMask, setShowMask] = useState(true);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<Point | null>(null);
  const filesRef = useRef<Map<string, Uint8Array>>(new Map());
  const urlsRef = useRef<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = session.samples.find((sample) => sample.sampleId === activeId) ?? null;

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const restored = sessionFromJson(saved);
      setSession(restored);
      setActiveId(restored.samples[0]?.sampleId ?? null);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const url = active ? preview[active.sampleId] : undefined;
    if (!canvas || !active || !url) return;
    const image = new Image();
    image.onload = () => {
      canvas.width = active.width * zoom;
      canvas.height = active.height * zoom;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const draw = (points: Point[] | null, colour: string, fill: boolean) => {
        if (!points || points.length === 0) return;
        context.beginPath();
        points.forEach(([x, y], index) => {
          const next = [x * zoom, y * zoom] as Point;
          if (index === 0) context.moveTo(next[0], next[1]);
          else context.lineTo(next[0], next[1]);
        });
        context.closePath();
        context.strokeStyle = colour;
        context.lineWidth = 2;
        context.stroke();
        if (fill && showMask) {
          context.fillStyle = colour;
          context.globalAlpha = 0.28;
          context.fill();
          context.globalAlpha = 1;
        }
      };
      draw(active.garmentPolygon, "#1f6f4a", true);
      for (const name of PARTS) {
        const mark = active.parts[name];
        if (mark.kind === "polygon") draw(mark.polygon, name === part ? "#9a3412" : "#444", false);
        if (mark.kind === "box" && mark.box) {
          const [x, y, width, height] = mark.box;
          context.strokeStyle = name === part ? "#9a3412" : "#444";
          context.strokeRect(x * zoom, y * zoom, width * zoom, height * zoom);
        }
      }
    };
    image.src = url;
  }, [active, preview, zoom, showMask, part, session]);

  function update(sampleId: string, edit: (sample: AnnotationSession["samples"][number]) => void) {
    const next = structuredClone(session);
    const sample = next.samples.find((item) => item.sampleId === sampleId);
    if (!sample) return;
    try {
      edit(sample);
      setError(null);
      setSession(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That edit was rejected.");
    }
  }

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>): Point | null {
    if (!active || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * active.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * active.height);
    if (x < 0 || y < 0 || x >= active.width || y >= active.height) return null;
    return [x, y];
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const file of files) {
      const url = URL.createObjectURL(file);
      try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Image could not be decoded."));
        element.src = url;
      });
      const digest = await sha256(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let sampleId = `${file.name}-${digest.slice(0, 8)}`;
      setSession((current) => {
        const next = structuredClone(current);
        const existing = next.samples.find((sample) => sample.assetHash === digest);
        if (existing) sampleId = existing.sampleId;
        else importSample(next, { sampleId, sku: "", imageName: file.name, assetHash: digest, width: image.width, height: image.height });
        return next;
      });
      filesRef.current.set(sampleId, bytes);
      setPreview((current) => {
        const previous = current[sampleId];
        if (previous) URL.revokeObjectURL(previous);
        return { ...current, [sampleId]: url };
      });
      urlsRef.current.push(url);
      setActiveId(sampleId);
      } catch (caught) {
        URL.revokeObjectURL(url);
        setError(caught instanceof Error ? caught.message : "The photograph could not be imported.");
      }
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, sessionJson(session));
  }

  function exportZip() {
    const files: { name: string; data: Uint8Array }[] = [];
    const samples = session.samples.map((sample) => ({ ...sample, imageFile: packageImageName(sample.sampleId, sample.imageName) }));
    const missing = [];
    for (const sample of samples) {
      const data = filesRef.current.get(sample.sampleId);
      if (!data) missing.push(sample.imageName);
      else files.push({ name: sample.imageFile, data });
    }
    if (missing.length) {
      setError(`Import the photograph again before exporting: ${missing.join(", ")}`);
      return;
    }
    files.unshift({ name: "session.json", data: new TextEncoder().encode(JSON.stringify({ version: 1, samples })) });
    const blob = new Blob([storeZip(files)], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "isibuko-dataset.zip";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4 px-5 py-4 lg:grid-cols-[240px_1fr_280px]">
      <section className="space-y-3">
        <h1 className="font-display text-2xl">Annotation studio</h1>
        <p className="text-sm text-ink-muted">Drawn masks are annotations. They are not a learned segmentation model, and this page does not train.</p>
        <input aria-label="Import garment photographs" type="file" accept="image/*" multiple onChange={(event) => void onFiles(event.target.files)} />
        <ul className="space-y-1 text-sm">
          {session.samples.map((sample) => (
            <li key={sample.sampleId}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-black/5" onClick={() => setActiveId(sample.sampleId)}>
                {sample.sku || sample.imageName}
                <span className="block text-ink-muted">{sample.assetHash.slice(0, 12)} · {missingParts(sample).length} parts open</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        {active ? (
          <>
            {error ? <p className="mb-2 text-sm text-red-800">{error}</p> : null}
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <label>Zoom <input aria-label="Zoom" type="range" min={1} max={8} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
              <label><input type="checkbox" checked={showMask} onChange={(event) => setShowMask(event.target.checked)} /> Compare mask</label>
              {(["polygon", "box", "outline"] as const).map((name) => (
                <button key={name} type="button" className="rounded-full border px-3 py-1" onClick={() => setTool(name)}>{name}</button>
              ))}
            </div>
            {preview[active.sampleId] ? (
              <canvas
                ref={canvasRef}
                className="max-w-full border bg-white"
                onPointerDown={(event) => {
                  const point = pointFrom(event);
                  if (!point) return;
                  if (tool === "box") setDrag(point);
                  else if (tool === "outline") update(active.sampleId, (sample) => { sample.garmentPolygon = [...(sample.garmentPolygon ?? []), point]; });
                  else update(active.sampleId, (sample) => addPoint(sample, part, point));
                }}
                onPointerUp={(event) => {
                  if (tool !== "box" || !drag) return;
                  const point = pointFrom(event);
                  setDrag(null);
                  if (!point) return;
                  const box: [number, number, number, number] = [Math.min(drag[0], point[0]), Math.min(drag[1], point[1]), Math.abs(point[0] - drag[0]) || 1, Math.abs(point[1] - drag[1]) || 1];
                  update(active.sampleId, (sample) => setBox(sample, part, box));
                }}
              />
            ) : (
              <p className="text-sm">This saved sample has no image in this browser session. Import the same photograph again to resume drawing.</p>
            )}
          </>
        ) : (
          <p className="text-sm">Import a merchant-owned or Isibuko-owned garment photograph to begin.</p>
        )}
      </section>
      {active ? (
        <section className="space-y-3 text-sm">
          <label className="block">SKU <input className="w-full border px-2 py-1" value={active.sku} onChange={(event) => update(active.sampleId, (sample) => { sample.sku = event.target.value; })} /></label>
          <label className="block">Training category
            <select className="w-full border px-2 py-1" value={active.category ?? ""} onChange={(event) => update(active.sampleId, (sample) => setCategory(sample, event.target.value))}>
              <option value="" disabled>Choose</option>
              {TRAINING_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="block">Future category, not a training label
            <select className="w-full border px-2 py-1" value={active.futureCategory ?? ""} onChange={(event) => { if (event.target.value) update(active.sampleId, (sample) => setCategory(sample, event.target.value)); }}>
              <option value="">None</option>
              {FUTURE_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-1">
            {PARTS.map((name) => (
              <button key={name} type="button" className="rounded-full border px-2 py-1" onClick={() => setPart(name)}>{name}</button>
            ))}
          </div>
          <p>Editing {part}. Present: {String(active.parts[part].present)}. Side: {active.parts[part].side ?? "unspecified"}.</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" className="rounded border px-2 py-1" onClick={() => update(active.sampleId, (sample) => closePolygon(sample, part))}>Close polygon</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => update(active.sampleId, (sample) => { if (sample.parts[part].polygon) setGarmentPolygon(sample, sample.parts[part].polygon!); })}>Use as garment outline</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => update(active.sampleId, (sample) => markAbsent(sample, part))}>Mark absent</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => update(active.sampleId, (sample) => removePartGeometry(sample, part))}>Remove</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => update(active.sampleId, (sample) => { sample.parts[part].side = sample.parts[part].side === "left" ? "right" : "left"; })}>Swap left/right</button>
          </div>
          <label className="block">Part confidence
            <input aria-label="Part confidence" type="range" min={0} max={1} step={0.05} value={active.parts[part].confidence ?? 0} onChange={(event) => update(active.sampleId, (sample) => setPartConfidence(sample, part, Number(event.target.value)))} />
          </label>
          <label className="block">Fabric, merchant record, not visually detected
            <input className="w-full border px-2 py-1" value={active.merchant.fabric} onChange={(event) => update(active.sampleId, (sample) => { sample.merchant.fabric = event.target.value; sample.merchant.visuallyDetected = false; })} />
          </label>
          <label className="block">Colours, merchant record
            <input className="w-full border px-2 py-1" value={active.merchant.colours.join(", ")} onChange={(event) => update(active.sampleId, (sample) => { sample.merchant.colours = event.target.value.split(",").map((item) => item.trim()).filter(Boolean); })} />
          </label>
          <label className="block">Pattern, merchant record
            <input className="w-full border px-2 py-1" value={active.merchant.pattern ?? ""} onChange={(event) => update(active.sampleId, (sample) => { sample.merchant.pattern = event.target.value || null; })} />
          </label>
          <label className="block">Annotator <input className="w-full border px-2 py-1" value={active.annotator} onChange={(event) => update(active.sampleId, (sample) => { sample.annotator = event.target.value; })} /></label>
          <label className="block">Independent reviewer <input className="w-full border px-2 py-1" value={active.reviewer} onChange={(event) => update(active.sampleId, (sample) => { sample.reviewer = event.target.value; })} /></label>
          <label className="block">Split
            <select className="w-full border px-2 py-1" value={active.split ?? ""} onChange={(event) => update(active.sampleId, (sample) => { sample.split = event.target.value === "train" || event.target.value === "val" || event.target.value === "test" ? event.target.value : null; })}>
              <option value="">Unset</option>
              <option value="train">train</option>
              <option value="val">val</option>
              <option value="test">test</option>
            </select>
          </label>
          <label className="block">Licence
            <select className="w-full border px-2 py-1" value={active.licence ?? ""} onChange={(event) => update(active.sampleId, (sample) => { sample.licence = event.target.value || null; if (sample.consent) sample.consent.rights = event.target.value; })}>
              <option value="">Unset</option>
              <option value="isibuko-owned">isibuko-owned</option>
              <option value="commercially-licensed">commercially-licensed</option>
            </select>
          </label>
          <label className="block">Commercial use
            <select className="w-full border px-2 py-1" value={active.commercialUse === null ? "" : String(active.commercialUse)} onChange={(event) => update(active.sampleId, (sample) => { sample.commercialUse = event.target.value === "" ? null : event.target.value === "true"; })}>
              <option value="">Unset</option>
              <option value="true">Granted</option>
              <option value="false">Not granted</option>
            </select>
          </label>
          <label className="block">Training consent
            <select className="w-full border px-2 py-1" value={active.consent ? String(active.consent.allowsTraining) : ""} onChange={(event) => update(active.sampleId, (sample) => { if (!event.target.value) { sample.consent = null; return; } sample.consent = { consentId: sample.consent?.consentId || `${sample.sampleId}-consent`, rights: sample.licence ?? "", allowsTraining: event.target.value === "true", allowsPersonImagery: sample.consent?.allowsPersonImagery ?? null }; })}>
              <option value="">Unset</option>
              <option value="true">Allows training</option>
              <option value="false">Does not allow training</option>
            </select>
          </label>
          <label className="block">Person imagery
            <select className="w-full border px-2 py-1" value={active.consent && active.consent.allowsPersonImagery !== null ? String(active.consent.allowsPersonImagery) : ""} onChange={(event) => update(active.sampleId, (sample) => { if (!sample.consent) return; sample.consent.allowsPersonImagery = event.target.value === "" ? null : event.target.value === "true"; })}>
              <option value="">Unset</option>
              <option value="false">Not permitted</option>
              <option value="true">Permitted</option>
            </select>
          </label>
          <label className="block">Provenance source <input className="w-full border px-2 py-1" value={active.provenance?.source ?? ""} onChange={(event) => update(active.sampleId, (sample) => { sample.provenance = { source: event.target.value, acquired: sample.provenance?.acquired ?? "", origin: sample.provenance?.origin || sample.imageName }; })} /></label>
          <label className="block">Acquired <input className="w-full border px-2 py-1" value={active.provenance?.acquired ?? ""} onChange={(event) => update(active.sampleId, (sample) => { sample.provenance = { source: sample.provenance?.source ?? "", acquired: event.target.value, origin: sample.provenance?.origin || sample.imageName }; })} /></label>
          <p className="text-ink-muted">Logos, material, and pattern are not inferred from this form. SHA-256 {active.assetHash.slice(0, 16)} stays the image identity.</p>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-ink px-3 py-2 text-paper" onClick={save}>Save</button>
            <button type="button" className="rounded border px-3 py-2" onClick={exportZip}>Export dataset ZIP</button>
          </div>
          <p className="text-ink-muted">Upload that ZIP to Kaggle and run <code>python3 services/isibuko-infer/import_dataset.py --zip /kaggle/working/isibuko-dataset.zip --dest /kaggle/working/isibuko-dataset</code>. The importer writes the manifest and masks. It does not approve the rows.</p>
        </section>
      ) : null}
    </div>
  );
}
