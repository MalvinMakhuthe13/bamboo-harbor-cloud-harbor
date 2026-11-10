import { useEffect, useRef, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { CATEGORY_LABEL, findProduct } from "@/lib/tryon/catalog";
import { renderTryOn } from "@/lib/tryon/render-tryon";
import { useWardrobe } from "@/lib/tryon/store";
import type { Product } from "@/lib/tryon/types";

const PERSON_KEY = "isibuko-person";

const SAMPLES = [
  { id: "a", label: "Shopper in white", src: "/people/shopper-a.jpg" },
  { id: "b", label: "Shopper in a knit", src: "/people/shopper-b.jpg" },
];

const RANK: Record<string, number> = {
  wig: 0,
  nails: 1,
  hat: 2,
  glasses: 3,
  shirt: 4,
  pants: 5,
};

export function MirrorApp({ initialProductId }: { initialProductId?: string }) {
  const { data, commit } = useWardrobe();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(initialProductId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const pieces = data.products
    .filter((item) => Boolean(item.image))
    .sort((a, b) => (RANK[a.category] ?? 9) - (RANK[b.category] ?? 9));
  const active = pieces.find((item) => item.id === activeId) ?? null;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(PERSON_KEY);
      if (saved?.startsWith("data:image/")) setPerson(saved);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let dead = false;
    if (!navigator.mediaDevices?.getUserMedia) return;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((next) => {
        if (dead) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        const video = videoRef.current;
        if (video) {
          video.srcObject = next;
          void video.play().catch(() => undefined);
        }
        setCamOn(true);
      })
      .catch(() => setCamOn(false));
    return () => {
      dead = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function remember(next: string) {
    setPerson(next);
    setResult(null);
    setError(null);
    try {
      sessionStorage.setItem(PERSON_KEY, next);
    } catch {
      /* quota */
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) {
      setError("The camera has no frame yet.");
      return;
    }
    remember(drawCover(video, 768));
    setNote("This frame is the one that gets the piece. The live camera is not sent.");
  }

  async function useFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a photograph.");
      return;
    }
    const bitmap = await createImageBitmap(file);
    remember(bitmapToJpeg(bitmap, 768));
    setNote("Your photograph stays in this tab until you clear it.");
  }

  async function useSample(src: string) {
    setBusy(true);
    setError(null);
    try {
      remember(await urlToJpeg(src, 768));
      setNote("Sample shopper. Click a wig, nails, or a shirt.");
    } catch {
      setError("That sample photograph did not load.");
    } finally {
      setBusy(false);
    }
  }

  async function wear(product: Product) {
    if (!product.image) {
      setError("That piece has no photograph.");
      return;
    }
    if (!person) {
      setActiveId(product.id);
      setError("Use a photo of you first, or tap a sample shopper.");
      return;
    }
    setBusy(true);
    setError(null);
    setActiveId(product.id);
    setNote(`Putting ${product.name} on the photograph.`);
    try {
      const local = product.image.startsWith("/");
      const out = await renderTryOn({
        data: {
          person,
          productName: product.name,
          category: product.category,
          productData: local ? await urlToJpeg(product.image, 768) : undefined,
          productUrl: product.image.startsWith("https://") ? product.image : undefined,
        },
      });
      if (!out.ok) {
        setError(out.error);
        setNote(null);
        return;
      }
      setResult(out.image);
      setNote(`${product.name} is on the photograph. It is a picture, not a tape measure.`);
      commit((current) => ({
        ...current,
        events: [
          {
            id: `${Date.now()}`,
            at: Date.now(),
            productId: product.id,
            productName: product.name,
            size: null,
            source: "live-scan" as const,
          },
          ...current.events,
        ].slice(0, 200),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photograph could not be made.");
      setNote(null);
    } finally {
      setBusy(false);
    }
  }

  const showing = result ?? person;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <div className="mx-auto max-w-6xl px-5 py-8">
        <p className="text-sm tracking-widest text-clay uppercase">Click a photograph</p>
        <h1 className="font-display mt-3 max-w-3xl text-4xl leading-tight md:text-5xl">
          It goes on you, for real.
        </h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          Wigs, nails, glasses and clothes are photographs. Tap one and it is put onto a still of
          you. One frame is sent to make that picture. The camera feed itself is not streamed.
        </p>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <div className="relative overflow-hidden rounded-[28px] bg-ink">
              <video
                ref={videoRef}
                className={`aspect-[3/4] w-full scale-x-[-1] object-cover ${showing ? "hidden" : ""}`}
                autoPlay
                muted
                playsInline
              />
              {showing && (
                <img
                  src={showing}
                  alt={result ? `You wearing ${active?.name ?? "the piece"}` : "Your photograph"}
                  className="aspect-[3/4] w-full object-cover"
                />
              )}
              {!showing && !camOn && (
                <div className="absolute inset-0 grid place-items-center px-6 text-center text-paper">
                  Camera is off. Upload a photograph or use a sample shopper.
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-ink/55 px-6 text-center text-paper">
                  Making the photograph…
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {!person && camOn && (
                <button type="button" className="min-h-11 rounded-full bg-ink px-5 text-paper" onClick={capture}>
                  Use this frame
                </button>
              )}
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line/60 px-5">
                Upload a photo
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="sr-only"
                  onChange={(event) => void useFile(event.target.files?.[0])}
                />
              </label>
              {person && (
                <button
                  type="button"
                  className="min-h-11 rounded-full border border-line/60 px-5"
                  onClick={() => {
                    setPerson(null);
                    setResult(null);
                    setNote(null);
                    try {
                      sessionStorage.removeItem(PERSON_KEY);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Clear photo
                </button>
              )}
              {result && (
                <button
                  type="button"
                  className="min-h-11 rounded-full border border-line/60 px-5"
                  onClick={() => setResult(null)}
                >
                  Show your photo
                </button>
              )}
            </div>
            {error && <p className="mt-3 text-sm text-clay">{error}</p>}
            {note && !error && <p className="mt-3 text-sm text-ink-muted">{note}</p>}
          </section>

          <aside>
            <p className="text-sm text-ink-muted">Start from a sample if you are not in front of a camera.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {SAMPLES.map((sample) => (
                <button key={sample.id} type="button" className="text-left" onClick={() => void useSample(sample.src)}>
                  <img src={sample.src} alt="" className="aspect-[3/4] w-full rounded-2xl object-cover" />
                  <span className="mt-1 block text-sm">{sample.label}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>

        <div className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl">The piece</h2>
            {active && (
              <p className="text-sm text-ink-muted">
                {CATEGORY_LABEL[active.category]} · {active.name}
              </p>
            )}
          </div>
          <ul className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {pieces.map((piece) => {
              const on = piece.id === activeId;
              return (
                <li key={piece.id} className="w-28 shrink-0">
                  <button
                    type="button"
                    disabled={busy}
                    className={`w-full text-left ${on ? "opacity-100" : "opacity-90"}`}
                    onClick={() => void wear(piece)}
                  >
                    <img
                      src={piece.image}
                      alt=""
                      className={`aspect-[3/4] w-full rounded-2xl object-cover ${on ? "ring-2 ring-ink ring-offset-2" : ""}`}
                    />
                    <span className="mt-2 block text-xs tracking-wide text-ink-muted uppercase">
                      {CATEGORY_LABEL[piece.category]}
                    </span>
                    <span className="block text-sm leading-tight">{piece.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {initialProductId && !findProduct(data.products, initialProductId).image && (
            <p className="mt-3 text-sm text-ink-muted">That piece has no photograph yet, so it cannot go on.</p>
          )}
        </div>
      </div>
    </main>
  );
}

function drawCover(video: HTMLVideoElement, max: number): string {
  const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function bitmapToJpeg(bitmap: ImageBitmap, max: number): string {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function urlToJpeg(src: string, max: number): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) throw new Error("Photograph missing");
  const bitmap = await createImageBitmap(await res.blob());
  return bitmapToJpeg(bitmap, max);
}
