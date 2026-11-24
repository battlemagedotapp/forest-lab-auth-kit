import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, expect, it, vi } from "vitest";
import { withStoredConvexToken } from "../packages/auth-client/src/index.js";

const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims: object) => `${base64url({ alg: "RS256" })}.${base64url(claims)}.signature`;
const origin = "http://app.test";
const inMinutes = (minutes: number) => Math.floor(Date.now() / 1000) + minutes * 60;

/**
 * A Better Auth client whose cookie store keeps `stored` as the convex plugin's token, read at once
 * (`crossDomainClient()`) or, with `asyncStore`, from a secure store (Better Auth 1.7's `expoClient()`).
 */
function client(
  stored: string | undefined,
  sessionId: string | null = "session",
  asyncStore = false,
) {
  let cookie = stored
    ? `__Secure-better-auth.session_token=private; __Secure-better-auth.convex_jwt=${stored}`
    : "";
  const token = vi.fn(async (..._args: unknown[]) => {
    const fresh = jwt({ sessionId, exp: inMinutes(15), fresh: Math.random() });
    cookie = `__Secure-better-auth.convex_jwt=${fresh}`;
    return { data: { token: fresh }, error: null };
  });
  const session = { get: () => ({ data: sessionId ? { session: { id: sessionId } } : null }) };
  const auth = {
    getCookie: () => (asyncStore ? Promise.resolve(cookie) : cookie),
    $store: { atoms: { session } },
    convex: { token },
    useSession: () => "untouched",
  };
  return { auth, token, wrapped: withStoredConvexToken(auth) };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("hands over the current session's kept token once, then asks the server", async () => {
  for (const asyncStore of [false, true]) {
    vi.clearAllMocks();
    const kept = jwt({ sessionId: "session", exp: inMinutes(15) });
    const { token, wrapped, auth } = client(kept, "session", asyncStore);
    expect(await wrapped.convex.token()).toEqual({ data: { token: kept }, error: null });
    expect(token).not.toHaveBeenCalled();
    // A refresh or retry: the kept token was handed out already.
    const refreshed = await wrapped.convex.token({ fetchOptions: { throw: false } });
    expect(token).toHaveBeenCalledOnce();
    expect(token).toHaveBeenCalledWith({ fetchOptions: { throw: false } });
    expect(refreshed.data?.token).not.toBe(kept);
    // The server's token is now the kept one, and it was handed out too.
    await wrapped.convex.token();
    expect(token).toHaveBeenCalledTimes(2);
    expect(wrapped.useSession).toBe(auth.useSession);
  }
});

it("asks the server when the kept token is another session's", async () => {
  const { token, wrapped } = client(jwt({ sessionId: "previous", exp: inMinutes(15) }));
  await wrapped.convex.token();
  expect(token).toHaveBeenCalledOnce();
});

it("asks the server when the kept token is about to expire", async () => {
  const { token, wrapped } = client(jwt({ sessionId: "session", exp: inMinutes(0.5) }));
  await wrapped.convex.token();
  expect(token).toHaveBeenCalledOnce();
});

it("asks the server with no session, no kept token or an unreadable one", async () => {
  for (const [stored, sessionId] of [
    [jwt({ sessionId: "session", exp: inMinutes(15) }), null],
    [undefined, "session"],
    ["not-a-jwt", "session"],
  ] as const) {
    const { token, wrapped } = client(stored, sessionId);
    await wrapped.convex.token();
    expect(token).toHaveBeenCalledOnce();
  }
});

/** A real Better Auth server with the convex plugin, and one browser's cookies for it. */
function convexServer() {
  vi.stubEnv("CONVEX_SITE_URL", origin);
  const server = betterAuth({
    baseURL: origin,
    secret: "a-test-secret-that-is-long-enough-to-be-accepted",
    // As in a Convex HTTP action, which can write: the convex plugin turns writes off elsewhere.
    database: (options: BetterAuthOptions) => {
      const memory = memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        jwks: [],
      });
      const adapter = memory(options);
      return { ...adapter, options: { ...adapter.options, isRunMutationCtx: true } };
    },
    emailAndPassword: { enabled: true },
    plugins: [convex({ authConfig: { providers: [getAuthConfigProvider()] } })],
    logger: { disabled: true },
  });
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const request = async (path: string, body?: object) => {
    const headers = new Headers({ origin, "content-type": "application/json", cookie: cookie() });
    const response = await server.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body && JSON.stringify(body),
      }),
    );
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0]!;
      jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
    return response.json() as Promise<any>;
  };
  return { request, cookie };
}

it("hands over the token the convex plugin kept at the session read, signed by its JWKS", async () => {
  const { request, cookie } = convexServer();
  await request("/sign-up/email", {
    email: "a@example.com",
    password: "a-long-password",
    name: "A",
  });
  // The first token makes the signing key; from then on every session read keeps a fresh one.
  await request("/convex/token");
  const { session } = await request("/get-session");
  const token = vi.fn();
  const wrapped = withStoredConvexToken({
    getCookie: cookie,
    $store: { atoms: { session: { get: () => ({ data: { session } }) } } },
    convex: { token },
  });
  const handed = (await wrapped.convex.token()) as { data: { token: string } };
  expect(token).not.toHaveBeenCalled();
  const [header, payload, signature] = handed.data.token.split(".") as [string, string, string];
  const { keys } = (await request("/convex/jwks")) as { keys: (JsonWebKey & { kid: string })[] };
  const bytes = (text: string) =>
    Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const { kid } = JSON.parse(new TextDecoder().decode(bytes(header)));
  const key = await crypto.subtle.importKey(
    "jwk",
    keys.find((key) => key.kid === kid)!,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  expect(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      bytes(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  ).toBe(true);
});
