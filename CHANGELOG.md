# Changelog

Releases are Git tags of the compiled package (see `RELEASING.md`). Earlier releases are described
in their GitHub Release notes and `VERIFICATION.md`.

## [0.10.0] — 2026-11-25

Works with Better Auth 1.7 and `@convex-dev/better-auth` 0.13, the versions the Convex Better Auth
React guide supports. Breaking: the peers move to new minor lines.

### Changed

- Peers: `better-auth` `~1.7.25` (was `~1.6.22`), `@convex-dev/better-auth` `~0.13.1` (was
  `~0.12.5`; 0.13.0 fails password reset, email verification and OTP checks with a 500 on Better
  Auth 1.7.22 and later), `convex` `^1.50.0` (was `^1.45.0`), `react` `~19.3.0` (was `~19.2.0`).
- `withStoredConvexToken` accepts a client whose `getCookie()` returns a promise, as Better Auth
  1.7's `expoClient()` does. Before, the native kept token was never found.
- `hasStoredSession` may answer with a promise:
  `async () => (await authClient.getCookie()).includes("session_token")` with `expoClient()`.

### Upgrade notes

Follow the upstream guides for anything this kit does not touch:
[Convex Better Auth, upgrading from 0.12](https://labs.convex.dev/better-auth/upgrading/from-0-12)
and [Better Auth 1.7](https://www.better-auth.com/docs/guides/1-7-upgrade-guide). For an app using
this kit with a Local Install:

1. Install the same versions together: `better-auth@1.7.25`, every `@better-auth/*` plugin
   (`passkey`, `expo`) at `1.7.25`, `@convex-dev/better-auth@0.13.1`, `convex@1.50.0`, and the
   `auth` CLI at `1.7.25` (the CLI's minor must match `better-auth`'s).
2. Export `consumeOne` and `incrementOne` from `convex/betterAuth/adapter.ts` beside the other
   adapter functions; without them `createClient(components.betterAuth, …)` no longer type-checks.
3. Regenerate the component schema (`auth generate`) and let Convex regenerate
   `convex/betterAuth/_generated`. The regeneration adds an `accountId_providerId_userId` index on
   `account`, optional `alg` and `crv` on `jwks`, and, with the matching plugins, columns on
   `twoFactor`, `team`, `teamMember` and an index on `rateLimit`. Existing rows stay valid except
   `team.memberCount`, which is required: a deployment that already has organization teams first
   deploys with it as `v.optional(v.number())`, backfills each team's count from its members, then
   regenerates and deploys again with it required (the Convex guide's "Regenerate schema" step).
4. `Account.issuer`: Better Auth 1.7.0–1.7.2 added a required `issuer` column to `account`; 1.7.3
   removed it, and 1.7.25 has none. Coming from 1.6 there is nothing to add or backfill. A database
   that ran 1.7.0–1.7.2 must make `issuer` optional (or drop it) and drop its index before
   upgrading, or new account writes fail. Before deploying, check `account` holds no duplicate
   `(providerId, accountId)` pairs: Better Auth 1.7 rejects a lookup matching more than one row.
5. Renamed server endpoints, for code calling them through `auth.api`: `getToken` →
   `getConvexToken`, `getJwks` → `getConvexJwks`, `getOpenIdConfig` → `getConvexOpenIdConfig`,
   `verifyOneTimeToken` (cross-domain) → `verifyCrossDomainOneTimeToken`. HTTP paths (`/convex/token`,
   `/convex/jwks`) and `authClient.convex.token()` are unchanged, so rate-limit rules on those
   paths stay as they are.
6. A sign-in no longer sets the `convex_jwt` cookie; the next session read or `/convex/token`
   does. `withStoredConvexToken` therefore hands over the kept token from the first session read on.
7. Behind a proxy of your own, Better Auth 1.7 ignores `x-forwarded-host`/`-proto` unless told to
   trust them: keep a fixed `baseURL`, or send `x-better-auth-forwarded-host`/`-proto`.
8. `session.cookieCache` is turned off by the Convex plugin (with a warning), and `oidcProvider` is
   no longer supported.
9. With `expoClient()`, `authClient.getCookie()` returns a promise: await it wherever the app reads
   it (such as `hasStoredSession`).
