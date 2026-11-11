import { createFileRoute } from "@tanstack/react-router";
import { AnnotationStudio } from "@/components/studio/AnnotationStudio";
import { Nav } from "@/components/site/Nav";

export const Route = createFileRoute("/annotate")({ component: AnnotatePage });

function AnnotatePage() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <AnnotationStudio />
    </main>
  );
}
