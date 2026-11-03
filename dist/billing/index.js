/**
 * Browser side of prepaid billing: the catalog (to list packs) and a checkout hook. Reads are the app's own
 * authorized Convex queries (`wallet`, `history` from `@forest-lab/auth-kit/convex/billing`), used with `useQuery`.
 */
import { useAction } from "convex/react";
import { useCallback, useState } from "react";
export * from "./catalog.js";
/**
 * Start a purchase: creates the checkout and sends this tab to it (never a popup, so it works on every device).
 * `error` holds the last failure; `isPending` stays true until the page leaves.
 */
export function useCheckout(action, navigate = (u) => window.location.assign(u)) {
    const create = useAction(action);
    const [isPending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const start = useCallback(async (owner, packId) => {
        setPending(true);
        setError(null);
        try {
            navigate(await create({ owner, packId }));
        }
        catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
            setPending(false);
        }
    }, [create, navigate]);
    return { start, isPending, error };
}
//# sourceMappingURL=index.js.map