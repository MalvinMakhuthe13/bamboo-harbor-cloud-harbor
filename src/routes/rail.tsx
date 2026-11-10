import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Nav } from "@/components/site/Nav";
import { CATEGORY_LABEL } from "@/lib/tryon/catalog";
import { readShopLink } from "@/lib/tryon/shop-link";
import { useWardrobe } from "@/lib/tryon/store";
import type { Product } from "@/lib/tryon/types";

export const Route = createFileRoute("/rail")({ component: Rail });

function Rail() {
  const { data, commit } = useWardrobe();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pieces = [...data.products].sort((a, b) => rank(a) - rank(b));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const read = await readShopLink({ data: { url: trimmed } });
      const product: Product = {
        id: read.id,
        name: read.name,
        category: read.category,
        material: read.material,
        color: read.color,
        blurb: read.blurb,
        custom: true,
        style: read.category === "wig" ? "straight" : undefined,
        nailShape: read.category === "nails" ? "almond" : undefined,
        sizes: read.sizes,
        priceZar: read.priceZar ?? undefined,
        image: read.image ?? undefined,
        sourceUrl: read.sourceUrl,
      };
      commit((current) => ({
        ...current,
        products: [...current.products.filter((item) => item.id !== product.id), product],
      }));
      await navigate({ to: "/mirror", search: { product: product.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That link could not be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <div className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-sm tracking-widest text-clay uppercase">Click it. It goes on.</p>
        <h1 className="font-display mt-3 max-w-3xl text-5xl leading-tight">A shirt from the rail, or from a shop link.</h1>
        <p className="mt-4 max-w-2xl text-ink-muted">
          Paste a product page — Superbalist, a brand site, anywhere with a title. Isibuko reads the
          name, the photo, the rand price, and the size chart when the page has one. Then the piece
          is on the body. The size you pick is the ease. The folds follow the turn.
        </p>

        <form className="mt-8 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void onSubmit(event)}>
          <label className="min-w-0 flex-1 text-sm">
            <span className="sr-only">Product link</span>
            <input
              className="w-full rounded-full border border-line/50 bg-paper px-4 py-3"
              placeholder="https://superbalist.com/…/shirt"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <button type="submit" className="min-h-11 rounded-full bg-ink px-5 text-paper" disabled={busy}>
            {busy ? "Reading the page" : "Try this link"}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-clay">{error}</p>}

        <ul className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3">
          {pieces.map((piece) => (
            <li key={piece.id}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => void navigate({ to: "/mirror", search: { product: piece.id } })}
              >
                {piece.image ? (
                  <img src={piece.image} alt="" className="aspect-[3/4] w-full rounded-2xl object-cover" />
                ) : (
                  <span
                    className={`flex aspect-[3/4] w-full items-end rounded-2xl p-4 ${inkOn(piece.color)}`}
                    style={{ background: piece.color }}
                  >
                    <span className="font-display text-2xl leading-tight">{piece.name}</span>
                  </span>
                )}
                <span className="mt-3 block text-sm text-ink-muted">{CATEGORY_LABEL[piece.category]}</span>
                <span className="font-display block text-xl leading-tight">{piece.name}</span>
                <span className="mt-1 block text-sm text-ink-muted">
                  {piece.priceZar != null ? `R ${piece.priceZar.toLocaleString("en-ZA")}` : "Try it on"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

function rank(piece: Product): number {
  if (piece.category === "shirt") return 0;
  if (piece.category === "pants") return 1;
  return 2;
}

function inkOn(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return "text-paper";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.3 + g * 0.59 + b * 0.11 > 160 ? "text-ink" : "text-paper";
}
