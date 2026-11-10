import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PRODUCTS } from "@/lib/isibuko-ai/catalog";
import type { Product, TryEvent, Wardrobe } from "@/lib/isibuko-ai/types";

const KEY = "isibuko.live.v1";
const EVENT = "isibuko-live-change";

function cloneProducts(): Product[] {
  return DEFAULT_PRODUCTS.map((product) => ({
    ...product,
    sizes: product.sizes.map((row) => ({ ...row })),
    swatches: product.swatches.map((swatch) => ({ ...swatch, tint: swatch.tint ? [...swatch.tint] as [number, number, number] : null })),
  }));
}

export function emptyWardrobe(): Wardrobe {
  return { v: 1, products: cloneProducts(), events: [], heightCm: 170 };
}

export function loadWardrobe(): Wardrobe {
  if (typeof window === "undefined") return emptyWardrobe();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyWardrobe();
    const parsed = JSON.parse(raw) as Partial<Wardrobe>;
    if (parsed.v !== 1 || !Array.isArray(parsed.products)) return emptyWardrobe();
    const custom = (parsed.products as Product[]).filter((item) => item.custom && item.id && item.name && item.category);
    return {
      v: 1,
      products: [...cloneProducts(), ...custom],
      events: Array.isArray(parsed.events) ? (parsed.events as TryEvent[]).slice(0, 80) : [],
      heightCm: typeof parsed.heightCm === "number" ? parsed.heightCm : 170,
    };
  } catch {
    return emptyWardrobe();
  }
}

export function useWardrobe() {
  const [stored, setStored] = useState<Wardrobe | null>(null);
  useEffect(() => {
    setStored(loadWardrobe());
    const sync = () => setStored(loadWardrobe());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const fallback = useRef<Wardrobe | null>(null);
  if (!fallback.current) fallback.current = emptyWardrobe();
  const data = stored ?? fallback.current;
  const commit = useCallback((fn: (current: Wardrobe) => Wardrobe) => {
    const next = fn(loadWardrobe());
    const custom = next.products.filter((item) => item.custom);
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, products: custom, events: next.events.slice(0, 80), heightCm: next.heightCm }),
    );
    window.dispatchEvent(new Event(EVENT));
    setStored(loadWardrobe());
  }, []);
  return { data, ready: stored != null, commit };
}
