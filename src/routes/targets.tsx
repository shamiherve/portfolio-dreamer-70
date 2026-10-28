import { createFileRoute } from "@tanstack/react-router";
import { PortfolioNavigation } from "@/components/portfolio/navigation";
import { TargetEditor } from "@/components/portfolio/target-editor";
import { usePortfolio } from "@/lib/use-portfolio";

export const Route = createFileRoute("/targets")({
  head: () => ({ meta: [
    { title: "Équilibre — Pondérations cibles PEA et historique" },
    { name: "description", content: "Validez des pondérations datées et sourcées pour votre portefeuille ETF PEA, approximation du MSCI ACWI." },
    { property: "og:title", content: "Équilibre — Pondérations cibles PEA" },
    { property: "og:description", content: "Comparez et validez vos pondérations cibles et conservez leur historique local." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }), component: Targets,
});
function Targets() {
  const { portfolio, hydrated, error, commit } = usePortfolio();
  return <><PortfolioNavigation /><main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}{hydrated ? <TargetEditor portfolio={portfolio} commit={commit} /> : <p>Chargement des données locales…</p>}</main></>;
}