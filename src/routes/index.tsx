import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  computeExactTarget,
  computeRebalance,
  eur,
  pct,
  pp,
  type Category,
  type RebalanceResult,
} from "@/lib/rebalance";
import { formatDate, useSimulations, type Simulation } from "@/lib/simulations";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Équilibre — Rééquilibrage de portefeuille par injection" },
      {
        name: "description",
        content:
          "Calculez la répartition optimale d'une injection de capital entre vos catégories de placement, sans aucune vente, et visualisez les écarts avant/après.",
      },
      { property: "og:title", content: "Équilibre — Rééquilibrage de portefeuille" },
      {
        property: "og:description",
        content:
          "Répartition optimale d'un budget d'injection, injection minimale pour atteindre vos poids cibles, comparatif avant/après.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

let seq = 0;
const uid = () => `cat-${Date.now()}-${seq++}`;

const initial: Category[] = [
  { id: "c1", name: "Actions US (Growth)", value: 45200, target: 40 },
  { id: "c2", name: "Obligations Euro", value: 32800, target: 35 },
  { id: "c3", name: "Marchés Émergents", value: 12500, target: 25 },
];

function Index() {
  const [categories, setCategories] = useState<Category[]>(initial);
  const [budgetInput, setBudgetInput] = useState("15000");
  const [mode, setMode] = useState<"target" | "budget">("budget");

  const budget = Number(budgetInput.replace(/\s/g, "").replace(",", ".")) || 0;
  const result = useMemo(
    () => (mode === "target" ? computeExactTarget(categories) : computeRebalance(categories, budget)),
    [categories, budget, mode],
  );

  const update = (id: string, patch: Partial<Category>) =>
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const remove = (id: string) => setCategories((cs) => cs.filter((c) => c.id !== id));

  const add = () =>
    setCategories((cs) => [...cs, { id: uid(), name: "Nouvelle catégorie", value: 0, target: 0 }]);

  const maxScale = Math.max(
    100,
    ...result.lines.map((l) => Math.max(l.currentWeight, l.finalWeight)),
  );

  const { simulations, save, rename, remove: removeSim } = useSimulations();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [simName, setSimName] = useState("Simulation 1");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const saveCurrent = (asNew: boolean) => {
    const entry = save({
      ...(asNew || !currentId ? {} : { id: currentId }),
      name: simName,
      categories,
      budget: budgetInput,
    });
    setCurrentId(entry.id);
    setSimName(entry.name);
    flash(asNew || !currentId ? "Simulation enregistrée" : "Simulation mise à jour");
  };

  const load = (sim: Simulation) => {
    setCategories(sim.categories);
    setBudgetInput(sim.budget);
    setCurrentId(sim.id);
    setSimName(sim.name);
    flash(`« ${sim.name} » chargée`);
  };

  const startNew = () => {
    setCategories([{ id: uid(), name: "Nouvelle catégorie", value: 0, target: 100 }]);
    setBudgetInput("0");
    setCurrentId(null);
    setSimName(`Simulation ${simulations.length + 1}`);
    flash("Nouvelle simulation");
  };


  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <nav className="sticky top-0 z-50 border-b border-border bg-surface/70 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-5 items-center justify-center rounded-sm bg-primary">
              <div className="h-px w-2.5 bg-primary-foreground" />
            </div>
            <span className="text-sm font-medium tracking-tight">ÉQUILIBRE.</span>
          </div>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <span className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground sm:block">
            Instrument de gestion
          </span>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="grid grid-cols-12 items-start gap-8 lg:gap-10">
          <div className="col-span-12 space-y-8 lg:col-span-7">
            <header className="space-y-2">
              <h1 className="text-balance text-2xl font-semibold tracking-tight">
                Rééquilibrage de portefeuille
              </h1>
              <p className="max-w-[56ch] text-pretty text-muted-foreground">
                Ajustez vos catégories et fixez vos objectifs. Le calcul répartit l'injection de
                façon optimale pour minimiser les écarts, sans aucune vente d'actifs.
              </p>
            </header>

            <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted/60">
                      <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        Catégorie
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        Valeur (€)
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        Cible (%)
                      </th>
                      <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        Actuel
                      </th>
                      <th className="w-10 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3">
                          <input
                            aria-label="Nom de la catégorie"
                            value={line.name}
                            onChange={(e) => update(line.id, { name: e.target.value })}
                            className="w-full min-w-32 border-none bg-transparent p-0 text-sm font-medium outline-none"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            aria-label="Valeur actuelle"
                            type="number"
                            min={0}
                            value={line.value}
                            onChange={(e) =>
                              update(line.id, { value: Math.max(0, Number(e.target.value) || 0) })
                            }
                            className="w-24 border-none bg-transparent p-0 text-right font-mono text-sm outline-none"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <input
                              aria-label="Poids cible"
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
                              value={line.target}
                              onChange={(e) =>
                                update(line.id, {
                                  target: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="w-16 rounded bg-surface-muted px-1.5 py-1 text-right font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                          {pct(line.currentWeight)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            aria-label={`Supprimer ${line.name}`}
                            onClick={() => remove(line.id)}
                            className="text-border transition-colors hover:text-destructive"
                          >
                            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {result.lines.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          Aucune catégorie. Ajoutez-en une pour commencer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-muted/40 p-4">
                <button
                  onClick={add}
                  className="-ml-2 flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-muted"
                >
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Ajouter une ligne
                </button>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">Total des cibles</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-sm font-medium ${
                        result.targetsValid ? "text-success" : "text-destructive"
                      }`}
                    >
                      {result.targetSum.toFixed(1)} %
                    </span>
                    {result.targetsValid ? (
                      <svg className="size-4 text-success" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <span className="font-mono text-[11px] text-destructive">
                        ({(100 - result.targetSum >= 0 ? "manque " : "excès ") +
                          Math.abs(100 - result.targetSum).toFixed(1)}{" "}
                        pp)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start gap-6 rounded-xl bg-primary p-6 text-primary-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="w-full space-y-1 sm:w-auto">
                <label
                  htmlFor="budget"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary-foreground/60"
                >
                  Budget d'injection
                </label>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-light text-primary-foreground/50">€</span>
                  <input
                    id="budget"
                    inputMode="decimal"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    placeholder="0"
                    className="w-full border-none bg-transparent p-0 font-mono text-3xl font-medium outline-none placeholder:text-primary-foreground/25 sm:w-48"
                  />
                </div>
              </div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-primary-foreground/50">
                Calcul en temps réel · aucune vente
              </div>
            </div>
          </div>

          <aside className="col-span-12 space-y-6 lg:sticky lg:top-24 lg:col-span-5">
            <div className="space-y-6 rounded-xl bg-surface p-6 ring-1 ring-border">
              <div className="border-b border-border pb-4">
                <h2 className="text-sm font-semibold">Synthèse du rééquilibrage</h2>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Valeur initiale
                  </span>
                  <p className="font-mono text-lg">{eur(result.total)}</p>
                </div>
                <div className="space-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Valeur finale
                  </span>
                  <p className="font-mono text-lg text-success">{eur(result.finalTotal)}</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-3 rounded-sm bg-border" />Actuel
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-3 rounded-sm bg-accent" />Après injection
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-3 rounded-sm bg-foreground/70" />Cible
                  </span>
                </div>

                {result.lines.map((line) => (
                  <div key={line.id} className="space-y-2">
                    <div className="flex flex-wrap items-end justify-between gap-1 text-xs">
                      <span className="font-medium">{line.name}</span>
                      <span className="text-muted-foreground">
                        {pct(line.currentWeight)} →{" "}
                        <span className="text-foreground">{pct(line.finalWeight)}</span> →{" "}
                        <span className="font-mono">{pct(line.target)}</span>
                      </span>
                    </div>
                    <div className="space-y-1">
                      {[
                        { label: "Actuel", w: line.currentWeight, cls: "bg-border" },
                        { label: "Après", w: line.finalWeight, cls: "bg-accent" },
                        { label: "Cible", w: line.target, cls: "bg-foreground/70" },
                      ].map((bar) => (
                        <div key={bar.label} className="flex items-center gap-2">
                          <span className="w-12 shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                            {bar.label}
                          </span>
                          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
                            <div
                              className={`h-full rounded-full ${bar.cls} transition-all duration-500`}
                              style={{ width: `${Math.min(100, (bar.w / maxScale) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                      <span>Injecter : {eur(line.injected)}</span>
                      <span
                        className={
                          line.impossible
                            ? "text-destructive"
                            : Math.abs(line.gapToTargetPp) < 0.05
                              ? "text-success"
                              : ""
                        }
                      >
                        {line.impossible
                          ? "Vente requise (cible 0 %)"
                          : `Écart restant ${pp(line.gapToTargetPp)}`}
                      </span>
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between border-t border-border pt-4 text-xs">
                  <span className="text-muted-foreground">Écart maximal du portefeuille</span>
                  <span
                    className={`font-mono text-sm ${
                      result.maxGapPp < 0.05 ? "text-success" : "text-foreground"
                    }`}
                  >
                    {result.maxGapPp.toFixed(2)} pp
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-dashed border-border bg-surface-muted/50 p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted">
                  <svg
                    className="size-4 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </div>
                <h3 className="text-sm font-medium">Alignement parfait</h3>
              </div>
              <p className="text-pretty text-xs text-muted-foreground">
                Pour atteindre exactement vos poids cibles sans aucune vente, l'injection minimale
                requise est :
              </p>
              <div className="font-mono text-2xl tracking-tight">{eur(result.minInjection)}</div>
              <button
                onClick={() => setBudgetInput(String(Math.ceil(result.minInjection)))}
                disabled={!Number.isFinite(result.minInjection)}
                className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                Appliquer ce budget →
              </button>
            </div>

            <div className="space-y-4 rounded-xl bg-surface p-6 ring-1 ring-border">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <h2 className="text-sm font-semibold">Simulations sauvegardées</h2>
                <button
                  onClick={startNew}
                  className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  + Nouvelle
                </button>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="sim-name"
                  className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                >
                  Nom de la simulation en cours
                </label>
                <input
                  id="sim-name"
                  value={simName}
                  maxLength={80}
                  onChange={(e) => setSimName(e.target.value)}
                  className="w-full rounded bg-surface-muted px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => saveCurrent(false)}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {currentId ? "Mettre à jour" : "Sauvegarder"}
                  </button>
                  {currentId && (
                    <button
                      onClick={() => saveCurrent(true)}
                      className="rounded bg-surface-muted px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border"
                    >
                      Sauvegarder comme nouvelle
                    </button>
                  )}
                </div>
                {status && (
                  <p role="status" className="font-mono text-[11px] text-success">
                    {status}
                  </p>
                )}
              </div>

              <ul className="divide-y divide-border border-t border-border">
                {simulations.length === 0 && (
                  <li className="py-4 text-xs text-muted-foreground">
                    Aucune simulation sauvegardée pour l'instant.
                  </li>
                )}
                {simulations.map((sim) => (
                  <li key={sim.id} className="flex items-center gap-2 py-3">
                    {renamingId === sim.id ? (
                      <>
                        <input
                          aria-label="Nouveau nom"
                          autoFocus
                          value={renameValue}
                          maxLength={80}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              rename(sim.id, renameValue);
                              if (currentId === sim.id) setSimName(renameValue.trim() || sim.name);
                              setRenamingId(null);
                            }
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="min-w-0 flex-1 rounded bg-surface-muted px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          onClick={() => {
                            rename(sim.id, renameValue);
                            if (currentId === sim.id) setSimName(renameValue.trim() || sim.name);
                            setRenamingId(null);
                          }}
                          className="font-mono text-[11px] uppercase text-success"
                        >
                          OK
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => load(sim)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span
                            className={`block truncate text-sm ${
                              currentId === sim.id ? "font-semibold" : "font-medium"
                            }`}
                          >
                            {sim.name}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {formatDate(sim.savedAt)} · {sim.categories.length} cat.
                          </span>
                        </button>
                        <button
                          aria-label={`Renommer ${sim.name}`}
                          onClick={() => {
                            setRenamingId(sim.id);
                            setRenameValue(sim.name);
                          }}
                          className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Renommer
                        </button>
                        <button
                          aria-label={`Supprimer ${sim.name}`}
                          onClick={() => {
                            removeSim(sim.id);
                            if (currentId === sim.id) setCurrentId(null);
                          }}
                          className="text-border transition-colors hover:text-destructive"
                        >
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </main>

      <footer className="mx-auto max-w-7xl border-t border-border px-4 py-10 sm:px-6">
        <p className="max-w-[52ch] font-mono text-[11px] uppercase leading-relaxed tracking-wide text-muted-foreground">
          Les calculs sont purement mathématiques et ne constituent pas un conseil en
          investissement.
        </p>
      </footer>
    </div>
  );
}
