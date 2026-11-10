import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Ruler, ShieldCheck, Store } from "lucide-react";
import type { ReactNode } from "react";
import { Nav } from "@/components/site/Nav";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/tryon/catalog";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <section className="bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-12 md:py-24">
          <div className="md:col-span-7">
            <p className="text-sm tracking-widest text-brass-2 uppercase">A photograph, on you</p>
            <h1 className="font-display mt-4 text-5xl leading-tight text-paper md:text-6xl">
              Click it. It goes on, for real.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              Isibuko puts a real product photograph on a real person. A wig, a set of nails, a shirt.
              Not a cartoon body. One still is used. The live camera is not streamed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/rail"
                className="inline-flex min-h-11 items-center rounded-full bg-brass px-5 text-ink"
              >
                Click a photograph
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
                <li>1. Take a frame, upload a photo, or start from a sample shopper.</li>
                <li>2. Tap a wig, nails, glasses or a shirt. The photograph is the product.</li>
                <li>3. The piece is put onto that still. The face stays the shopper's.</li>
                <li>4. Tap another photograph. That one replaces it.</li>
                <li>5. The picture is not a tape measure. Size charts stay on the piece.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-16 md:grid-cols-4">
        <Point icon={<Camera />} title="A still, not a cartoon" text="You click a product photograph. It is placed onto one frame of you. Wigs, nails and clothes, the same way." />
        <Point icon={<Ruler />} title="The picture is not a tape" text="Fit charts are still on the piece. The photograph does not measure your chest." />
        <Point icon={<ShieldCheck />} title="One frame, on purpose" text="The live camera stays on the phone. A still is sent only when you tap a piece, to make that picture." />
        <Point icon={<Store />} title="A shop link works too" text="Paste a product page. If it has a photograph, that photograph is what goes on." />
      </section>

      <section className="border-t border-line/30">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl">What can be tried on</h2>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Wigs and nails first, then shirts and trousers. Each card is a photograph. Tap it and that
            photograph is what goes on the person. Jewellery without a picture stays off the rail.
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

function defaultProduct(category: string) {
  if (category === "wig") return "wig-straight";
  if (category === "hat") return "hat-beret";
  if (category === "nails") return "nails-french";
  if (category === "glasses") return "glasses-round";
  if (category === "earrings") return "earrings-drop";
  if (category === "necklace") return "necklace-chain";
  if (category === "ring") return "ring-signet";
  if (category === "watch") return "watch-round";
  if (category === "shirt") return "shirt-linen";
  return "pants-tailored";
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
