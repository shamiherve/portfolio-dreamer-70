import { cashSummary, eventKey, splitCheck, type Ledger, type LedgerEvent } from "./ledger";
import { EXPECTED_CASH, isConsolidatedNormalized } from "./history-consolidated";
import type { finalHistoryReview } from "./history-final-review";
import type { ImportSheet } from "./history-import";

export type Check = { label: string; ok: boolean; detail: string };
const CAC = "FR0007052782"; const EMB = "US29082A1079";
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** Pre-write gate for the consolidated workbook: every check must pass, otherwise nothing is written. */
export function planConsolidatedImport(review: ReturnType<typeof finalHistoryReview>, sheets: ImportSheet[], ledger: Ledger, usualBrowser: boolean) {
  const rows = review.rows;
  const incoming: LedgerEvent[] = rows.filter(r => r.category === "ready" && r.status === "valid").flatMap(r => r.event ? [r.event] : []);
  const present = rows.filter(r => r.status === "duplicate" || r.status === "existing-etf");
  const rejected = rows.filter(r => r.category !== "ready" && r.status !== "duplicate" && r.status !== "existing-etf");
  const all = [...ledger.events, ...incoming];
  const count = (f: (e: LedgerEvent) => boolean) => all.filter(f).length;
  const informational = sheets.reduce((n, s) => n + (s.informational?.length ?? 0), 0);
  const peaBuysCommon = rows.filter(r => r.accountId === "pea" && (r.event ?? r.facts).type === "buy" && (r.event ?? r.facts).isin !== CAC);
  // ETF trades already saved outside the ledger still move cash: count their file row once (never stored twice).
  const etf = rows.filter(r => r.status === "existing-etf").flatMap(r => r.event ? [r.event] : []);
  const cash = (a: "pea" | "cto") => Math.round((cashSummary([...all, ...etf], a).find(c => c.currency === "EUR")?.balance ?? 0) * 100) / 100;
  const keys = all.map(eventKey);
  const emb = review.quantities.find(q => q.accountId === "cto" && q.isin === EMB)?.reconstructedQuantity ?? null;
  const cac = review.quantities.find(q => q.accountId === "pea" && q.isin === CAC)?.reconstructedQuantity ?? null;
  const mismatched = review.references.filter(r => !r.matches);
  const checks: Check[] = [
    { label: "Navigateur habituel confirmé", ok: usualBrowser, detail: usualBrowser ? "Confirmé pour cette lecture." : "Cochez la case après avoir relu les données locales." },
    { label: "Fichier consolidé reconnu", ok: sheets.length === 2 && sheets.every(isConsolidatedNormalized), detail: `${sheets.length} feuille(s).` },
    { label: "Aucune ligne rejetée ou à confirmer", ok: rejected.length === 0, detail: rejected.length ? rejected.map(r => `${r.accountId.toUpperCase()} l.${r.row} : ${r.issues[0] ?? "à vérifier"}`).join(" · ") : "0 ligne." },
    { label: "21 achats PEA communs comptés une seule fois", ok: peaBuysCommon.length === 21 && peaBuysCommon.every(r => r.status === "duplicate" || r.status === "existing-etf" || r.category === "ready"), detail: `${peaBuysCommon.filter(r => r.status !== "valid").length} déjà présents, ${peaBuysCommon.filter(r => r.status === "valid").length} à importer.` },
    { label: "CAC 40 : un achat et une vente, une seule fois", ok: count(e => e.isin === CAC && e.type === "buy") === 1 && count(e => e.isin === CAC && e.type === "sell") === 1 && cac === 0, detail: `Quantité finale ${cac ?? "?"}.` },
    { label: "Split Embraer unique → 4 ADR", ok: count(e => e.isin === EMB && e.type === "split") === 1 && splitCheck(all).issues.length === 0 && emb === 4, detail: `Quantité reconstituée ${emb ?? "?"}.` },
    { label: "12 lignes informatives sans mouvement", ok: informational === 12, detail: `${informational} ligne(s) exclues des espèces et quantités.` },
    { label: "Aucun doublon dans le grand livre résultant", ok: new Set(keys).size === keys.length, detail: `${all.length} événements.` },
    { label: `Solde PEA ${EXPECTED_CASH.pea} €`, ok: near(cash("pea"), EXPECTED_CASH.pea), detail: `Calculé : ${cash("pea")} €.` },
    { label: `Solde CTO ${EXPECTED_CASH.cto} €`, ok: near(cash("cto"), EXPECTED_CASH.cto), detail: `Calculé : ${cash("cto")} €.` },
    { label: "Quantités de référence concordantes", ok: mismatched.length === 0, detail: mismatched.length ? mismatched.map(r => `${r.name} : ${r.reconstructedQuantity ?? "?"} / ${r.quantity}`).join(" · ") : "Toutes conformes." },
    { label: "Opérations à importer", ok: incoming.length > 0, detail: `${incoming.length} nouvelle(s).` },
  ];
  return { checks, ok: checks.every(c => c.ok), incoming, present: present.length, informational, rejected: rejected.length, cash: { pea: cash("pea"), cto: cash("cto") } };
}
