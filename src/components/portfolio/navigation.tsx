import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ChartNoAxesCombined, SlidersHorizontal, FlaskConical, LayoutDashboard, List, Target, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

export function PortfolioNavigation() {
  return <nav className="border-b border-border bg-surface text-foreground"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
    <Link to="/patrimoine" className="font-semibold">ÉQUILIBRE.</Link>
    <div className="flex flex-wrap items-center gap-1">
      <Button asChild variant="ghost" size="sm"><Link to="/patrimoine" activeProps={{ className: "bg-secondary" }}><LayoutDashboard />Dashboard Patrimonial</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/" activeProps={{ className: "bg-secondary" }} activeOptions={{ exact: true }}><ChartNoAxesCombined />Portefeuille ETF</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/positions" activeProps={{ className: "bg-secondary" }}><List />Positions individuelles</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/instruments" activeProps={{ className: "bg-secondary" }}><ShieldCheck />Contrôle des instruments</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/allocation" activeProps={{ className: "bg-secondary" }}><Target />Allocation cible</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/targets" activeProps={{ className: "bg-secondary" }}><SlidersHorizontal />Pondérations ETF</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link to="/simulations" activeProps={{ className: "bg-secondary" }}><FlaskConical />Simulations</Link></Button>
       <ThemeToggle />
    </div>
  </div></nav>;
}