import { createFileRoute } from "@tanstack/react-router";
import { MerchantStudio } from "@/components/studio/MerchantStudio";

export const Route = createFileRoute("/wardrobe")({
  component: () => <MerchantStudio tryHref={(id) => `/mirror?product=${encodeURIComponent(id)}`} />,
});
