import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { PositionsManager } from "@/components/wealth/positions-manager";

export const Route = createFileRoute("/positions")({
  head: () => ({ meta: [
    { title: "Équilibre — Positions individuelles" }, { name: "description", content: "Gérez actions, or et fonds euros sur tous vos comptes, avec les ETF repris automatiquement." },
    { property: "og:title", content: "Équilibre — Positions individuelles" }, { property: "og:description", content: "Gérez actions, or et fonds euros sur tous vos comptes, avec les ETF repris automatiquement." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <><PortfolioNavigation /><PositionsManager /></>,
});
