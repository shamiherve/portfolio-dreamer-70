import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { AllocationSettings } from "@/components/wealth/allocation-settings";

export const Route = createFileRoute("/allocation")({
  head: () => ({ meta: [
    { title: "Équilibre — Allocation cible" }, { name: "description", content: "Définissez et validez vos cibles par compte et par classe d’actifs." },
    { property: "og:title", content: "Équilibre — Allocation cible" }, { property: "og:description", content: "Définissez et validez vos cibles par compte et par classe d’actifs." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <><PortfolioNavigation /><AllocationSettings /></>,
});
