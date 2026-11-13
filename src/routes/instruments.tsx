import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { InstrumentsControl } from "@/components/wealth/instruments-control";

const d = "Vérifiez ISIN, ticker, place de cotation et devise de chaque position, et suivez l’état des cours automatiques gratuits.";
export const Route = createFileRoute("/instruments")({
  head: () => ({ meta: [
    { title: "Équilibre — Contrôle des instruments" }, { name: "description", content: d },
    { property: "og:title", content: "Équilibre — Contrôle des instruments" }, { property: "og:description", content: d },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <><PortfolioNavigation /><InstrumentsControl /></>,
});
