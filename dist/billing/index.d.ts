import type { FunctionReference } from "convex/server";
export * from "./catalog.js";
/** An app action that checks the caller may buy for `owner` and returns the hosted checkout URL. */
export type CheckoutAction = FunctionReference<"action", "public", {
    owner: string;
    packId: string;
}, string>;
/**
 * Start a purchase: creates the checkout and sends this tab to it (never a popup, so it works on every device).
 * `error` holds the last failure; `isPending` stays true until the page leaves.
 */
export declare function useCheckout(action: CheckoutAction, navigate?: (url: string) => void): {
    start: (owner: string, packId: string) => Promise<void>;
    isPending: boolean;
    error: Error | null;
};
//# sourceMappingURL=index.d.ts.map