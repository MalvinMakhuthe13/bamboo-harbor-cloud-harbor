import { useState, type FormEvent } from "react";
import { Nav } from "@/components/site/Nav";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/isibuko-ai/catalog";
import {
  buildCustomProduct,
  canAddCustom,
  CUSTOM_CAP,
  productToEditDraft,
  type ProductDraft,
} from "@/lib/isibuko-ai/merchant";
import { factText, FIELD_LABEL, type ProductFact } from "@/lib/isibuko-ai/product-facts";
import { assertProductImage, imageMagic } from "@/lib/isibuko-ai/privacy";
import { fetchProductPicture, guessFromPicture, medianColourHex } from "@/lib/isibuko-ai/bring-in";
import { useWardrobe } from "@/lib/isibuko-ai/store";

import {
  acceptPending,
  deleteProductReview,
  readProductReview,
  rejectPending,
  replacePhotograph,
  reviewPhotograph,
  writeProductReview,
  type ReviewRecord,
} from "@/lib/isibuko-ai/visual-review";

import type { Category, ProductFittingAnchors } from "@/lib/isibuko-ai/types";

const empty = {
  name: "",
  category: "shirt" as Category,
  price: 900 as number | null,
  fabric: "",
  colourName: "",
  colourHex: "",
  merchantUrl: "",
  purchaseUrl: "",
  image: null as string | null,
  imageType: null as string | null,
  imageBytes: 0,
  fittingAnchors: null as ProductFittingAnchors | null,
  sleeve: "long" as "sleeveless" | "short" | "long",
  neckline: "closed" as "closed" | "open" | "strapless",
};

/** A fresh ArrayBuffer copy. A view over SharedArrayBuffer is not a Blob part. */
function imageBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: mime });
}

export function MerchantStudio({ tryHref }: { tryHref: (id: string) => string }) {
  const { data, commit } = useWardrobe();
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [reviewerName, setReviewerName] = useState("");
  const [discarded, setDiscarded] = useState("");
  const custom = data.products.filter((item) => item.custom);

  function set<K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function usePictureBytes(bytes: Uint8Array, mime: string) {
    const checked = assertProductImage({ type: mime, size: bytes.byteLength });
    if (!checked.ok) {
      setNote(checked.reason);
      return;
    }
    let width = 1;
    let height = 1;
    let transparentRatio = 0;
    let colour: string | null = null;
    try {
      const bitmap = await createImageBitmap(imageBlob(bytes, mime));
      width = bitmap.width;
      height = bitmap.height;
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(48, bitmap.width);
      canvas.height = Math.min(48, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const pixels = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
        let clear = 0;
        for (let i = 3; i < pixels.length; i += 4) if ((pixels[i] ?? 255) < 20) clear += 1;
        transparentRatio = clear / (canvas.width * canvas.height);
        colour = medianColourHex(pixels);
      }
      bitmap.close();
    } catch {
      setNote("The picture could not be read.");
      return;
    }
    const guess = guessFromPicture({ width, height, transparentRatio, cornerUniform: false });
    set("category", guess.category);
    if (colour) set("colourHex", colour);
    const blob = imageBlob(bytes, mime);
    const reader = new FileReader();
    reader.onload = () => {
      set("image", typeof reader.result === "string" ? reader.result : null);
      set("imageType", mime);
      set("imageBytes", bytes.byteLength);
    };
    reader.readAsDataURL(blob);
    setNote(`${guess.reason} Confidence is low. Confirm the category before saving.`);
  }

  async function bringPicture(raw: string) {
    setNote("Fetching that picture. Your camera is not sent.");
    const fetched = await fetchProductPicture(raw);
    if (!fetched.ok) {
      setNote(fetched.reason);
      return;
    }
    await usePictureBytes(fetched.bytes, fetched.mime);
  }

  async function save(event: FormEvent) {
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
      purchaseUrl: draft.purchaseUrl,
      image: draft.image,
      imageType: draft.imageType,
      imageBytes: draft.imageBytes,
      fittingAnchors: draft.fittingAnchors,
      sleeve: draft.sleeve,
      neckline: draft.neckline,
    };

    const id = editing ?? `custom-${Date.now()}`;
    const built = buildCustomProduct(body, id);

    if (!built.ok) {
      setNote(built.errors[0] ?? "The piece could not be saved.");
      return;
    }

    setNote("Saving your piece…");

    try {
      const wasEditing = Boolean(editing);

      await commit((current) => ({
        ...current,
        products: wasEditing
          ? current.products.map((item) => (item.id === editing ? built.product : item))
          : [...current.products, built.product],
      }));

      if (review) {
        writeProductReview(window.localStorage, id, review);
      }

      setDraft(empty);
      setEditing(null);
      setReview(null);
      setDiscarded("");

      setNote(
        wasEditing
          ? "Updated. It is still only in this browser."
          : "Added. Open it in the mirror. The photograph is not a measurement.",
      );
    } catch (error) {
      setNote(
        error instanceof Error
          ? `Save failed: ${error.message}. Your form is preserved.`
          : "Save failed. Your form is preserved.",
      );
    }
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
          Add a piece the mirror can wear. The photograph stays on this device and is not uploaded.
          It is not a measurement, and it does not teach a model. Skirts need the hips in frame.
          Bracelets need a wrist.
        </p>
        <form className="mt-8 grid gap-4" onSubmit={save}>
          <label className="text-sm">
            Name
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />
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
          {(draft.category === "shirt" || draft.category === "jacket" || draft.category === "dress") && (
              <>
                <label className="mt-3 block text-sm">
                  Sleeve, as you state it
                  <select
                    className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3"
                    value={draft.sleeve}
                    onChange={(event) => set("sleeve", event.target.value as typeof draft.sleeve)}
                  >
                    <option value="sleeveless">Sleeveless</option>
                    <option value="short">Short sleeve</option>
                    <option value="long">Long sleeve</option>
                  </select>
                </label>
                <label className="mt-3 block text-sm">
                  Neckline, as you state it
                  <select
                    className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3"
                    value={draft.neckline}
                    onChange={(event) => set("neckline", event.target.value as typeof draft.neckline)}
                  >
                    <option value="closed">Closed collar</option>
                    <option value="open">Open neck</option>
                    <option value="strapless">Strapless</option>
                  </select>
                </label>
                <p className="mt-2 text-sm text-muted">
                  This is the cut you are stating. The photograph is not measured, and it does not choose the sleeve.
                </p>
              </>
          )}
          <label className="text-sm">
            Fabric note
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
              value={draft.fabric}
              onChange={(event) => set("fabric", event.target.value)}
              placeholder="Washed linen"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              Price in rand (optional)
              <input
                className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
                type="number"
                min={0}
                value={draft.price ?? ""}
                placeholder="Unpriced"
                onChange={(event) =>
                  set("price", event.target.value === "" ? null : Number(event.target.value))
                }
              />
            </label>
            <label className="text-sm">
              Extra colour hex
              <input
                className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
                value={draft.colourHex}
                onChange={(event) => set("colourHex", event.target.value)}
                placeholder="#1c1a17"
              />
            </label>
          </div>
          <label className="text-sm">
            Colour name
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
              value={draft.colourName}
              onChange={(event) => set("colourName", event.target.value)}
              placeholder="Ink"
            />
          </label>
          <label className="text-sm">
            Merchant page
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
              value={draft.merchantUrl}
              onChange={(event) => set("merchantUrl", event.target.value)}
              placeholder="https://shop.example/shirt"
            />
          </label>
          <p className="text-sm text-ink-muted">
            Isibuko does not open that page itself. A private or file address is refused.
          </p>
          <label className="text-sm">
            Purchase link, saved only
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
              value={draft.purchaseUrl}
              onChange={(event) => set("purchaseUrl", event.target.value)}
              placeholder="https://shop.example/buy"
            />
          </label>
          <p className="text-sm text-ink-muted">
            There is no checkout. The link is stored for later and is not opened.
          </p>
          <label className="text-sm">
            Picture link
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
              placeholder="https://shop.example/linen.jpg"
              onPaste={(event) => {
                const text = event.clipboardData.getData("text");
                if (text.startsWith("http")) {
                  event.preventDefault();
                  void bringPicture(text);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void bringPicture((event.target as HTMLInputElement).value);
              }}
            />
          </label>
          <p className="text-sm text-ink-muted">
            Paste or type a public picture link, or choose a file. The guess is from the picture's shape, not a model. Confirm the category before saving. Camera frames are not uploaded.
          </p>
          <label className="text-sm">
            <input
              className="mt-1 block w-full text-sm"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                void file.arrayBuffer().then(async (buffer) => {
                  const bytes = new Uint8Array(buffer);
                  const magic = imageMagic(bytes);
                  if (!magic) {
                    setNote(
                      "That file is not a JPEG, PNG, or WebP. The name of the file is not checked.",
                    );
                    return;
                  }
                  const checked = assertProductImage({ type: magic, size: bytes.byteLength });
                  if (!checked.ok) {
                    setNote(checked.reason);
                    return;
                  }
                  const outcome = await reviewPhotograph({ bytes });
                  if (!outcome.ok && outcome.hash === null) {
                    setNote(outcome.reason);
                    return;
                  }
                  if (outcome.hash) {
                    setReview((current) =>
                      replacePhotograph(
                        current,
                        outcome.hash as string,
                        outcome.ok ? outcome.pending : [],
                      ),
                    );
                    setDiscarded("");
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
          <section className="rounded-2xl border border-line/30 px-4 py-3" aria-live="polite">
            <p className="text-sm">Photograph observations</p>
            <p className="mt-1 text-sm text-ink-muted">
              A handcrafted scan of the file you just chose. It is not a model. Accepted
              observations are not written into the product. The reviewer name is self-reported, not
              a signed-in account.
            </p>
            {review ? (
              <div className="mt-3 grid gap-3">
                <label className="text-sm">
                  Self-reported reviewer name
                  <input
                    className="mt-1 min-h-11 w-full rounded-xl border border-line/40 bg-paper px-3"
                    value={reviewerName}
                    onChange={(event) => setReviewerName(event.target.value)}
                  />
                </label>
                {review.pending.map((fact) => (
                  <div
                    key={fact.field}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <p>
                      {FIELD_LABEL[fact.field] ?? fact.field}: {factText(fact)}. Detected. Not
                      verified.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="min-h-11"
                        onClick={() => {
                          const next = acceptPending(review, fact.field, reviewerName, Date.now());
                          if (!next.ok) {
                            setDiscarded(next.reason);
                            return;
                          }
                          setReview(next.record);
                          setDiscarded("");
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="min-h-11 text-clay"
                        onClick={() => {
                          setReview(rejectPending(review, fact.field));
                          setDiscarded("");
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
                {review.accepted.map((fact) => (
                  <p key={fact.field} className="text-sm">
                    {FIELD_LABEL[fact.field] ?? fact.field}: {factText(fact)}. {acceptedLabel(fact)}
                  </p>
                ))}
                {review.pending.length === 0 && review.accepted.length === 0 && (
                  <p className="text-sm text-ink-muted">
                    No separated foreground was available, so there is nothing to review.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">
                Choose a new photograph to scan it. Editing a piece does not scan the saved
                photograph again.
              </p>
            )}
            {discarded && <p className="mt-2 text-sm text-ink-muted">{discarded}</p>}
          </section>
          <button type="submit" className="min-h-11 rounded-full bg-ink px-4 text-paper">
            {editing ? "Update piece" : "Add to the mirror"}
          </button>
          {note && <p className="text-sm text-ink-muted">{note}</p>}
        </form>
        <ul className="mt-8 space-y-3">
          {custom.map((product) => (
            <li
              key={product.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/30 px-4 py-3"
            >
              <div>
                <p className="font-display text-xl">{product.name}</p>
                <p className="text-sm text-ink-muted">
                  {CATEGORY_LABEL[product.category]}
                  {product.fabric ? ` · ${product.fabric}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  className="inline-flex min-h-11 items-center text-sm underline"
                  href={tryHref(product.id)}
                >
                  Try on
                </a>
                <p className="w-full text-sm text-ink-muted">
                  Shop link: {tryHref(product.id)}. This opens Isibuko with the piece selected. It
                  is not an embed in another shop, and a third-party iframe has not been tested.
                </p>
                <button
                  type="button"
                  className="min-h-11 text-sm"
                  onClick={() => {
                    setEditing(product.id);
                    setReview(readProductReview(window.localStorage, product.id));
                    setDiscarded("");
                    const nextDraft = productToEditDraft(product);

                    setDraft({
                      name: nextDraft.name,
                      category: nextDraft.category,
                      price: nextDraft.priceZar,
                      fabric: nextDraft.fabric,
                      colourName: nextDraft.colourName,
                      colourHex: nextDraft.colourHex,
                      merchantUrl: nextDraft.merchantUrl,
                      purchaseUrl: nextDraft.purchaseUrl ?? "",
                      image: nextDraft.image,
                      imageType: nextDraft.imageType,
                      imageBytes: nextDraft.imageBytes,
                      fittingAnchors: nextDraft.fittingAnchors,
                      sleeve: nextDraft.sleeve ?? "long",
                      neckline: nextDraft.neckline ?? "closed",
                    });
                    setNote("Editing. The photograph is kept unless you choose another.");
                  }}
                >
                  Edit
                </button>

                <button
                  type="button"
                  className="min-h-11 text-sm text-clay"
                  onClick={async () => {
                    setNote("Removing piece…");

                    try {
                      await commit((current) => ({
                        ...current,
                        products: current.products.filter((item) => item.id !== product.id),
                      }));

                      deleteProductReview(window.localStorage, product.id);

                      if (editing === product.id) {
                        setDraft(empty);
                        setEditing(null);
                        setReview(null);
                      }

                      setNote("Piece removed.");
                    } catch (error) {
                      setNote(
                        error instanceof Error
                          ? `Could not remove piece: ${error.message}`
                          : "Could not remove piece. Please try again.",
                      );
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
          {custom.length === 0 && (
            <li className="text-sm text-ink-muted">
              No studio pieces yet. The mirror still has the house catalogue. Skirts and bracelets
              start here.
            </li>
          )}
        </ul>
      </div>
    </main>
  );
}

function acceptedLabel(fact: ProductFact): string {
  if (fact.source.kind !== "human") return "Self-reported acceptance. Not a signed-in account.";
  return `Accepted by ${fact.source.acceptedBy}, self-reported. Not a signed-in account.`;
}
