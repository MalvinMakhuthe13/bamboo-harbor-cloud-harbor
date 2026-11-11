/** Exact merchant product identity. A colour name is not a new garment unless the asset hash changes. */

export type ProductAsset = {
  brandId: string;
  sku: string;
  category: string;
  imageRef: string;
  maskRef: string | null;
  geometryRef: string | null;
  colours: string[];
  textureRef: string | null;
  patternRef: string | null;
  logoRefs: string[];
  material: string;
  sizeLabel: string | null;
  measurementsCm: { chest?: number; length?: number; shoulder?: number; waist?: number };
  contentHash: string;
};

export type ProductLock = {
  lockId: string;
  brandId: string;
  sku: string;
  category: string;
  imageRef: string;
  maskRef: string | null;
  geometryRef: string | null;
  colours: string[];
  textureRef: string | null;
  patternRef: string | null;
  logoRefs: string[];
  material: string;
  sizeLabel: string | null;
  measurementsCm: ProductAsset["measurementsCm"];
  contentHash: string;
  measurementsComplete: boolean;
};

export function lockProduct(asset: ProductAsset): { ok: true; lock: ProductLock } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!asset.brandId.trim() || !asset.sku.trim()) errors.push("A brand id and an exact sku are required.");
  if (!asset.category.trim()) errors.push("A category is required.");
  if (!asset.imageRef.trim()) errors.push("A stable product image reference is required.");
  if (!/^[a-f0-9]{64}$/.test(asset.contentHash)) errors.push("The product assets need a sha256 content hash.");
  if (errors.length) return { ok: false, errors };
  const measurements = asset.measurementsCm;
  const measurementsComplete = ["chest", "length", "shoulder"].every((key) => {
    const value = measurements[key as keyof typeof measurements];
    return typeof value === "number" && value > 0;
  });
  return {
    ok: true,
    lock: {
      lockId: `${asset.brandId}:${asset.sku}:${asset.contentHash}`,
      brandId: asset.brandId,
      sku: asset.sku,
      category: asset.category,
      imageRef: asset.imageRef,
      maskRef: asset.maskRef,
      geometryRef: asset.geometryRef,
      colours: [...asset.colours],
      textureRef: asset.textureRef,
      patternRef: asset.patternRef,
      logoRefs: [...asset.logoRefs],
      material: asset.material,
      sizeLabel: asset.sizeLabel,
      measurementsCm: { ...measurements },
      contentHash: asset.contentHash,
      measurementsComplete,
    },
  };
}

export function sameGarment(a: ProductLock, b: ProductLock): boolean {
  return a.lockId === b.lockId;
}
