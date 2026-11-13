import { z } from "zod";
import { initialPortfolio, portfolioSchema, simulationsSchema, validTargets, PORTFOLIO_KEY, SIMULATIONS_KEY, type Portfolio } from "./portfolio";
import { initialWealth, wealthSchema, holdingError, targetIssues, PARENT_GROUPS, ETF_ACCOUNT, ETF_CLASS, WEALTH_KEY, type Wealth } from "./wealth";

export const FULL_BACKUP_FORMAT = "equilibre-full-backup";
export const FULL_BACKUP_VERSION = 1;
export const THEME_STORAGE_KEY = "equilibre.theme.v1";
type FullBackup = {
  format: typeof FULL_BACKUP_FORMAT; version: typeof FULL_BACKUP_VERSION; exportedAt: string;
  portfolio: Portfolio; wealth: Wealth; simulations: z.infer<typeof simulationsSchema>;
  theme: "light" | "dark" | null;
  detachedTransactionPositionIds: string[];
};
const envelope = z.object({
  format: z.literal(FULL_BACKUP_FORMAT), version: z.literal(FULL_BACKUP_VERSION),
  exportedAt: z.string().datetime(), portfolio: portfolioSchema, wealth: wealthSchema,
  simulations: simulationsSchema, theme: z.enum(["light", "dark"]).nullable(),
  detachedTransactionPositionIds: z.array(z.string().min(1)),
});

// Compare with the validated shape, not with a second hand-maintained field whitelist.
// Future fields are refused explicitly, never silently stripped or exported as secrets.
function unknownFields(raw: unknown, checked: unknown, path: string, issues: string[]) {
  if (Array.isArray(raw) && Array.isArray(checked)) {
    raw.forEach((value, i) => unknownFields(value, checked[i], `${path}[${i}]`, issues));
  } else if (raw && checked && typeof raw === "object" && typeof checked === "object") {
    const expected = checked as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(expected, key)) issues.push(`${path}.${key} : champ inconnu, migration explicite nécessaire.`);
      else unknownFields(value, expected[key], `${path}.${key}`, issues);
    }
  }
}
const realDate = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const currency = (value: string) => /^[A-Z]{3}$/.test(value);

export const fullBackupSchema = z.unknown().superRefine((raw, ctx) => {
  const result = envelope.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue(issue);
    return;
  }
  const b = result.data;
  const issues: string[] = [];
  unknownFields(raw, b, "sauvegarde", issues);
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) issues.push(`${label} : identifiants dupliqués.`);
  };
  unique(b.wealth.accounts.map(a => a.id), "Comptes");
  unique(b.wealth.classes.map(c => c.id), "Classes");
  unique(b.wealth.holdings.map(h => h.id), "Positions non-ETF");
  unique(b.wealth.mapping.map(m => `${m.accountId}\u0000${m.classId}`), "Correspondances");
  unique(b.detachedTransactionPositionIds, "Références historiques");
  const accounts = new Set(b.wealth.accounts.map(a => a.id));
  const classes = new Set(b.wealth.classes.map(c => c.id));
  if (b.portfolio.positions.length && (!accounts.has(ETF_ACCOUNT) || !classes.has(ETF_CLASS))) issues.push("Compte PEA ou classe ETF source absent.");
  for (const m of b.wealth.mapping) {
    if (!accounts.has(m.accountId) || !classes.has(m.classId)) issues.push("Correspondance vers un compte ou une classe inconnue.");
  }
  for (const c of b.wealth.classes) {
    const visited = new Set([c.id]);
    let parent = c.parent;
    while (parent) {
      if (visited.has(parent)) { issues.push("Hiérarchie des classes cyclique."); break; }
      visited.add(parent);
      const next = b.wealth.classes.find(x => x.id === parent);
      if (!next) { if (!Object.hasOwn(PARENT_GROUPS, parent)) issues.push("Classe parente inconnue."); break; }
      parent = next.parent;
    }
  }
  issues.push(...targetIssues(b.wealth));
  const weights = b.portfolio.positions.map(p => p.target);
  // An unconfigured ETF portfolio (all targets zero) is a valid existing state.
  if (weights.some(w => w !== 0) && !validTargets(weights)) issues.push("Cibles ETF : somme différente de 100 %.");
  for (const p of b.portfolio.positions) {
    if (!Number.isInteger(p.quantity)) issues.push("ETF : quantité non entière.");
    if (p.isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(p.isin)) issues.push("ETF : format ISIN invalide.");
  }
  for (const h of b.wealth.holdings) {
    const error = holdingError(h, b.wealth);
    // Missing valuation is preserved as null, not invented or converted to a price.
    if (error && !(h.kind === "quantity" && h.quantity > 0 && h.price === null && error === "Une quantité détenue nécessite un cours.")) issues.push(`${h.id} : ${error}`);
    if (h.isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(h.isin)) issues.push(`${h.id} : format ISIN invalide.`);
    if (h.priceDate && !realDate(h.priceDate)) issues.push(`${h.id} : date invalide.`);
    const m = h.market;
    if (m) {
      if (!currency(m.original.currency) || (m.verified && (!currency(m.verified.currency) || m.verified.isin !== h.isin))) issues.push(`${h.id} : identité vérifiée incohérente.`);
      for (const q of [m.quote, m.pending]) if (q && (!Number.isFinite(q.price) || !currency(q.currency))) issues.push(`${h.id} : cotation invalide.`);
      if (m.fx && (!Number.isFinite(m.fx.rate) || !realDate(m.fx.date))) issues.push(`${h.id} : taux/date de change invalide.`);
    }
  }
  if (b.wealth.marketMeta?.fxDate && !realDate(b.wealth.marketMeta.fxDate)) issues.push("Date BCE invalide.");
  const positions = new Set(b.portfolio.positions.map(p => p.id));
  const detached = new Set(b.portfolio.transactions.filter(t => !positions.has(t.positionId)).map(t => t.positionId));
  if (detached.size !== b.detachedTransactionPositionIds.length || b.detachedTransactionPositionIds.some(id => !detached.has(id))) issues.push("Références des transactions : positions absentes non déclarées ou déclaration incorrecte.");
  for (const issue of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
}).transform(raw => raw as FullBackup);

/** Parsing is read-only. No restoration or implicit migration is performed. */
export function parseFullBackup(raw: string): FullBackup { return fullBackupSchema.parse(JSON.parse(raw)); }

export function generateFullBackup(input: { portfolio: unknown; wealth: unknown; simulations: unknown; theme: unknown }, exportedAt = new Date().toISOString()) {
  const p = portfolioSchema.parse(input.portfolio);
  const ids = new Set(p.positions.map(pos => pos.id));
  const backup = fullBackupSchema.parse({ ...input, format: FULL_BACKUP_FORMAT, version: FULL_BACKUP_VERSION, exportedAt,
    detachedTransactionPositionIds: [...new Set(p.transactions.filter(t => !ids.has(t.positionId)).map(t => t.positionId))] });
  const content = JSON.stringify(backup, null, 2);
  // Confirm the actual serialized file, including all optional metadata, remains valid.
  parseFullBackup(content);
  const warnings: string[] = [];
  if (backup.detachedTransactionPositionIds.length) warnings.push("Transactions de positions ETF supprimées conservées avec leurs références historiques déclarées.");
  if (backup.portfolio.positions.some(p => p.quantity > 0 && p.price === null) || backup.wealth.holdings.some(h => h.kind === "quantity" && h.quantity > 0 && h.price === null)) warnings.push("Des positions sans cours sont conservées sans valorisation inventée.");
  return { content, backup, warnings, filename: `equilibre-patrimoine-complet-v1-${exportedAt.replace(/[:.]/g, "-")}.json` };
}

/** Reads only the four app-owned keys, synchronously at click time. Never writes storage. */
export function readFullBackup(storage: Pick<Storage, "getItem">, exportedAt = new Date().toISOString()) {
  const warnings: string[] = [];
  const read = (key: string, fallback: unknown, label: string) => {
    const raw = storage.getItem(key);
    if (raw === null) { warnings.push(`${label} : aucune donnée enregistrée ; état initial inclus.`); return fallback; }
    try { return JSON.parse(raw) as unknown; } catch { throw new Error(`${label} : données illisibles. Export complet refusé, aucune donnée modifiée.`); }
  };
  const theme = storage.getItem(THEME_STORAGE_KEY);
  const result = generateFullBackup({ portfolio: read(PORTFOLIO_KEY, initialPortfolio(), "ETF"), wealth: read(WEALTH_KEY, initialWealth(), "Patrimoine"), simulations: read(SIMULATIONS_KEY, [], "Simulations"), theme }, exportedAt);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}