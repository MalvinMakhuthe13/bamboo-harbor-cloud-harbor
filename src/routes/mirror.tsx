import { createFileRoute } from "@tanstack/react-router";
import { MirrorApp } from "@/components/tryon/MirrorApp";

type Search = { product?: string };

export const Route = createFileRoute("/mirror")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    product: typeof search.product === "string" ? search.product : undefined,
  }),
  component: function MirrorRoute() {
    const { product } = Route.useSearch();
    return <MirrorApp initialProductId={product} />;
  },
});
