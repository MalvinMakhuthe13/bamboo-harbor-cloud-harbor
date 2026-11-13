import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { analyzeProductAlpha, type AlphaGeometry } from "@/lib/isibuko-ai/anchors";
import {
  ASSET_DRAFT_STORAGE_KEY,
  buildAssetEditorProduct,
  buildAssetExportPayload,
  checkReattachedImageCompatibility,
  describeGarmentImageAnchor,
  loadSavedAssetDraft,
  parseAssetDraftJson,
  persistAssetDraft,
  validateAssetDataUrl,
  validateAssetImageBytes,
  type AssetSidecarExpectation,
  type StoredAssetDraft,
} from "@/lib/isibuko-ai/asset-editor";
import { prepareGarmentAsset, type GarmentAssetPlan } from "@/lib/isibuko-ai/garment-asset";
import { getGarmentFitProfile } from "@/lib/isibuko-ai/garment-profiles";
import { getDefaultImageStore } from "@/lib/isibuko-ai/local-image-db";
import type { ProductImageMime } from "@/lib/isibuko-ai/privacy";
import { useWardrobe } from "@/lib/isibuko-ai/store";
import type { Category, ProductAnchorPoint } from "@/lib/isibuko-ai/types";

export const Route = createFileRoute("/asset-editor")({ component: AssetEditorPage });

const CATEGORIES: Category[] = [
  "shirt",
  "jacket",
  "dress",
  "pants",
  "skirt",
  "wig",
  "hat",
  "glasses",
  "earrings",
  "necklace",
  "watch",
  "bracelet",
  "ring",
  "nails",
];
const STORAGE_KEY = ASSET_DRAFT_STORAGE_KEY;

function AssetEditorPage() {
  const [category, setCategory] = useState<Category>("shirt");
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<ProductImageMime | null>(null);
  const [imageBytes, setImageBytes] = useState(0);
  const [imageName, setImageName] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [alpha, setAlpha] = useState<AlphaGeometry | null>(null);
  const [anchors, setAnchors] = useState<Record<string, ProductAnchorPoint>>({});
  const [activeAnchor, setActiveAnchor] = useState("shoulderL");
  const [error, setError] = useState<string | null>(null);
  const [sidecarWarning, setSidecarWarning] = useState<string | null>(null);
  const [importedSidecar, setImportedSidecar] = useState<(AssetSidecarExpectation & { anchorCount: number }) | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [addedProduct, setAddedProduct] = useState<{ id: string; name: string; warning: string | null } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const { commitWithReport } = useWardrobe();
  const navigate = useNavigate();

  const profile = useMemo(() => getGarmentFitProfile(category), [category]);
  const plan: GarmentAssetPlan | null = useMemo(
    () => (alpha ? prepareGarmentAsset(category, alpha) : null),
    [alpha, category],
  );
  const anchorNames = useMemo(
    () => [...(profile?.requiredAnchors ?? []), ...(profile?.optionalAnchors ?? [])],
    [profile],
  );
  const activeAnchorGuide = useMemo(
    () => (activeAnchor ? describeGarmentImageAnchor(activeAnchor) : null),
    [activeAnchor],
  );

  useEffect(() => {
    try {
      setHasSavedDraft(Boolean(localStorage.getItem(STORAGE_KEY)));
    } catch {
      setHasSavedDraft(false);
    }
  }, []);

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
      context.strokeRect(
        b.left * canvas.width,
        b.top * canvas.height,
        (b.right - b.left) * canvas.width,
        (b.bottom - b.top) * canvas.height,
      );
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

  function processImageElement(
    image: HTMLImageElement,
    nameStr: string,
    dataUrlStr: string,
    mime: ProductImageMime,
    byteLength: number,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      setError("This browser could not read the image pixels.");
      return;
    }
    try {
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const result = analyzeProductAlpha(pixels, canvas.width, canvas.height);
      if (!result) throw new Error("The image could not be analysed.");
      imageRef.current = image;
      setImageUrl(dataUrlStr);
      setImageDataUrl(dataUrlStr);
      setImageMime(mime);
      setImageBytes(byteLength);
      setImageName(nameStr);
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setAlpha(result);
      setAddedProduct(null);
      setError(null);
      setSavedMessage(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Image analysis failed.");
    }
  }

  async function loadFile(file?: File) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checked = validateAssetImageBytes(bytes);
      if (!checked.ok) {
        setError(checked.reason);
        return;
      }
      const image = new Image();
      image.onload = () => {
        if (importedSidecar) {
          const compat = checkReattachedImageCompatibility(importedSidecar, {
            mime: checked.mime,
            size: checked.size,
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
          if (!compat.ok) {
            setError(compat.reason);
            return;
          }
          setSidecarWarning(compat.warning);
          setImportedSidecar(null);
          processImageElement(image, file.name, checked.dataUrl, checked.mime, checked.size);
          return;
        }
        setAnchors({});
        setSidecarWarning(null);
        processImageElement(image, file.name, checked.dataUrl, checked.mime, checked.size);
      };
      image.onerror = () => {
        setError("The selected image could not be decoded.");
      };
      image.src = checked.dataUrl;
    } catch {
      setError("Failed to read image file.");
    }
  }

  function placeAnchor(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !activeAnchor) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setAnchors((current) => ({ ...current, [activeAnchor]: { x, y, confidence: 1 } }));
    setSavedMessage(null);
  }

  async function saveDraft() {
    if (!plan || !imageUrl || !imageDataUrl || !imageMime) return;
    let browserStorage: Storage | null = null;
    try {
      browserStorage = window.localStorage;
    } catch {
      browserStorage = null;
    }
    const result = await persistAssetDraft(
      {
        name,
        category,
        sourceImage: imageName,
        imageSize,
        imageType: imageMime,
        imageBytes,
        imageDataUrl,
        alphaGeometry: alpha,
        preparation: plan,
        anchors,
      },
      {
        storage: browserStorage,
        imageStore: getDefaultImageStore(),
      },
    );
    if (!result.ok) {
      setSavedMessage(null);
      setError(result.message);
      return;
    }
    setSavedMessage(result.message);
    setSidecarWarning(result.warning);
    setHasSavedDraft(true);
    setError(null);
  }

  function loadValidatedDataUrl(dataUrl: string, nameStr: string) {
    const parsed = validateAssetDataUrl(dataUrl);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    const image = new Image();
    image.onload = () => {
      processImageElement(image, nameStr, dataUrl, parsed.mime, parsed.size);
    };
    image.onerror = () => {
      setError("The stored image could not be decoded.");
    };
    image.src = dataUrl;
  }

  function applyImportedSidecarState(draft: StoredAssetDraft) {
    imageRef.current = null;
    setImageUrl(null);
    setImageDataUrl(null);
    setName(draft.name);
    setCategory(draft.category);
    setImageName(draft.sourceImage);
    setImageMime(draft.imageType ?? null);
    setImageBytes(draft.imageBytes ?? 0);
    setImageSize(draft.imageSize);
    setAlpha(draft.alphaGeometry);
    const importedPoints = draft.fittingAnchors.points ?? {};
    setAnchors(importedPoints);
    setAddedProduct(null);
    setSidecarWarning(null);
    setImportedSidecar({
      sourceImage: draft.sourceImage,
      imageType: draft.imageType ?? null,
      imageBytes: draft.imageBytes ?? 0,
      imageSize: draft.imageSize,
      anchorCount: Object.keys(importedPoints).length,
    });
  }

  async function restoreSavedDraft() {
    let browserStorage: Storage | null = null;
    try {
      browserStorage = window.localStorage;
    } catch {
      browserStorage = null;
    }
    const loaded = await loadSavedAssetDraft({
      storage: browserStorage,
      imageStore: getDefaultImageStore(),
    });
    if (!loaded.ok) {
      if (!loaded.empty) setError(loaded.reason);
      return;
    }
    const { draft, storedImage, warning } = loaded;
    if (storedImage) {
      const imageCheck = validateAssetDataUrl(storedImage);
      if (!imageCheck.ok) {
        setError(imageCheck.reason);
        return;
      }
      setName(draft.name);
      setCategory(draft.category);
      setImageName(draft.sourceImage);
      setAnchors(draft.fittingAnchors.points ?? {});
      setAlpha(draft.alphaGeometry);
      setImportedSidecar(null);
      setSidecarWarning(null);
      loadValidatedDataUrl(storedImage, draft.sourceImage || "saved-draft");
      setSavedMessage("Saved draft restored.");
      setError(null);
      return;
    }

    applyImportedSidecarState(draft);
    if (warning) setSidecarWarning(warning);
    setSavedMessage(null);
    setError(null);
  }

  function exportDraft() {
    if (!plan || !alpha || !imageMime) return;
    const draft = buildAssetExportPayload({
      name,
      category,
      sourceImage: imageName,
      imageSize,
      imageType: imageMime,
      imageBytes,
      alphaGeometry: alpha,
      preparation: plan,
      anchors,
    });
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(name.trim() || "isibuko-garment").replace(/[^a-z0-9-_]+/gi, "-")}.asset.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importJsonFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError("The selected file could not be read as UTF-8 JSON.");
        return;
      }
      const parsed = parseAssetDraftJson(reader.result);
      if (!parsed.ok) {
        setError(parsed.reason);
        return;
      }
      const draft = parsed.draft;
      if (parsed.hasEmbeddedImage && draft.imageDataUrl) {
        setName(draft.name);
        setCategory(draft.category);
        setImageName(draft.sourceImage);
        setAnchors(draft.fittingAnchors.points ?? {});
        setAlpha(draft.alphaGeometry);
        setImportedSidecar(null);
        setSidecarWarning(null);
        loadValidatedDataUrl(draft.imageDataUrl, draft.sourceImage || file.name);
        setError(null);
        return;
      }
      applyImportedSidecarState(draft);
      setSavedMessage(null);
      setError(null);
    };
    reader.onerror = () => {
      setError("Failed to read the selected metadata file.");
    };
    reader.readAsText(file);
  }

  async function addToWardrobeAndTry() {
    const id = `custom-asset-${Date.now()}`;
    const built = buildAssetEditorProduct({
      name,
      category,
      imageDataUrl,
      anchors,
      id,
    });
    if (!built.ok) {
      setAddedProduct(null);
      setError(built.errors[0] ?? "Failed to create garment product.");
      return;
    }
    try {
      const report = await commitWithReport((current) => ({
        ...current,
        products: [built.product, ...current.products.filter((p) => p.id !== id)],
      }));
      setAddedProduct({ id: built.product.id, name: built.product.name, warning: report.warning });
      if (report.warning) setSidecarWarning(report.warning);
      setError(null);
    } catch (caught) {
      setAddedProduct(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save garment to browser storage. Your wardrobe was left unchanged.",
      );
    }
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
            <p className="mt-2 max-w-2xl text-sm text-ink-muted">
              Prepare a local product photograph, inspect its alpha silhouette, place garment-image anchors on the photo, and send it directly to your local wardrobe. Everything stays in this browser.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasSavedDraft && (
              <button
                type="button"
                onClick={() => void restoreSavedDraft()}
                className="rounded-full border border-line px-3 py-1 text-xs font-medium hover:bg-black/5"
              >
                Restore saved draft
              </button>
            )}
            <label className="cursor-pointer rounded-full border border-line px-3 py-1 text-xs font-medium hover:bg-black/5">
              Import JSON
              <input
                className="sr-only"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  importJsonFile(file);
                }}
              />
            </label>
            <span className="rounded-full border border-line/50 px-3 py-1 text-xs text-ink-muted">
              Local draft · no upload
            </span>
          </div>
        </div>

        {addedProduct && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-900">
            <div>
              <p className="font-medium">Piece added to wardrobe: {addedProduct.name}</p>
              <p className="text-xs text-green-700">
                {addedProduct.warning
                  ? addedProduct.warning
                  : "Local photograph and garment-image anchors saved in this browser without invented price or merchant details."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void navigate({ to: "/mirror", search: { product: addedProduct.id } })}
              className="rounded-full bg-green-800 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Try in live mirror →
            </button>
          </div>
        )}

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
          <div className="min-w-0 rounded-3xl border border-line/50 bg-white/50 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl">Product image</h2>
              <label className="cursor-pointer rounded-full bg-ink px-4 py-2 text-sm text-white hover:bg-ink/80">
                {importedSidecar ? "Reattach original image" : "Choose image"}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    void loadFile(file);
                  }}
                />
              </label>
            </div>
            {importedSidecar && (
              <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-medium">Metadata sidecar imported — photograph not included</p>
                <p className="mt-1 text-xs text-amber-900">
                  Exported <code>.asset.json</code> files store garment details, alpha silhouette metadata, and{" "}
                  <strong>{importedSidecar.anchorCount} garment-image anchor(s)</strong>, without embedding the image file.
                  Reattach the original photograph to restore the canvas and send this piece to your wardrobe while keeping all imported anchors.
                </p>
                <p className="mt-2 text-xs text-amber-900">
                  Expected file: <strong>{importedSidecar.sourceImage || "Original garment photograph"}</strong>
                  {importedSidecar.imageType ? ` · ${importedSidecar.imageType}` : ""}
                  {importedSidecar.imageSize.width > 0 ? ` · ${importedSidecar.imageSize.width} × ${importedSidecar.imageSize.height} px` : ""}
                  {importedSidecar.imageBytes > 0 ? ` · ${importedSidecar.imageBytes.toLocaleString()} bytes` : ""}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="cursor-pointer rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white hover:bg-ink/80">
                    Reattach original image
                    <input
                      className="sr-only"
                      type="file"
                      accept={importedSidecar.imageType ?? "image/png,image/jpeg,image/webp"}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        void loadFile(file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setImportedSidecar(null);
                      setAnchors({});
                      setAlpha(null);
                      setSidecarWarning(null);
                    }}
                    className="text-xs underline"
                  >
                    Clear imported sidecar
                  </button>
                </div>
              </div>
            )}
            {imageUrl ? (
              <div className="mt-4 overflow-auto rounded-2xl bg-[#eeeae3] p-2">
                <canvas
                  ref={canvasRef}
                  onPointerDown={placeAnchor}
                  className="mx-auto block max-h-[72vh] max-w-full cursor-crosshair touch-none object-contain"
                  aria-label="Product image. Click to place the selected garment-image anchor."
                />
              </div>
            ) : (
              <div className="mt-4 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line/60 bg-[#eeeae3] p-8 text-center">
                <span className="text-4xl">＋</span>
                <p className="mt-3 font-medium">
                  {importedSidecar ? "Waiting for the original product photograph" : "Choose a clean product photograph"}
                </p>
                <p className="mt-1 max-w-sm text-sm text-ink-muted">
                  Transparent PNG or WebP cut-outs give the best alpha analysis. JPEGs are supported, though their background is opaque. Max 1.5 MB.
                </p>
              </div>
            )}
            {imageUrl && (
              <p className="mt-2 text-xs text-ink-muted">
                {imageName} · {imageSize.width} × {imageSize.height} px{imageMime ? ` · ${imageMime}` : ""} · click the product photograph to place the selected garment-image anchor
              </p>
            )}
            {sidecarWarning && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {sidecarWarning}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
          </div>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-line/50 p-5">
              <h2 className="font-display text-2xl">Asset details</h2>
              <label className="mt-4 block text-sm">
                Product name (required)
                <input
                  className="mt-1 w-full rounded-xl border border-line/50 bg-transparent px-3 py-2.5"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSavedMessage(null);
                  }}
                  placeholder="e.g. Linen summer shirt"
                />
              </label>
              <label className="mt-3 block text-sm">
                Category
                <select
                  className="mt-1 w-full rounded-xl border border-line/50 bg-paper px-3 py-2.5"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value as Category);
                    setSavedMessage(null);
                  }}
                >
                  {CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="rounded-3xl border border-line/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl">Garment-image anchors</h2>
                <span className="text-xs text-ink-muted">
                  {completeRequired}/{required.length} required
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Mark where each garment landmark sits on the <strong>product photograph</strong>. During live try-on, these photo coordinates map onto the wearer&apos;s tracked body landmarks. They are manual photo annotations, not automatic detections.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {anchorNames.map((anchor) => {
                  const isRequired = required.includes(anchor);
                  const placed = Boolean(anchors[anchor]);
                  const guide = describeGarmentImageAnchor(anchor);
                  return (
                    <button
                      type="button"
                      key={anchor}
                      onClick={() => setActiveAnchor(anchor)}
                      className={`rounded-xl border px-3 py-2 text-left text-xs ${activeAnchor === anchor ? "border-clay bg-clay/10 font-semibold" : "border-line/50"}`}
                    >
                      <span className="block">{guide.label}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-ink-muted">{anchor}</span>
                      <span className="mt-1 block text-ink-muted">
                        {placed ? "Placed ✓" : isRequired ? "Required · missing" : "Optional · missing"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {activeAnchorGuide && (
                <div className="mt-3 rounded-xl bg-[#eeeae3] p-2.5 text-xs">
                  <p>
                    Selected: <strong>{activeAnchorGuide.label}</strong> ({activeAnchorGuide.key})
                  </p>
                  <p className="mt-0.5 text-ink-muted">
                    On photo: {activeAnchorGuide.imageHint} · Live fitting: {activeAnchorGuide.bodyTarget}
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  setAnchors((current) => {
                    const next = { ...current };
                    delete next[activeAnchor];
                    return next;
                  })
                }
                disabled={!anchors[activeAnchor]}
                className="mt-3 text-xs underline disabled:opacity-40"
              >
                Remove selected anchor
              </button>
            </section>

            <section className="rounded-3xl border border-line/50 p-5">
              <h2 className="font-display text-2xl">Image analysis</h2>
              {plan ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-[#eeeae3] p-3">
                      <p className="text-xs text-ink-muted">Alpha coverage</p>
                      <p className="mt-1 text-xl font-semibold">{(plan.alphaCoverage * 100).toFixed(1)}%</p>
                    </div>
                    <div className="rounded-xl bg-[#eeeae3] p-3">
                      <p className="text-xs text-ink-muted">Silhouette rows</p>
                      <p className="mt-1 text-xl font-semibold">{plan.silhouetteSamples}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-ink-muted">
                    Preparation: <strong>{plan.state}</strong> · {plan.uvRegions.length} proposed UV regions
                  </p>
                  {plan.warnings.map((warning) => (
                    <p key={warning} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {warning}
                    </p>
                  ))}
                </>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">
                  Choose an image to calculate alpha bounds and silhouette samples.
                </p>
              )}
            </section>

            <section className="rounded-3xl border border-line/50 p-5">
              <h2 className="font-display text-xl">Save & try-on</h2>
              <p className="mt-1 text-xs text-ink-muted">
                Save a local draft, export a JSON sidecar, or add the named asset to your wardrobe for live try-on without invented price or merchant metadata.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void addToWardrobeAndTry()}
                  disabled={!imageDataUrl}
                  className="rounded-full bg-brass px-4 py-2 text-sm font-semibold text-ink hover:opacity-90 disabled:opacity-40"
                >
                  Send to wardrobe & try
                </button>
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={!plan || !imageMime}
                  className="rounded-full bg-ink px-4 py-2 text-sm text-white hover:bg-ink/80 disabled:opacity-40"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={exportDraft}
                  disabled={!plan || !imageMime}
                  className="rounded-full border border-line/60 px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-40"
                >
                  Export JSON
                </button>
              </div>
              {savedMessage && <p className="mt-2 text-xs text-green-700">{savedMessage}</p>}
              {error && (
                <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
                  {error}
                </p>
              )}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

