import { findProduct } from "./catalog.ts";
import type { Product } from "./types.ts";

export type MirrorSelectionResolution =
  | {
      status: "hydrating";
      product: null;
      requestedMissing: false;
    }
  | {
      status: "ready";
      product: Product;
      requestedMissing: boolean;
    };

/**
 * Resolves the active mirror garment without flashing a default catalogue item
 * while a requested custom product ID is still hydrating from browser storage.
 */
export function resolveMirrorProductSelection(opts: {
  products: readonly Product[];
  requestedProductId?: string;
  ready: boolean;
  selectedProductId: string | null;
}): MirrorSelectionResolution {
  const { products, requestedProductId, ready, selectedProductId } = opts;

  if (selectedProductId) {
    const chosen = products.find((item) => item.id === selectedProductId);
    if (chosen) {
      return { status: "ready", product: chosen, requestedMissing: false };
    }
  }

  if (requestedProductId) {
    const requested = products.find((item) => item.id === requestedProductId);
    if (requested) {
      return { status: "ready", product: requested, requestedMissing: false };
    }
    if (!ready) {
      return { status: "hydrating", product: null, requestedMissing: false };
    }
    return {
      status: "ready",
      product: findProduct([...products], requestedProductId),
      requestedMissing: true,
    };
  }

  return {
    status: "ready",
    product: findProduct([...products], undefined),
    requestedMissing: false,
  };
}
