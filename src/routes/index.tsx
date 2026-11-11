import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/portfolio/dashboard";
import { PortfolioNavigation } from "@/components/portfolio/navigation";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Équilibre — Portefeuille ETF PEA et achats en parts entières" },
    { name: "description", content: "Suivez vos ETF PEA avec des cours EUR datés, comparez vos pondérations et ajustez vos propositions d’achat sans vente, en parts entières." },
    { property: "og:title", content: "Équilibre — Mon portefeuille ETF PEA" },
    { property: "og:description", content: "Cours Euronext différés en EUR, deux modes d’investissement sans vente, scores d’équilibre et sauvegardes locales, avec saisie manuelle de secours." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <><PortfolioNavigation /><Dashboard /></>,
});
