/** Isolated brand workspaces. One brand cannot read another's private assets. */

export type BrandProduct = {
  sku: string;
  assetRef: string;
  category: string;
};

export type BrandWorkspace = {
  brandId: string;
  products: BrandProduct[];
  datasetIds: string[];
  modelConfigIds: string[];
};

export class BrandAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandAccessError";
  }
}

export class BrandDirectory {
  private readonly brands = new Map<string, BrandWorkspace>();

  create(brandId: string): BrandWorkspace {
    const id = brandId.trim();
    if (!id) throw new BrandAccessError("A brand id is required.");
    if (this.brands.has(id)) throw new BrandAccessError(`Brand ${id} already exists.`);
    const workspace: BrandWorkspace = { brandId: id, products: [], datasetIds: [], modelConfigIds: [] };
    this.brands.set(id, workspace);
    return workspace;
  }

  addProduct(callerBrandId: string, product: BrandProduct): void {
    const workspace = this.requireOwn(callerBrandId, callerBrandId);
    if (!product.sku.trim() || !product.assetRef.trim()) {
      throw new BrandAccessError("A product needs a sku and a stable asset reference.");
    }
    workspace.products.push({ ...product });
  }

  listProducts(callerBrandId: string, targetBrandId: string): BrandProduct[] {
    const workspace = this.requireOwn(callerBrandId, targetBrandId);
    return workspace.products.map((item) => ({ ...item }));
  }

  private requireOwn(callerBrandId: string, targetBrandId: string): BrandWorkspace {
    if (callerBrandId !== targetBrandId) {
      throw new BrandAccessError("A brand cannot read another brand's catalogue, datasets, or models.");
    }
    const workspace = this.brands.get(targetBrandId);
    if (!workspace) throw new BrandAccessError(`Brand ${targetBrandId} is not onboarded.`);
    return workspace;
  }
}
