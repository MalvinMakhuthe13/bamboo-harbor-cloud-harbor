import {
  assertModelCanRun,
  TryOnError,
  type ModelDescriptor,
  type TryOnModelAdapter,
  type TryOnRequest,
} from "./contracts.ts";

/**
 * Explicit registry for installed inference adapters.
 *
 * An architecture card, model candidate, or test fixture is not an adapter.
 * The registry starts empty and only accepts an adapter whose runtime and
 * weights are verified and whose commercial licence evidence is recorded.
 */
export class TryOnModelRegistry {
  private readonly adapters = new Map<string, TryOnModelAdapter>();

  register(adapter: TryOnModelAdapter): void {
    const descriptor = adapter.descriptor;
    if (!descriptor.id.trim() || !descriptor.version.trim()) {
      throw new TryOnError("MODEL_NOT_REGISTERED", "A model id and version are required.");
    }
    if (this.adapters.has(descriptor.id)) {
      throw new TryOnError("MODEL_NOT_REGISTERED", `Model ${descriptor.id} is already registered.`);
    }
    if (!descriptor.weightsPresent || descriptor.availability !== "available") {
      throw new TryOnError(
        "MODEL_NOT_AVAILABLE",
        `Refusing to register ${descriptor.id}: weights or runtime are not available.`,
      );
    }
    if (!descriptor.runtimeVerified) {
      throw new TryOnError("RUNTIME_MISSING", `Refusing to register ${descriptor.id}: runtime is unverified.`);
    }
    if (descriptor.licence.commercialStatus !== "verified-commercial") {
      throw new TryOnError(
        "LICENCE_NOT_CLEARED",
        `Refusing to register ${descriptor.id}: commercial rights are not verified.`,
      );
    }
    this.adapters.set(descriptor.id, adapter);
  }

  get(id: string): TryOnModelAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): ModelDescriptor[] {
    return [...this.adapters.values()].map((adapter) => adapter.descriptor);
  }

  async generate(id: string, request: TryOnRequest) {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new TryOnError("MODEL_NOT_REGISTERED", `No approved model adapter is registered as ${id}.`);
    }
    assertModelCanRun(adapter.descriptor, request);
    return adapter.generate(request);
  }
}

/** No generative model is installed or approved in the current release candidate. */
export const isibukoModelRegistry = new TryOnModelRegistry();
