import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Nav } from "@/components/site/Nav";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  MATERIAL_LABEL,
  defaultSizes,
  findProduct,
} from "@/lib/tryon/catalog";
import { emptyWardrobe, useWardrobe } from "@/lib/tryon/store";
import type { Category, Material, Product } from "@/lib/tryon/types";

export const Route = createFileRoute("/studio")({ component: Studio });

const MATERIALS: Material[] = ["silky", "curly", "cotton", "satin", "metal", "gloss"];

function Studio() {
  const { data, commit } = useWardrobe();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("wig");
  const [material, setMaterial] = useState<Material>("silky");
  const [color, setColor] = useState("#1a1210");
  const [blurb, setBlurb] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const counts = new Map<string, number>();
  for (const event of data.events) {
    counts.set(event.productId, (counts.get(event.productId) ?? 0) + 1);
  }

  function addProduct() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const product: Product = {
      id: `custom-${Date.now()}`,
      name: trimmed,
      category,
      material,
      color,
      blurb: blurb.trim() || "Added in the studio.",
      custom: true,
      style: category === "wig" ? "straight" : undefined,
      nailShape: category === "nails" ? "almond" : undefined,
      sizes: defaultSizes(category),
    };
    commit((current) => ({ ...current, products: [...current.products, product] }));
    setName("");
    setBlurb("");
  }

  async function copySnippet(product: Product) {
    const snippet = `<a href="/mirror?product=${product.id}">Try ${product.name} on</a>`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(product.id);
    } catch {
      setCopied(null);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <div className="mx-auto max-w-5xl px-5 py-10">
        <p className="text-sm tracking-widest text-clay uppercase">For the shop, on this device</p>
        <h1 className="font-display mt-3 text-5xl">Studio</h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          Catalogue, size charts and try-on counts stay in this browser. There is no account and no
          upload. The embed is a link into the mirror with a product id.
        </p>

        <section className="mt-10 grid gap-6 lg:grid-cols-5">
          <form
            className="rounded-3xl border border-line/40 p-5 lg:col-span-2"
            onSubmit={(event) => {
              event.preventDefault();
              addProduct();
            }}
          >
            <h2 className="font-display text-2xl">Add a piece</h2>
            <label className="mt-4 block text-sm">
              Name
              <input
                className="mt-1 w-full rounded-xl border border-line/50 px-3 py-3"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className="mt-3 block text-sm">
              Category
              <select
                className="mt-1 w-full rounded-xl border border-line/50 bg-paper px-3 py-3"
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
              >
                {CATEGORY_ORDER.map((item) => (
                  <option key={item} value={item}>
                    {CATEGORY_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Material
              <select
                className="mt-1 w-full rounded-xl border border-line/50 bg-paper px-3 py-3"
                value={material}
                onChange={(event) => setMaterial(event.target.value as Material)}
              >
                {MATERIALS.map((item) => (
                  <option key={item} value={item}>
                    {MATERIAL_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Colour
              <input
                className="mt-1 h-11 w-full"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
            <label className="mt-3 block text-sm">
              Note
              <input
                className="mt-1 w-full rounded-xl border border-line/50 px-3 py-3"
                value={blurb}
                onChange={(event) => setBlurb(event.target.value)}
              />
            </label>
            <button type="submit" className="mt-4 min-h-11 rounded-full bg-ink px-5 text-paper">
              Add to catalogue
            </button>
            <p className="mt-3 text-sm text-ink-muted">
              Size rows start from the category chart. Wigs use head circumference, shirts chest, trousers waist and hip, watches wrist, rings finger breadth, glasses face width.
            </p>
          </form>

          <div className="lg:col-span-3">
            <h2 className="font-display text-2xl">Catalogue</h2>
            <ul className="mt-4 space-y-3">
              {data.products.map((product) => (
                <li key={product.id} className="rounded-2xl border border-line/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-xl">{product.name}</p>
                      <p className="text-sm text-ink-muted">
                        {CATEGORY_LABEL[product.category]} · {MATERIAL_LABEL[product.material]} · tried{" "}
                        {counts.get(product.id) ?? 0}
                      </p>
                      <p className="mt-1 text-sm">{product.blurb}</p>
                      {product.sizes.length > 0 && (
                        <p className="mt-2 text-sm text-ink-muted">
                          {product.sizes.map((row) => row.label).join(" · ")}
                        </p>
                      )}
                    </div>
                    <span className="mt-1 h-8 w-8 shrink-0 rounded-full border border-line/40" style={{ background: product.color }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to="/mirror"
                      search={{ product: product.id }}
                      className="inline-flex min-h-11 items-center rounded-full bg-brass px-4 text-ink"
                    >
                      Try on
                    </Link>
                    <button
                      type="button"
                      className="min-h-11 rounded-full border border-line/50 px-4"
                      onClick={() => copySnippet(product)}
                    >
                      {copied === product.id ? "Copied" : "Copy embed link"}
                    </button>
                    {product.custom && (
                      <button
                        type="button"
                        className="min-h-11 rounded-full px-4 text-clay"
                        onClick={() =>
                          commit((current) => ({
                            ...current,
                            products: current.products.filter((item) => item.id !== product.id),
                          }))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl">Sizes chosen</h2>
          {data.events.length === 0 ? (
            <p className="mt-3 text-ink-muted">None yet. Choose a size in the mirror and it lands here.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line/30">
              {data.events.slice(0, 12).map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>
                    {findProduct(data.products, event.productId).name}
                    {event.size ? ` · ${event.size}` : ""}
                  </span>
                  <span className="text-ink-muted">{event.source === "live-scan" ? "Live scan" : "Height prior"}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="mt-6 min-h-11 text-sm text-ink-muted underline"
            onClick={() =>
              commit((current) => ({
                ...current,
                products: emptyWardrobe().products,
              }))
            }
          >
            Restore the sample catalogue
          </button>
        </section>
      </div>
    </main>
  );
}
