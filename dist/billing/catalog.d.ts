/**
 * The prepaid catalog: what can be bought (top-up packs) and how much credit each grants. Shared by the server (which
 * grants credit from a verified payment) and the browser (which lists the packs). Amounts are integers in the
 * currency's major unit (yen for JPY); credit is in the same unit.
 */
export type BillingMode = "test_mode" | "live_mode";
export interface Pack {
    /** Stable id stored with each purchase (e.g. "jpy500"). */
    id: string;
    /** What the customer pays, tax included, in `currency`. */
    price: number;
    /** Credit granted to the wallet (price plus any bonus). */
    credit: number;
    /** The provider's one-time product per mode. */
    products: Record<BillingMode, string | undefined>;
}
export interface Catalog {
    currency: string;
    packs: readonly Pack[];
    /** Months until purchased credit expires (counted from the purchase). */
    creditMonths: number;
}
export declare function defineCatalog<const C extends Catalog>(catalog: C): C;
export declare function packById(catalog: Catalog, id: string): Pack | undefined;
/** Whole-unit months added to a timestamp (UTC, clamped to the month's last day). */
export declare function addMonths(at: number, months: number): number;
/** How low a wallet is, relative to its last top-up: reminders go out when it crosses 30 %, 10 % and 0. */
export type BalanceLevel = "ok" | "low" | "critical" | "empty";
export declare function balanceLevel(balance: number, lastTopUp: number): BalanceLevel;
//# sourceMappingURL=catalog.d.ts.map