import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { SimulationWorkbench } from "@/components/portfolio/simulation-workbench";

export const Route = createFileRoute("/simulations")({
  head: () => ({ meta: [
    { title: "Équilibre — Simulations de rééquilibrage sans vente" },
    { name: "description", content: "Retrouvez vos simulations sauvegardées et calculez la répartition théorique de vos injections sans vente." },
    { property: "og:title", content: "Équilibre — Simulations sans vente" },
    { property: "og:description", content: "Injection minimale, budget disponible et sauvegardes locales de vos simulations de portefeuille." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }), component: () => <><PortfolioNavigation /><SimulationWorkbench /></>,
});