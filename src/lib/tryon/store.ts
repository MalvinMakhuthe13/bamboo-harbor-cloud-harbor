import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PRODUCTS } from "@/lib/tryon/catalog";
import type { Product, TryEvent, Wardrobe } from "@/lib/tryon/types";

const KEY = "isibuko.v1";
const EVENT = "isibuko-change";

export function emptyWardrobe(): Wardrobe {
  return {
    v: 1,
    products: DEFAULT_PRODUCTS.map((p) => ({ ...p, sizes: p.sizes.map((s) => ({ ...s })) })),
    events: [],
    heightCm: 165,
    headCircCm: null,
  };
}

export function loadWardrobe(): Wardrobe {
  if (typeof window === "undefined") return emptyWardrobe();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyWardrobe();
    const parsed = JSON.parse(raw) as Partial<Wardrobe>;
    if (parsed.v !== 1 || !Array.isArray(parsed.products) || parsed.products.length === 0) {
      return emptyWardrobe();
    }
    const custom = (parsed.products as Product[]).filter(
      (item) => item.custom || !DEFAULT_PRODUCTS.some((stock) => stock.id === item.id),
    );
    return {
      v: 1,
      products: [...emptyWardrobe().products, ...custom],
      events: Array.isArray(parsed.events) ? (parsed.events as TryEvent[]).slice(0, 200) : [],
      heightCm: typeof parsed.heightCm === "number" ? parsed.heightCm : 165,
      headCircCm: typeof parsed.headCircCm === "number" ? parsed.headCircCm : null,
    };
  } catch {
    return emptyWardrobe();
  }
}

function persist(next: Wardrobe) {
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
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
    persist(next);
    setStored(next);
  }, []);

  return { data, ready: stored != null, commit };
}
