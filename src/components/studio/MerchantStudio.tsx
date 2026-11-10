import { useState, type FormEvent } from "react";
import { Nav } from "@/components/site/Nav";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/isibuko-ai/catalog";
import { buildCustomProduct, canAddCustom, CUSTOM_CAP, tintToHex, type ProductDraft } from "@/lib/isibuko-ai/merchant";
import { assertProductImage, imageMagic } from "@/lib/isibuko-ai/privacy";
import { useWardrobe } from "@/lib/isibuko-ai/store";
import type { Category } from "@/lib/isibuko-ai/types";

const empty = {
  name: "",
  category: "shirt" as Category,
  price: 900,
  fabric: "",
  colourName: "",
  colourHex: "",
  merchantUrl: "",
  image: null as string | null,
  imageType: null as string | null,
  imageBytes: 0,
};

export function MerchantStudio({ tryHref }: { tryHref: (id: string) => string }) {
  const { data, commit } = useWardrobe();
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const custom = data.products.filter((item) => item.custom);

  function set<K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!canAddCustom(custom.length, Boolean(editing))) {
      setNote(`The studio holds ${CUSTOM_CAP} pieces. Remove one before adding another.`);
      return;
    }
    const body: ProductDraft = {
      name: draft.name,
      category: draft.category,
      priceZar: draft.price,
      fabric: draft.fabric,
      colourName: draft.colourName,
      colourHex: draft.colourHex,
      merchantUrl: draft.merchantUrl,
      image: draft.image,
      imageType: draft.imageType,
      imageBytes: draft.imageBytes,
    };
    const built = buildCustomProduct(body, editing ?? `custom-${Date.now()}`);
    if (!built.ok) {
      setNote(built.errors[0] ?? "The piece could not be saved.");
      return;
    }
    commit((current) => ({
      ...current,
      products: editing
        ? current.products.map((item) => (item.id === editing ? built.product : item))
        : [...current.products, built.product],
    }));
    setDraft(empty);
    setEditing(null);
    setNote(editing ? "Updated. It is still only in this browser." : "Added. Open it in the mirror. The photograph is not a measurement.");
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="bg-ink">
        <Nav />
      </div>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm tracking-widest text-ink-muted uppercase">Merchant · this browser</p>
        <h1 className="font-display mt-2 text-4xl">Studio</h1>
        <p className="mt-3 max-w-xl text-ink-muted">
          Add a piece the mirror can wear. The photograph stays on this device and is not uploaded. It is not a measurement, and it does not teach a model. Skirts need the hips in frame. Bracelets need a wrist.
        </p>
        <form className="mt-8 grid gap-4" onSubmit={save}>
          <label className="text-sm">
            Name
            <input className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3" value={draft.name} onChange={(event) => set("name", event.target.value)} />
          </label>
          <label className="text-sm">
            Category
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
              value={draft.category}
              onChange={(event) => set("category", event.target.value as Category)}
            >
              {CATEGORY_ORDER.map((item) => (
                <option key={item} value={item}>
                  {CATEGORY_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Fabric note
            <input className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3" value={draft.fabric} onChange={(event) => set("fabric", event.target.value)} placeholder="Washed linen" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              Price in rand
              <input className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3" type="number" min={0} value={draft.price} onChange={(event) => set("price", Number(event.target.value))} />
            </label>
            <label className="text-sm">
              Extra colour hex
              <input className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3" value={draft.colourHex} onChange={(event) => set("colourHex", event.target.value)} placeholder="#1c1a17" />
            </label>
          </div>
          <label className="text-sm">
            Colour name
            <input className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3" value={draft.colourName} onChange={(event) => set("colourName", event.target.value)} placeholder="Ink" />
          </label>
          <label className="text-sm">
            Merchant page
            <input className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3" value={draft.merchantUrl} onChange={(event) => set("merchantUrl", event.target.value)} placeholder="https://shop.example/shirt" />
          </label>
          <p className="text-sm text-ink-muted">Isibuko does not open that page itself. A private or file address is refused.</p>
          <label className="text-sm">
            Photograph
            <input
              className="mt-1 block w-full text-sm"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                void file.arrayBuffer().then((buffer) => {
                  const bytes = new Uint8Array(buffer);
                  const magic = imageMagic(bytes);
                  if (!magic) {
                    setNote("That file is not a JPEG, PNG, or WebP. The name of the file is not checked.");
                    return;
                  }
                  const checked = assertProductImage({ type: magic, size: bytes.byteLength });
                  if (!checked.ok) {
                    setNote(checked.reason);
                    return;
                  }
                  const blob = new Blob([bytes], { type: magic });
                  const reader = new FileReader();
                  reader.onload = () => {
                    set("image", typeof reader.result === "string" ? reader.result : null);
                    set("imageType", magic);
                    set("imageBytes", bytes.byteLength);
                  };
                  reader.readAsDataURL(blob);
                });
              }}
            />
          </label>
          <button type="submit" className="min-h-11 rounded-full bg-ink px-4 text-paper">
            {editing ? "Update piece" : "Add to the mirror"}
          </button>
          {note && <p className="text-sm text-ink-muted">{note}</p>}
        </form>
        <ul className="mt-8 space-y-3">
          {custom.map((product) => (
            <li key={product.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/30 px-4 py-3">
              <div>
                <p className="font-display text-xl">{product.name}</p>
                <p className="text-sm text-ink-muted">
                  {CATEGORY_LABEL[product.category]}
                  {product.fabric ? ` · ${product.fabric}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a className="inline-flex min-h-11 items-center text-sm underline" href={tryHref(product.id)}>
                  Try on
                </a>
                <p className="w-full text-sm text-ink-muted">Shop link: {tryHref(product.id)}. This opens Isibuko with the piece selected. It is not an embed in another shop, and a third-party iframe has not been tested.</p>
                <button
                  type="button"
                  className="min-h-11 text-sm"
                  onClick={() => {
                    setEditing(product.id);
                    setDraft({
                      name: product.name,
                      category: product.category,
                      price: product.priceZar,
                      fabric: product.fabric ?? "",
                      colourName: product.swatches[1]?.name ?? "",
                      colourHex: tintToHex(product.swatches[1]?.tint),
                      merchantUrl: product.merchantUrl ?? "",
                      image: product.image,
                      imageType: product.image?.startsWith("data:image/png") ? "image/png" : product.image?.startsWith("data:image/webp") ? "image/webp" : "image/jpeg",
                      imageBytes: product.image ? 1 : 0,
                    });
                    setNote("Editing. The photograph is kept unless you choose another.");
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="min-h-11 text-sm text-clay"
                  onClick={() =>
                    commit((current) => ({
                      ...current,
                      products: current.products.filter((item) => item.id !== product.id),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
          {custom.length === 0 && <li className="text-sm text-ink-muted">No studio pieces yet. The mirror still has the house catalogue. Skirts and bracelets start here.</li>}
        </ul>
      </div>
    </main>
  );
}
