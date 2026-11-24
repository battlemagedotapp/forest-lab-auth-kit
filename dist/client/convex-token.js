/** Tokens this close to expiring are fetched again. */
const MIN_LIFETIME_MS = 60_000;
/**
 * The client for `ConvexBetterAuthProvider`, taking the Convex token Better Auth already handed
 * over. The convex plugin sets it (`convex_jwt`) with every session read, and the
 * client keeps it with the session cookie. The first fetch for a session uses that token instead
 * of another round trip on every page load; refreshes and retries ask the server. A kept token is
 * used only when it is the current session's, has more than a minute left, and was not handed out
 * before. Pair it with `ConvexReactClient`'s `initialAuthTokenReuse`, or Convex fetches a second
 * token as soon as the first is confirmed.
 */
export function withStoredConvexToken(client) {
    let handedOut;
    async function token(...args) {
        const stored = await storedConvexToken(client);
        if (stored && stored !== handedOut) {
            handedOut = stored;
            return { data: { token: stored }, error: null };
        }
        const result = await client.convex.token(...args);
        const fetched = result?.data?.token;
        if (typeof fetched === "string")
            handedOut = fetched;
        return result;
    }
    return new Proxy(client, {
        get: (target, key, receiver) => key === "convex" ? { token } : Reflect.get(target, key, receiver),
    });
}
/** The kept token, when it is the current session's and not about to expire. */
async function storedConvexToken(client) {
    try {
        const value = /(?:^|;\s*)[^=;]*convex_jwt=([^;]+)/.exec(await client.getCookie())?.[1];
        const session = client.$store.atoms.session?.get();
        const sessionId = session?.data?.session?.id;
        if (!value || !sessionId)
            return undefined;
        const claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (typeof claims !== "object" || claims === null)
            return undefined;
        const { sessionId: tokenSession, exp } = claims;
        if (tokenSession !== sessionId || typeof exp !== "number")
            return undefined;
        return exp * 1000 - Date.now() > MIN_LIFETIME_MS ? value : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=convex-token.js.map