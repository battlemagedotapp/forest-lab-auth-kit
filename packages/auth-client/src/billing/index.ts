/**
 * Browser side of prepaid billing: the catalog (to list packs) and a checkout hook. Reads are the app's own
 * authorized Convex queries (`wallet`, `history` from `@strawdev/auth-client/convex/billing`), used with `useQuery`.
 */
import { useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useState } from "react";

export * from "./catalog.js";

/** An app action that checks the caller may buy for `owner` and returns the hosted checkout URL. */
export type CheckoutAction = FunctionReference<
  "action",
  "public",
  { owner: string; packId: string },
  string
>;

/**
 * Start a purchase: creates the checkout and sends this tab to it (never a popup, so it works on every device).
 * `error` holds the last failure; `isPending` stays true until the page leaves.
 */
export function useCheckout(
  action: CheckoutAction,
  navigate: (url: string) => void = (u) => window.location.assign(u),
) {
  const create = useAction(action);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const start = useCallback(
    async (owner: string, packId: string) => {
      setPending(true);
      setError(null);
      try {
        navigate(await create({ owner, packId }));
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setPending(false);
      }
    },
    [create, navigate],
  );
  return { start, isPending, error };
}
