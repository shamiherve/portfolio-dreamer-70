import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ChartNoAxesCombined, SlidersHorizontal, FlaskConical } from "lucide-react";

export function PortfolioNavigation() {
  return <nav className="border-b border-border bg-surface text-foreground"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
    <Link to="/" className="font-semibold">ÉQUILIBRE.</Link>
    <div className="flex flex-wrap gap-1">
      <Button asChild variant="ghost" size="sm"><Link to="/" activeProps={{ className: "bg-secondary" }} activeOptions={{ exact: true }}><ChartNoAxesCombined />Portefeuille</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/targets" activeProps={{ className: "bg-secondary" }}><SlidersHorizontal />Pondérations cibles</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/simulations" activeProps={{ className: "bg-secondary" }}><FlaskConical />Simulations</Link></Button>
    </div>
  </div></nav>;
}