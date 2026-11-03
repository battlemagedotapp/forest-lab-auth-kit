/**
 * Prepaid billing on Convex: one wallet per owner (an organization id, or any string the app bills), an append-only
 * ledger, credit lots that expire, and Dodo Payments as the merchant of record.
 *
 * The app spreads `billingTables` into its schema and calls these functions from its own (authorized) queries,
 * mutations and actions, as with `authSignalTables`. Money and credit are integers in the catalog currency's major
 * unit. Every grant and charge carries an idempotency key, so retried webhooks and retried tasks apply once.
 */
import { type GenericDatabaseReader, type GenericDatabaseWriter, type PaginationOptions } from "convex/server";
import { type Infer } from "convex/values";
import { type BalanceLevel, type BillingMode, type Catalog } from "../billing/catalog.js";
export * from "../billing/catalog.js";
export declare const billingTables: {
    /** One row per owner: the balance (negative only while storage runs into debt) and the last top-up's credit. */
    billingWallets: import("convex/server").TableDefinition<import("convex/values").VObject<{
        owner: string;
        updatedAt: number;
        balance: number;
        lastTopUp: number;
    }, {
        owner: import("convex/values").VString<string, "required">;
        balance: import("convex/values").VFloat64<number, "required">;
        lastTopUp: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "owner" | "updatedAt" | "balance" | "lastTopUp">, {
        owner: ["owner", "_creationTime"];
    }, {}, {}>;
    /** Credit as granted, used oldest-expiry first; `remaining` sums to max(balance, 0). */
    billingLots: import("convex/server").TableDefinition<import("convex/values").VObject<{
        expiresAt: number;
        key: string;
        owner: string;
        amount: number;
        remaining: number;
    }, {
        owner: import("convex/values").VString<string, "required">;
        key: import("convex/values").VString<string, "required">;
        amount: import("convex/values").VFloat64<number, "required">;
        remaining: import("convex/values").VFloat64<number, "required">;
        expiresAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "expiresAt" | "key" | "owner" | "amount" | "remaining">, {
        owner_expiresAt: ["owner", "expiresAt", "_creationTime"];
        expiresAt: ["expiresAt", "_creationTime"];
    }, {}, {}>;
    /** Append-only: every change to a balance, signed (`amount` < 0 takes credit away). */
    billingLedger: import("convex/server").TableDefinition<import("convex/values").VObject<{
        at: number;
        key: string;
        owner: string;
        reason: string;
        kind: "grant" | "charge" | "refund" | "expire";
        balance: number;
        amount: number;
    }, {
        owner: import("convex/values").VString<string, "required">;
        kind: import("convex/values").VUnion<"grant" | "charge" | "refund" | "expire", [import("convex/values").VLiteral<"grant", "required">, import("convex/values").VLiteral<"charge", "required">, import("convex/values").VLiteral<"refund", "required">, import("convex/values").VLiteral<"expire", "required">], "required", never>;
        amount: import("convex/values").VFloat64<number, "required">;
        balance: import("convex/values").VFloat64<number, "required">;
        key: import("convex/values").VString<string, "required">;
        reason: import("convex/values").VString<string, "required">;
        at: import("convex/values").VFloat64<number, "required">;
    }, "required", "at" | "key" | "owner" | "reason" | "kind" | "balance" | "amount">, {
        key: ["key", "_creationTime"];
        owner_at: ["owner", "at", "_creationTime"];
    }, {}, {}>;
    /** Payments that granted credit, and how much of their credit was refunded. */
    billingPurchases: import("convex/server").TableDefinition<import("convex/values").VObject<{
        invoiceUrl?: string | undefined;
        at: number;
        owner: string;
        packId: string;
        paymentId: string;
        credit: number;
        totalAmount: number;
        currency: string;
        refundedCredit: number;
    }, {
        owner: import("convex/values").VString<string, "required">;
        paymentId: import("convex/values").VString<string, "required">;
        packId: import("convex/values").VString<string, "required">;
        credit: import("convex/values").VFloat64<number, "required">;
        totalAmount: import("convex/values").VFloat64<number, "required">;
        currency: import("convex/values").VString<string, "required">;
        refundedCredit: import("convex/values").VFloat64<number, "required">;
        invoiceUrl: import("convex/values").VString<string | undefined, "optional">;
        at: import("convex/values").VFloat64<number, "required">;
    }, "required", "at" | "owner" | "packId" | "paymentId" | "credit" | "totalAmount" | "currency" | "refundedCredit" | "invoiceUrl">, {
        paymentId: ["paymentId", "_creationTime"];
        owner_at: ["owner", "at", "_creationTime"];
    }, {}, {}>;
};
type QueryCtx = {
    db: GenericDatabaseReader<any>;
};
type MutationCtx = {
    db: GenericDatabaseWriter<any>;
};
export type LedgerEntry = Infer<(typeof billingTables)["billingLedger"]["validator"]>;
export declare const walletValidator: import("convex/values").VObject<{
    balance: number;
    lastTopUp: number;
    level: "empty" | "low" | "ok" | "critical";
    nextExpiry: {
        at: number;
        amount: number;
    } | null;
}, {
    balance: import("convex/values").VFloat64<number, "required">;
    lastTopUp: import("convex/values").VFloat64<number, "required">;
    level: import("convex/values").VUnion<"empty" | "low" | "ok" | "critical", [import("convex/values").VLiteral<"ok", "required">, import("convex/values").VLiteral<"low", "required">, import("convex/values").VLiteral<"critical", "required">, import("convex/values").VLiteral<"empty", "required">], "required", never>;
    /** When the oldest remaining credit expires (null without credit). */
    nextExpiry: import("convex/values").VUnion<{
        at: number;
        amount: number;
    } | null, [import("convex/values").VNull<null, "required">, import("convex/values").VObject<{
        at: number;
        amount: number;
    }, {
        at: import("convex/values").VFloat64<number, "required">;
        amount: import("convex/values").VFloat64<number, "required">;
    }, "required", "at" | "amount">], "required", "at" | "amount">;
}, "required", "balance" | "lastTopUp" | "level" | "nextExpiry" | "nextExpiry.at" | "nextExpiry.amount">;
export interface Wallet {
    balance: number;
    lastTopUp: number;
    level: BalanceLevel;
    nextExpiry: {
        at: number;
        amount: number;
    } | null;
}
export declare function wallet(ctx: QueryCtx, owner: string): Promise<Wallet>;
export declare function history(ctx: QueryCtx, owner: string, paginationOpts: PaginationOptions): Promise<import("convex/server").PaginationResult<{
    _id: import("convex/values").GenericId<"billingLedger">;
    _creationTime: number;
    at: number;
    key: string;
    owner: string;
    reason: string;
    kind: "grant" | "charge" | "refund" | "expire";
    balance: number;
    amount: number;
}>>;
export declare function purchases(ctx: QueryCtx, owner: string, limit?: number): Promise<{
    _id: import("convex/values").GenericId<"billingPurchases">;
    _creationTime: number;
    invoiceUrl?: string | undefined;
    at: number;
    owner: string;
    packId: string;
    paymentId: string;
    credit: number;
    totalAmount: number;
    currency: string;
    refundedCredit: number;
}[]>;
export interface GrantArgs {
    owner: string;
    amount: number;
    /** Idempotency key: a second grant with the same key changes nothing. */
    key: string;
    reason: string;
    /** Default: never (a promotional grant may pass a date). */
    expiresAt?: number;
    /** Counts as a top-up for the low-balance levels (purchases do). */
    topUp?: boolean;
}
export declare function grant(ctx: MutationCtx, args: GrantArgs): Promise<{
    applied: boolean;
    balance: number;
}>;
export interface ChargeArgs {
    owner: string;
    amount: number;
    key: string;
    reason: string;
    /** Let the balance go below zero (storage during its grace period). Otherwise a short balance charges nothing. */
    allowDebt?: boolean;
    /** Ledger kind; refunds use "refund". */
    kind?: "charge" | "refund";
}
export type ChargeResult = {
    ok: true;
    applied: boolean;
    balance: number;
} | {
    ok: false;
    balance: number;
    shortBy: number;
};
export declare function charge(ctx: MutationCtx, args: ChargeArgs): Promise<ChargeResult>;
/** Expire the remaining credit of lots past their date (run from a cron); returns how many lots it expired. */
export declare function expireCredit(ctx: MutationCtx, now?: number, limit?: number): Promise<number>;
export declare const DODO_API: Record<BillingMode, string>;
export declare function billingMode(value: string | undefined): BillingMode;
export interface CheckoutArgs {
    catalog: Catalog;
    mode: BillingMode;
    apiKey: string;
    owner: string;
    packId: string;
    customer: {
        email: string;
        name?: string;
    };
    /** Where Dodo sends the buyer afterwards (it appends the payment status). */
    returnUrl: string;
    fetch?: typeof fetch;
}
/** Create a hosted checkout for one pack and return its URL (open it in the same tab; it works once). */
export declare function createCheckout(args: CheckoutArgs): Promise<string>;
/** A verified webhook event: its id (for logs) and the parsed body. */
export interface WebhookEvent {
    id: string;
    type: string;
    data: Record<string, unknown>;
}
/** Standard Webhooks signature of `id.timestamp.body` (exported for tests and local tools). */
export declare function signWebhook(secret: string, id: string, timestamp: string, body: string): Promise<string>;
/** Verify a Dodo (Standard Webhooks) request; throws on a bad signature or a timestamp more than 5 minutes off. */
export declare function verifyWebhook(request: Request, secret: string, now?: number): Promise<WebhookEvent>;
export declare const webhookEventValidator: import("convex/values").VObject<{
    data: any;
    id: string;
    type: string;
}, {
    id: import("convex/values").VString<string, "required">;
    type: import("convex/values").VString<string, "required">;
    data: import("convex/values").VAny<any, "required", string>;
}, "required", "data" | "id" | "type" | `data.${string}`>;
export type ApplyResult = {
    status: "granted" | "refunded";
    owner: string;
    amount: number;
} | {
    status: "duplicate" | "ignored";
    reason: string;
};
/**
 * Apply a verified event to the ledger, inside one mutation: `payment.succeeded` grants the pack's credit,
 * `refund.succeeded` takes back the refunded share. Anything else is ignored. Safe to replay.
 */
export declare function applyWebhookEvent(ctx: MutationCtx, catalog: Catalog, mode: BillingMode, event: WebhookEvent): Promise<ApplyResult>;
//# sourceMappingURL=billing.d.ts.map