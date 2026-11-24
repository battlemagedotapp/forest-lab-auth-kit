/**
 * A Better Auth client with the convex plugin's `convexClient()` and a cookie store of its own:
 * Convex's `crossDomainClient()` on the web or Better Auth's `expoClient()` on native.
 */
export type StoredConvexTokenClient = {
    /** Better Auth 1.7's `expoClient()` reads its secure store asynchronously. */
    getCookie(): string | Promise<string>;
    $store: {
        atoms: Record<string, {
            get(): unknown;
        } | undefined>;
    };
    convex: {
        token: (...args: any[]) => Promise<unknown>;
    };
};
/**
 * The client for `ConvexBetterAuthProvider`, taking the Convex token Better Auth already handed
 * over. The convex plugin sets it (`convex_jwt`) with every session read, and the
 * client keeps it with the session cookie. The first fetch for a session uses that token instead
 * of another round trip on every page load; refreshes and retries ask the server. A kept token is
 * used only when it is the current session's, has more than a minute left, and was not handed out
 * before. Pair it with `ConvexReactClient`'s `initialAuthTokenReuse`, or Convex fetches a second
 * token as soon as the first is confirmed.
 */
export declare function withStoredConvexToken<C extends StoredConvexTokenClient>(client: C): C;
//# sourceMappingURL=convex-token.d.ts.map