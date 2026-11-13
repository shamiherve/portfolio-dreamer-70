import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { WealthDashboard } from "@/components/wealth/wealth-dashboard";

export const Route = createFileRoute("/patrimoine")({
  head: () => ({ meta: [
    { title: "Équilibre — Dashboard Patrimonial" }, { name: "description", content: "Vue globale de votre patrimoine : PEA, CTO et assurance-vie, allocation par compte et par classe d’actifs, écarts et score d’équilibre." },
    { property: "og:title", content: "Équilibre — Dashboard Patrimonial" }, { property: "og:description", content: "Vue globale de votre patrimoine : PEA, CTO et assurance-vie, allocation par compte et par classe d’actifs, écarts et score d’équilibre." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <><PortfolioNavigation /><WealthDashboard /></>,
});
