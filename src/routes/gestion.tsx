import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { FinancialManager } from "@/components/wealth/financial-manager";

export const Route = createFileRoute("/gestion")({
  head: () => ({ meta: [
    { title: "Équilibre — Gérer mes comptes et instruments" },
    { name: "description", content: "Gestion locale des comptes financiers, instruments et valorisations datées, avec sauvegarde et protection des allocations existantes." },
    { property: "og:title", content: "Équilibre — Gérer mes comptes et instruments" },
    { property: "og:description", content: "Comptes, supports financiers et historique des valorisations manuelles, sans modifier les objectifs du portefeuille." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <><PortfolioNavigation /><FinancialManager /></>,
});