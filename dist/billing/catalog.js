/**
 * The prepaid catalog: what can be bought (top-up packs) and how much credit each grants. Shared by the server (which
 * grants credit from a verified payment) and the browser (which lists the packs). Amounts are integers in the
 * currency's major unit (yen for JPY); credit is in the same unit.
 */
export function defineCatalog(catalog) {
    const ids = new Set();
    for (const p of catalog.packs) {
        if (ids.has(p.id))
            throw new Error(`Duplicate pack ${p.id}`);
        ids.add(p.id);
        if (!Number.isInteger(p.price) || p.price <= 0)
            throw new Error(`Pack ${p.id}: price must be a positive integer`);
        if (!Number.isInteger(p.credit) || p.credit < p.price)
            throw new Error(`Pack ${p.id}: credit must be an integer ≥ price`);
    }
    return catalog;
}
export function packById(catalog, id) {
    return catalog.packs.find((p) => p.id === id);
}
/** Whole-unit months added to a timestamp (UTC, clamped to the month's last day). */
export function addMonths(at, months) {
    const d = new Date(at);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.getTime();
}
export function balanceLevel(balance, lastTopUp) {
    if (balance <= 0)
        return lastTopUp > 0 ? "empty" : "ok";
    if (lastTopUp <= 0)
        return "ok";
    if (balance <= lastTopUp * 0.1)
        return "critical";
    if (balance <= lastTopUp * 0.3)
        return "low";
    return "ok";
}
//# sourceMappingURL=catalog.js.map