import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { HistoryWorkbench } from "@/components/history/history-workbench";

const description = "Sauvegardez et restaurez votre patrimoine complet, puis vérifiez vos historiques Fortuneo et Trade Republic avant import local dans un grand livre indépendant.";
export const Route = createFileRoute("/historique")({
  head: () => ({ meta: [
    { title: "Équilibre — Historique PEA & CTO et sauvegardes" }, { name: "description", content: description },
    { property: "og:title", content: "Équilibre — Historique PEA & CTO" }, { property: "og:description", content: description },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <><PortfolioNavigation /><HistoryWorkbench /></>,
});