import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Ruler, ShieldCheck, Store } from "lucide-react";
import type { ReactNode } from "react";
import { Nav } from "@/components/site/Nav";
import { CATEGORY_LABEL, CATEGORY_ORDER, DEFAULT_PRODUCTS, productsIn } from "@/lib/isibuko-ai/catalog";
import type { Category } from "@/lib/isibuko-ai/types";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <section className="bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-12 md:py-24">
          <div className="md:col-span-7">
            <p className="text-sm tracking-widest text-brass-2 uppercase">Live try-on, on the phone</p>
            <h1 className="font-display mt-4 text-5xl leading-tight text-paper md:text-6xl">
              See it on you, moving.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              Isibuko is a mirror for wigs, nails, glasses, jewellery and clothes. The camera stays on.
              The piece stays locked to the body. Nothing is uploaded.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/rail"
                className="inline-flex min-h-11 items-center rounded-full bg-brass px-5 text-ink"
              >
                Click a shirt
              </Link>
              <Link
                to="/mirror"
                className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-paper"
              >
                Open the mirror
              </Link>
            </div>
          </div>
          <div className="md:col-span-5">
            <div className="rounded-3xl border border-line bg-ink-2 p-6">
              <p className="font-display text-2xl">What a shopper does</p>
              <ol className="mt-4 space-y-3 text-muted">
                <li>1. On the rail, tap the piece. Or paste a shop link.</li>
                <li>2. Pick a size. The camera estimates the body. You are not asked to measure.</li>
                <li>3. Turn. The photograph follows the shoulders and the hips.</li>
                <li>4. Drag a piece. Let go. It eases back.</li>
                <li>5. Read the size, and the warning if it will run tight.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-16 md:grid-cols-4">
        <Point icon={<Camera />} title="Live, not a photo" text="MediaPipe tracks the face, hands and pose on the device. Three.js pins the piece to those points every frame." />
        <Point icon={<Ruler />} title="A size, from the camera" text="Shoulders, chest and waist come from the pose. Depth is assumed. You are not asked to type a measurement." />
        <Point icon={<ShieldCheck />} title="Video stays here" text="Frames are read in the browser and dropped. A shop only gets counts: tried on, size chosen." />
        <Point icon={<Store />} title="One engine, many pieces" text="A new wearable is a category, an anchor and a size chart. It is not a new app." />
      </section>

      <section className="border-t border-line/30">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl">What can be tried on</h2>
          <p className="mt-3 max-w-2xl text-ink-muted">
            The mirror fits a product photograph to the tracked body. It is MediaPipe plus a
            geometric composite, not a cloth simulation and not a generative frame. Shoes are not
            in this build.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-5">
            {CATEGORY_ORDER.map((category) => (
              <li key={category} className="rounded-2xl border border-line/40 bg-paper px-4 py-4">
                <Link to="/mirror" search={{ product: defaultProduct(category) }} className="block min-h-11">
                  <span className="font-display text-xl">{CATEGORY_LABEL[category]}</span>
                  <span className="mt-1 block text-sm text-ink-muted">Open in the mirror</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

function defaultProduct(category: Category) {
  return productsIn(DEFAULT_PRODUCTS, category)[0]?.id ?? "shirt-linen";
}

function Point({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-line/40 p-4">
      <div className="text-clay">{icon}</div>
      <h2 className="font-display mt-3 text-xl">{title}</h2>
      <p className="mt-2 text-sm text-ink-muted">{text}</p>
    </article>
  );
}
