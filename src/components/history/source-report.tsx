import { auditSourceSheet } from "@/lib/history-source-audit";
import { operationLabels, type OperationType } from "@/lib/ledger";
import type { ImportSheet, ImportOptions } from "@/lib/history-import";

const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
export function SourceReport({ sheets, options = [] }: { sheets: ImportSheet[]; options?: ImportOptions[] }) {
  if (!sheets.length) return null;
  return <section className="space-y-5 border-y border-border py-5" aria-label="Analyse du fichier source"><h3 className="font-semibold">Aperçu du fichier · toutes les feuilles</h3>
    <p className="text-xs text-muted-foreground">Totaux du fichier complet, y compris les lignes incomplètes et non importables. Ils ne représentent pas un grand livre enregistré ni un solde bancaire vérifié.</p>
    {sheets.map((sheet, i) => {
      const s = auditSourceSheet(sheet);
      const depositsConfirmed = options[i]?.inboundExternalConfirmed === true;
      return <div key={i} className="space-y-2"><h4 className="font-medium">{s.name} · {s.rows} mouvements{s.blank ? ` · ${s.blank} ligne vide` : ""}</h4><p className="text-sm">{Object.entries(s.types).map(([type, n]) => `${n} ${operationLabels[(type === "transfer_in" && depositsConfirmed ? "deposit" : type) as OperationType] ?? type}`).join(" · ")}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span>Entrées / versements : {money(s.deposit)}</span><span>Achats : {money(s.buy)}</span><span>Dividendes : {money(s.dividend)}</span><span>Frais : {money(s.fees)}</span><span>Taxes : {money(s.taxes)}</span><span className={s.balance < 0 ? "text-warning" : "text-foreground"}>Solde arithmétique : {money(s.balance)}</span></div>
        <p className="text-xs text-muted-foreground">{s.duplicates.length} groupes de lignes identiques · {s.fractionalBuys} achats fractionnés · {s.earlierValueDate} dates de valeur antérieures aux dates d’opération, conservées sans inversion.</p>
        {s.inboundUnclassified && <p className={`text-xs ${depositsConfirmed ? "text-success" : "text-warning"}`}>{depositsConfirmed ? "Virements entrants : apports personnels extérieurs confirmés." : "Les virements entrants sont regroupés pour le rapprochement, mais leur qualification comme apports extérieurs reste à confirmer."}</p>}
        <ul className="grid gap-1 text-xs text-warning sm:grid-cols-2">{[...s.missing, ...s.warnings].map((m, j) => <li key={j}>{m}</li>)}</ul>
        {s.duplicates.map((rows, j) => <p key={j} className="text-xs text-warning">Doublons source possibles : lignes {rows.join(", ")}</p>)}
      </div>;
    })}
  </section>;
}