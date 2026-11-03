/**
 * Prepaid billing on Convex: one wallet per owner (an organization id, or any string the app bills), an append-only
 * ledger, credit lots that expire, and Dodo Payments as the merchant of record.
 *
 * The app spreads `billingTables` into its schema and calls these functions from its own (authorized) queries,
 * mutations and actions, as with `authSignalTables`. Money and credit are integers in the catalog currency's major
 * unit. Every grant and charge carries an idempotency key, so retried webhooks and retried tasks apply once.
 */
import { defineSchema, defineTable, } from "convex/server";
import { v } from "convex/values";
import { addMonths, balanceLevel, packById, } from "../billing/catalog.js";
export * from "../billing/catalog.js";
const entryKind = v.union(v.literal("grant"), v.literal("charge"), v.literal("refund"), v.literal("expire"));
export const billingTables = {
    /** One row per owner: the balance (negative only while storage runs into debt) and the last top-up's credit. */
    billingWallets: defineTable({
        owner: v.string(),
        balance: v.number(),
        lastTopUp: v.number(),
        updatedAt: v.number(),
    }).index("owner", ["owner"]),
    /** Credit as granted, used oldest-expiry first; `remaining` sums to max(balance, 0). */
    billingLots: defineTable({
        owner: v.string(),
        key: v.string(),
        amount: v.number(),
        remaining: v.number(),
        expiresAt: v.number(),
    })
        .index("owner_expiresAt", ["owner", "expiresAt"])
        .index("expiresAt", ["expiresAt"]),
    /** Append-only: every change to a balance, signed (`amount` < 0 takes credit away). */
    billingLedger: defineTable({
        owner: v.string(),
        kind: entryKind,
        amount: v.number(),
        balance: v.number(),
        key: v.string(),
        reason: v.string(),
        at: v.number(),
    })
        .index("key", ["key"])
        .index("owner_at", ["owner", "at"]),
    /** Payments that granted credit, and how much of their credit was refunded. */
    billingPurchases: defineTable({
        owner: v.string(),
        paymentId: v.string(),
        packId: v.string(),
        credit: v.number(),
        totalAmount: v.number(),
        currency: v.string(),
        refundedCredit: v.number(),
        invoiceUrl: v.optional(v.string()),
        at: v.number(),
    })
        .index("paymentId", ["paymentId"])
        .index("owner_at", ["owner", "at"]),
};
const schema = defineSchema(billingTables);
// The app registers billingTables; narrow only the library-owned table access (as markSignal does).
const reader = (ctx) => ctx.db;
const writer = (ctx) => ctx.db;
export const walletValidator = v.object({
    balance: v.number(),
    lastTopUp: v.number(),
    level: v.union(v.literal("ok"), v.literal("low"), v.literal("critical"), v.literal("empty")),
    /** When the oldest remaining credit expires (null without credit). */
    nextExpiry: v.union(v.null(), v.object({ at: v.number(), amount: v.number() })),
});
export async function wallet(ctx, owner) {
    const db = reader(ctx);
    const w = await db
        .query("billingWallets")
        .withIndex("owner", (q) => q.eq("owner", owner))
        .unique();
    const lot = await db
        .query("billingLots")
        .withIndex("owner_expiresAt", (q) => q.eq("owner", owner))
        .filter((q) => q.gt(q.field("remaining"), 0))
        .first();
    const balance = w?.balance ?? 0;
    const lastTopUp = w?.lastTopUp ?? 0;
    return {
        balance,
        lastTopUp,
        level: balanceLevel(balance, lastTopUp),
        nextExpiry: lot ? { at: lot.expiresAt, amount: lot.remaining } : null,
    };
}
export async function history(ctx, owner, paginationOpts) {
    return reader(ctx)
        .query("billingLedger")
        .withIndex("owner_at", (q) => q.eq("owner", owner))
        .order("desc")
        .paginate(paginationOpts);
}
export async function purchases(ctx, owner, limit = 50) {
    return reader(ctx)
        .query("billingPurchases")
        .withIndex("owner_at", (q) => q.eq("owner", owner))
        .order("desc")
        .take(limit);
}
async function entryByKey(ctx, key) {
    return writer(ctx)
        .query("billingLedger")
        .withIndex("key", (q) => q.eq("key", key))
        .unique();
}
async function walletRow(ctx, owner) {
    const db = writer(ctx);
    const row = await db
        .query("billingWallets")
        .withIndex("owner", (q) => q.eq("owner", owner))
        .unique();
    if (row)
        return row;
    const id = await db.insert("billingWallets", {
        owner,
        balance: 0,
        lastTopUp: 0,
        updatedAt: Date.now(),
    });
    return (await db.get(id));
}
function assertAmount(amount) {
    if (!Number.isInteger(amount) || amount <= 0)
        throw new Error("Billing amounts are positive integers");
}
export async function grant(ctx, args) {
    assertAmount(args.amount);
    const done = await entryByKey(ctx, args.key);
    if (done)
        return { applied: false, balance: done.balance };
    const db = writer(ctx);
    const w = await walletRow(ctx, args.owner);
    // Credit first repays storage debt; only the rest becomes a usable lot.
    const repay = Math.min(args.amount, Math.max(0, -w.balance));
    if (args.amount > repay)
        await db.insert("billingLots", {
            owner: args.owner,
            key: args.key,
            amount: args.amount,
            remaining: args.amount - repay,
            expiresAt: args.expiresAt ?? Number.MAX_SAFE_INTEGER,
        });
    const balance = w.balance + args.amount;
    await db.patch(w._id, {
        balance,
        updatedAt: Date.now(),
        ...(args.topUp && { lastTopUp: args.amount }),
    });
    await db.insert("billingLedger", {
        owner: args.owner,
        kind: "grant",
        amount: args.amount,
        balance,
        key: args.key,
        reason: args.reason,
        at: Date.now(),
    });
    return { applied: true, balance };
}
export async function charge(ctx, args) {
    assertAmount(args.amount);
    const done = await entryByKey(ctx, args.key);
    if (done)
        return { ok: true, applied: false, balance: done.balance };
    const w = await walletRow(ctx, args.owner);
    if (!args.allowDebt && w.balance < args.amount)
        return { ok: false, balance: w.balance, shortBy: args.amount - w.balance };
    const db = writer(ctx);
    let left = args.amount;
    const lots = await db
        .query("billingLots")
        .withIndex("owner_expiresAt", (q) => q.eq("owner", args.owner))
        .filter((q) => q.gt(q.field("remaining"), 0))
        .take(1000);
    for (const lot of lots) {
        if (left === 0)
            break;
        const take = Math.min(left, lot.remaining);
        await db.patch(lot._id, { remaining: lot.remaining - take });
        left -= take;
    }
    const balance = w.balance - args.amount;
    await db.patch(w._id, { balance, updatedAt: Date.now() });
    await db.insert("billingLedger", {
        owner: args.owner,
        kind: args.kind ?? "charge",
        amount: -args.amount,
        balance,
        key: args.key,
        reason: args.reason,
        at: Date.now(),
    });
    return { ok: true, applied: true, balance };
}
/** Expire the remaining credit of lots past their date (run from a cron); returns how many lots it expired. */
export async function expireCredit(ctx, now = Date.now(), limit = 100) {
    const db = writer(ctx);
    const due = await db
        .query("billingLots")
        .withIndex("expiresAt", (q) => q.lte("expiresAt", now))
        .filter((q) => q.gt(q.field("remaining"), 0))
        .take(limit);
    for (const lot of due) {
        const w = await walletRow(ctx, lot.owner);
        const balance = w.balance - lot.remaining;
        await db.patch(lot._id, { remaining: 0 });
        await db.patch(w._id, { balance, updatedAt: Date.now() });
        await db.insert("billingLedger", {
            owner: lot.owner,
            kind: "expire",
            amount: -lot.remaining,
            balance,
            key: `expire:${lot.key}`,
            reason: "Credit expired",
            at: now,
        });
    }
    return due.length;
}
// ---------------------------------------------------------------------------------------------------------------
// Dodo Payments
export const DODO_API = {
    test_mode: "https://test.dodopayments.com",
    live_mode: "https://live.dodopayments.com",
};
export function billingMode(value) {
    if (value === "live_mode" || value === "test_mode")
        return value;
    throw new Error("DODO_PAYMENTS_ENVIRONMENT must be test_mode or live_mode");
}
/** Create a hosted checkout for one pack and return its URL (open it in the same tab; it works once). */
export async function createCheckout(args) {
    const pack = packById(args.catalog, args.packId);
    const product = pack?.products[args.mode];
    if (!pack || !product)
        throw new Error(`Unknown pack ${args.packId} in ${args.mode}`);
    const res = await (args.fetch ?? fetch)(`${DODO_API[args.mode]}/checkouts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            product_cart: [{ product_id: product, quantity: 1 }],
            customer: {
                email: args.customer.email,
                ...(args.customer.name && { name: args.customer.name }),
            },
            metadata: { owner: args.owner, pack: pack.id },
            return_url: args.returnUrl,
        }),
    });
    if (!res.ok)
        throw new Error(`Dodo checkout failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json());
    if (!body.checkout_url)
        throw new Error("Dodo checkout returned no URL");
    return body.checkout_url;
}
const enc = new TextEncoder();
function b64decode(s) {
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function b64encode(bytes) {
    let s = "";
    for (const b of new Uint8Array(bytes))
        s += String.fromCharCode(b);
    return btoa(s);
}
function equal(a, b) {
    if (a.length !== b.length)
        return false;
    let d = 0;
    for (let i = 0; i < a.length; i++)
        d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}
/** Standard Webhooks signature of `id.timestamp.body` (exported for tests and local tools). */
export async function signWebhook(secret, id, timestamp, body) {
    const key = await crypto.subtle.importKey("raw", b64decode(secret.startsWith("whsec_") ? secret.slice(6) : secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return b64encode(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${timestamp}.${body}`)));
}
/** Verify a Dodo (Standard Webhooks) request; throws on a bad signature or a timestamp more than 5 minutes off. */
export async function verifyWebhook(request, secret, now = Date.now()) {
    const id = request.headers.get("webhook-id");
    const timestamp = request.headers.get("webhook-timestamp");
    const signatures = request.headers.get("webhook-signature");
    if (!id || !timestamp || !signatures)
        throw new Error("Missing webhook headers");
    if (Math.abs(now / 1000 - Number(timestamp)) > 300)
        throw new Error("Webhook timestamp out of range");
    const body = await request.text();
    const expected = await signWebhook(secret, id, timestamp, body);
    const ok = signatures.split(" ").some((s) => {
        const [version, sig] = s.split(",");
        return version === "v1" && sig !== undefined && equal(sig, expected);
    });
    if (!ok)
        throw new Error("Invalid webhook signature");
    const parsed = JSON.parse(body);
    return { id, type: parsed.type, data: parsed.data };
}
export const webhookEventValidator = v.object({
    id: v.string(),
    type: v.string(),
    data: v.any(),
});
/**
 * Apply a verified event to the ledger, inside one mutation: `payment.succeeded` grants the pack's credit,
 * `refund.succeeded` takes back the refunded share. Anything else is ignored. Safe to replay.
 */
export async function applyWebhookEvent(ctx, catalog, mode, event) {
    const db = writer(ctx);
    if (event.type === "payment.succeeded") {
        const p = event.data;
        const owner = p.metadata?.owner;
        const pack = p.metadata?.pack ? packById(catalog, p.metadata.pack) : undefined;
        if (!owner || !pack)
            return { status: "ignored", reason: "payment without a Forest Lab pack" };
        const product = pack.products[mode];
        if (p.product_cart && !p.product_cart.some((i) => i.product_id === product && i.quantity === 1))
            return { status: "ignored", reason: `cart does not match pack ${pack.id}` };
        const existing = await db
            .query("billingPurchases")
            .withIndex("paymentId", (q) => q.eq("paymentId", p.payment_id))
            .unique();
        if (existing)
            return { status: "duplicate", reason: p.payment_id };
        const at = Date.now();
        await db.insert("billingPurchases", {
            owner,
            paymentId: p.payment_id,
            packId: pack.id,
            credit: pack.credit,
            totalAmount: p.total_amount,
            currency: p.currency,
            refundedCredit: 0,
            ...(p.invoice_url && { invoiceUrl: p.invoice_url }),
            at,
        });
        await grant(ctx, {
            owner,
            amount: pack.credit,
            key: `payment:${p.payment_id}`,
            reason: `Top-up ${pack.id}`,
            expiresAt: addMonths(at, catalog.creditMonths),
            topUp: true,
        });
        return { status: "granted", owner, amount: pack.credit };
    }
    if (event.type === "refund.succeeded") {
        const r = event.data;
        const purchase = await db
            .query("billingPurchases")
            .withIndex("paymentId", (q) => q.eq("paymentId", r.payment_id))
            .unique();
        if (!purchase)
            return { status: "ignored", reason: `refund for unknown payment ${r.payment_id}` };
        const unrefunded = purchase.credit - purchase.refundedCredit;
        const share = r.is_partial && r.amount && purchase.totalAmount > 0
            ? Math.round((purchase.credit * r.amount) / purchase.totalAmount)
            : unrefunded;
        const amount = Math.min(share, unrefunded);
        if (amount <= 0)
            return { status: "duplicate", reason: r.refund_id };
        const result = await charge(ctx, {
            owner: purchase.owner,
            amount,
            key: `refund:${r.refund_id}`,
            reason: `Refund of ${purchase.packId}`,
            allowDebt: true,
            kind: "refund",
        });
        if (result.ok && !result.applied)
            return { status: "duplicate", reason: r.refund_id };
        await db.patch(purchase._id, { refundedCredit: purchase.refundedCredit + amount });
        return { status: "refunded", owner: purchase.owner, amount };
    }
    return { status: "ignored", reason: event.type };
}
//# sourceMappingURL=billing.js.map