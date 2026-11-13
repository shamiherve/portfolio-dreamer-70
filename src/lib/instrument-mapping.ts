import { normExchange, type Candidate, type IdentityInput } from "./market";

/** Security identity and listing identity are separate; never send a bare ISIN to chart. */
export const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
export const STELLANTIS_ISIN = "NL00150001Q9";
const stellantis: Candidate[] = [
  { symbol: "STLAP.PA", exchange: "PAR", name: "Stellantis N.V." },
  { symbol: "STLAM.MI", exchange: "MIL", name: "Stellantis N.V." },
  { symbol: "STLA", exchange: "NYQ", name: "Stellantis N.V." },
];
const suffixes: Record<string, string> = { PAR: ".PA", AMS: ".AS", BRU: ".BR", LIS: ".LS", MIL: ".MI", OSL: ".OL", GER: ".DE", FRA: ".F", LSE: ".L", EBS: ".SW", STU: ".SG", NYQ: "", NMS: "", ASE: "", PCX: "" };

export function knownListings(isin: string): Candidate[] {
  return isin === STELLANTIS_ISIN ? stellantis.map(c => ({ ...c })) : [];
}
export function holdingExchange(input: IdentityInput): string | null {
  if (input.exchange.trim()) return normExchange(input.exchange);
  // Infer only from a security-specific exchange ticker, never from a workaround provider symbol.
  const known = knownListings(input.isin).filter(c => c.symbol.split(".")[0] === input.ticker.toUpperCase());
  return known.length === 1 ? normExchange(known[0]?.exchange) : null;
}
export function tickerSymbol(input: IdentityInput): string | null {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker || ISIN_PATTERN.test(ticker) || ticker.includes(".")) return null;
  const exchange = holdingExchange(input);
  const suffix = exchange ? suffixes[exchange] : undefined;
  return suffix === undefined ? null : `${ticker}${suffix}`;
}
export function listingCandidates(input: IdentityInput, searched: Candidate[]): Candidate[] {
  const known = knownListings(input.isin);
  return [...known, ...searched.filter(c => !known.some(k => k.symbol === c.symbol) && !ISIN_PATTERN.test(c.symbol))];
}
/** Explicit alternatives are limited to the verified ordinary EUR share, never the USD listing. */
export function fallbackListings(input: IdentityInput): Candidate[] {
  return input.isin === STELLANTIS_ISIN && holdingExchange(input) === "PAR" && input.currency === "EUR"
    ? stellantis.filter(c => c.exchange === "MIL") : [];
}