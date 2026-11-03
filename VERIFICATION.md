# Verification

## v0.7.3 — 2026-10-11

With guests and accounts, `useAccounts().actions.switchToGuest` makes the tab a guest beside the
device's accounts: the device's guest when it keeps one (`account(id).switch`'s path), else a new
one through Better Auth's `signIn.anonymous` from the account's tab, which the anonymous plugin
allows and `deviceAccounts()` leaves alone (the account it came from is no guest). Present only
when the client has guests. Compatible.

- `pnpm verify`, `pnpm test:package` and `pnpm test:git` pass; a new in-memory test covers making
  a guest beside two accounts, it being unavailable to a guest, and the device's guest reused.
- Exercised in Gaia's World Game on its development environment (two accounts and a guest in one
  tab: account to guest to another account and back). `pnpm test:e2e` was not run: the example
  does not use the action.

## v0.7.2 — 2026-10-11

With accounts, signing a tab out of its account first moves the tab on to another of the device's
(an account before a guest), then revokes the old one, so the tab's Convex queries never run as a
signed-out account; the device's last account signs out through Better Auth's sign-out. Before,
the revocation briefly failed the tab's `getAuthUser`-backed queries with `Unauthenticated`.
Compatible.

- `pnpm verify`, `pnpm test:package` and `pnpm test:git` pass. Tests pin the order (move on,
  then revoke) and the last account's sign-out.
- `pnpm test:e2e` (local backend, two origins): all eleven journeys passed in 5.7 minutes, with
  the three fixture-helper journeys run without `--deployment local` as for v0.7.0. Clearing the tab's session before the last account's sign-out (as
  `crossDomainClient()` does) was tried and dropped: with a real cookie, reads in flight brought
  the account back, and the guest and session-freshness journeys failed.

## v0.7.1 — 2026-10-11

A tab whose account was signed out elsewhere left its session hook on the gone account when the
read that found it was not the hook's own: the integration's `AuthBoundary` calls `getSession()`
on a revoked session, which `crossDomainClient()` used to follow with a session signal. The
client plugin now signals the hook whenever a read finds the tab's account gone, so the tab moves
on (or signs out) as it did. Compatible.

- `pnpm verify`, `pnpm test:package` and `pnpm test:git` pass; a new in-memory test pins the
  signal on a direct `getSession()`.
- Found by Gaia's Organization journey "active sessions synchronize across signed-in clients".

## v0.7.0 — 2026-10-11

Several accounts on one device, each browser tab acting as its own: the client-only `accounts`
capability (`Accounts`/`useAccounts`, `useDeviceAccounts`), the server plugin `deviceAccounts()`
(new entry `@forest-lab/auth-kit/better-auth`, beside Better Auth's `multiSession()` and
`bearer()`) and the client plugin `deviceAccountsClient()`. It needs Better Auth served from the
app's own origin (a session cookie); the example now does that through an Expo Router API route and
drops `crossDomain`. With accounts, signing in from an account adds another, `SignOut` leaves only
the tab's account and `withStoredConvexToken` does not apply. Breaking only for apps that opt in:
`WorkflowOperation` gains `switchAccount` and `signOutAccount`.

- `pnpm verify` (121 controlled tests), `pnpm test:package` and `pnpm test:git` pass; the package
  check compiles a new accounts type contract against the packed artifact (it caught an emitted
  `getActions` type Better Auth's client rejected).
- Against a real in-memory Better Auth with tabs sharing one cookie jar (10 tests): one session
  across tabs, a new tab adopting the device's account, adding, switching, organizations with
  roles, signing one account or all out, a forged multi-session cookie, the same account signing in
  again, a password change revoking other sessions, a linked guest leaving the device, and the
  application ordering organizations. They found two Better Auth behaviours the plugins now handle:
  a tab signing out the device's current account while acting as another left the cookie on the
  revoked session, and a session read naming a gone account cleared the device's cookie.
- `pnpm test:e2e` against the local backend and mailbox, the example on two origins
  (`one.auth.test`, `two.auth.test`) sharing one cookie: all eleven journeys passed in 4.2 minutes,
  including two new accounts journeys. Three journeys' fixture helper runs
  `convex run --deployment local`, which needs a Convex login; on the logged-out box they were run
  with that flag removed (not committed).

## v0.6.2 — 2026-10-10

The `convex` peer range widens from `~1.45.0` to `^1.45.0`, as `@convex-dev/better-auth` declares
it, so consumers on a later Convex 1.x minor no longer see an unmet peer. The workspace and examples
now develop against Convex 1.46.0. Compatible.

- `pnpm check` and 104 controlled tests pass on Convex 1.46.0.
- `pnpm test:package` and `pnpm test:git`: compiled and Git-package installations passed.
- `pnpm test:e2e` was not rerun (no code changed).

## v0.6.1 — 2026-10-02

A guest is made one round trip sooner. With the new optional `hasStoredSession` (for example
`() => authClient.getCookie().includes("session_token")` with `crossDomainClient()` or
`expoClient()`), a visitor whose device holds no session is signed in anonymously alongside Better
Auth's first session read, which could only come back empty, instead of after it. Without the
option the guest sign-in waits for that read, as before. New `withStoredConvexToken(authClient)`
for `ConvexBetterAuthProvider`: the first Convex token fetch for a session uses the `convex_jwt`
the convex plugin already set (current session's, more than a minute left, handed out once)
instead of a `/convex/token` round trip; refreshes ask the server. Compatible.

- `pnpm check` and 104 controlled tests pass. Four cover the kept token: the current session's
  (handed out once), another session's, near expiry, and none or unreadable. A guest test pins one
  guest sign-in and one session read while the first read is still on its way, and fails on
  v0.6.0; another keeps the wait when the device may hold a session or the option is absent.
- `pnpm test:package` and `pnpm test:git`: compiled and Git-package installations passed.
- In Gaia's World Game against its cloud dev deployment (7 fresh browsers each, headless Chrome):
  a new guest's first page took 4.6 s (median) before, 4.1 s with the early guest sign-in alone,
  and 3.3 s with the kept token, `initialAuthTokenReuse` and an early Convex connection beside it.
  Its account journey (guest, sign-up, verification, linked sign-in, sign-out to a fresh guest)
  passed. `pnpm test:e2e` was not rerun.

## v0.6.0 — 2026-10-01

Better Auth's anonymous plugin is supported. A guest (`session.user.isAnonymous`) may use the
sign-in and sign-up workflows; signing in from a guest's session is synchronized as a link rather
than retired as an unrelated account, and its completion carries `guestUserId`. Organization,
invitation, session and account workflows, reauthentication, and (with guests) sign-out report
`accountRequired` to a guest; reads still run. The client-only `guests` capability signs a visitor
with no session in anonymously from `AuthDataProvider`, latches the first authentication for
`useGuestSession().isEstablished`, and returns a signed-out visitor to a fresh guest through the
same single guest sign-in. `getAuthErrorCode` is exported. Breaking: `WorkflowDisabledReason`
gains `accountRequired`, `WorkflowOperation` gains `signInAsGuest`, and anonymous users are no
longer treated as signed-in accounts.

- `pnpm check` and 98 controlled tests pass. The guest sign-in test fails on v0.5.1's
  synchronization (reported `obsolete`) when the session refetch settles before it renders.
- `pnpm test:package` and `pnpm test:git`: compiled and Git-package installations passed.
- `pnpm test:e2e` against the example's local Convex backend and mailbox: all nine journeys passed
  in 1.5 minutes, including the new guest journey (guest, sign-up, verification, linked sign-in,
  sign-out to a fresh guest). The example backend now enables the anonymous plugin. A later
  type-only change (`isAnonymous` may be `undefined`) was not rerun in the browser.
- Not yet run in Gaia.

## v0.5.1 — 2026-09-29

A resource's first freshness signal no longer cancels and restarts a read that is already in
flight. The read finishes and its result is shown, then the resource refetches once in the
background, so first paint needs one round trip instead of two while no change between the read
and the signal can be missed. Later signals keep cancelling obsolete reads as before.

- `pnpm check` and 94 controlled tests pass, including a regression that fails on v0.5.0.
- `pnpm test:package` and `pnpm test:git`: compiled and Git-package installations passed.

## v0.5.0 — 2026-09-29

Workflows now keep one loading contract: `isPending` means an owned action is running, and
workflows that own a read expose `isLoading` for its unsettled result. Previously the directory,
session and invitation workflows let action state overwrite read loading, so consumers saw neither
data nor pending while the first list loaded; settings, members, creation and profile used
`isPending` for their read instead. Resource reads now start once the Better Auth session is
known instead of waiting for Convex authentication, and the private cache is keyed to the user
session so readiness changes and token refreshes no longer discard in-flight reads.

- `pnpm check` and 93 controlled tests pass, including regressions for directory loading and
  session-only reads.
- `pnpm test:package` and `pnpm test:git`: compiled and Git-package installations passed.
- Gaia's root check, unit tests and Organization web journeys passed against the local build.
  Breaking for consumers that read workflow `isPending` as read loading: use `isLoading`.

## v0.4.3 — 2026-09-16

Form validation remains serialized by the workflow action lock, but validation issues are now
represented only by form-owned field and form feedback. They retain the existing validation-error
outcome without creating operation feedback, recovery, or `onError` callbacks. Rejected writes and
later operation failures retain their existing feedback behavior.

- `pnpm verify`: 91 controlled tests plus library, backend, example, lint, and formatting checks.
- `pnpm test:package` and `pnpm test:git`: compiled and Git-package installations passed.
- `pnpm test:e2e`: all eight isolated local browser journeys passed in 1 minute 24 seconds.
- Fallow reported no findings introduced by the release diff; existing findings remain inherited.
- Gaia's root check and affected deterministic suites passed against `v0.4.3-rc.1`. Focused web
  journeys passed for guest authentication, account overlays, compact and expanded invitation
  presentation, organization unavailability, and account switching. Stable `v0.4.3` contains the
  same implementation as the qualified candidate.

## v0.4.2 — 2026-09-15

Profile workflows now include active writes in their aggregate pending state, and direct profile
and sign-out actions enforce the same recovery restriction exposed by their action handles. Focused
controlled coverage proves modal-containment state and prevents successful primary writes from
being repeated while read-only recovery is pending. The release workflow passed controlled tests,
static checks, and compiled package and Git installation checks. Gaia's root check and 44 affected
deterministic tests passed against `v0.4.2-rc.1`; stable `v0.4.2` contains the same implementation.

## v0.4.1 — 2026-09-15

Workflow state now exposes aggregate `isPending` for presentation-level containment such as modal
dismissal. It is derived from the same action controller as individual action handles, keeping
ordinary consumers out of diagnostic pending-action metadata. The existing duplicate-submission
test now proves both aggregate and action-specific pending state. `pnpm check` and all 89 controlled
tests, package installation, Git installation, and all eight isolated browser journeys pass. Gaia's
affected static and deterministic checks passed against `v0.4.1-rc.1`; its six focused account and
workspace browser journeys passed in 1 minute 30 seconds. Stable `v0.4.1` contains that candidate
unchanged except for version and release documentation.

## v0.4.0 — 2026-09-15

Authentication and account workflows now share the same headless root/hook contract as the
organization and session workflows. Better Auth still owns credentials and reactive session state;
the adapter observes that session without caching a second copy. The application supplies a typed,
identity-checked reactive current-user projection for profile synchronization.

- `pnpm verify`: 89 controlled tests, type contracts, backend/example checks, lint, and formatting.
- `pnpm test:package` and `pnpm test:git`: compiled imports, declarations, backend separation, and
  compilation-free `v0.4.0-rc.4` candidate installation passed.
- `pnpm test:e2e`: all eight isolated local browser journeys passed in 1 minute 18 seconds.
- Live email qualification passed against `uncommon-gopher-566`: delivered registration
  verification, password reset, and two-step email change completed in 37.8 seconds; the existing
  invitation verification/acceptance journey completed in 48.6 seconds.
- Gaia's installed-candidate root and affected deterministic checks passed. Its two-client
  organization synchronization/deletion journey, including unavailable-state recovery and
  application sign-out, passed in 1 minute 48 seconds.

Secret fields are cleared after submitted attempts. Successful writes retain only bounded internal
receipts for read or named cleanup recovery; retries do not resubmit credentials, consumed reset
tokens, or primary writes. Callback delivery remains owned by a mounted workflow even when the
official authentication provider remounts for an expected identity transition.

The RC.3 review split identity execution into bounded lifecycle, transaction, and failure
responsibilities and consolidated schema roots and email-request behavior. Fallow reports no new
dead code, complexity, duplication, or boundary findings across the complete v0.4 change.

RC.4 keeps sign-out available from an observed Better Auth session while Convex authentication is
temporarily unavailable. Sign-out still confirms session absence and retains the same recovery and
conflict guarantees.

Stable `v0.4.0` contains the qualified RC.4 implementation unchanged except for version and release
documentation.

## v0.3.1 — 2026-09-15

Ownership moved to `strawdotdev/auth-client`. Package metadata, installation guidance, and the
`@strawdev/resend-tui` v0.1.2 development dependency now resolve directly to canonical
`strawdotdev` repositories. Runtime behavior is unchanged. `pnpm verify` passed 77 controlled
tests; package, Git-installation, and all eight isolated browser journeys also passed. The
implementation qualified as `v0.3.1-rc.1` (source
`ebe5a102a33d880c9cb70ea515b7efef90b705a1`).

## Live email ownership — 2026-09-14

The isolated example keeps controlled mail local and selects Convex Resend explicitly for live
qualification. `@strawdev/resend-tui` v0.1.2 is pinned only as repository test tooling;
`@convex-dev/resend` 0.2.7 belongs only to the example backend, not the published Auth Client
runtime.

- `pnpm verify`: 77 controlled tests, backend/example types, lint, and formatting passed.
- `pnpm test:package`: the unchanged Auth Client runtime package installed and bundled in an
  isolated consumer.
- `pnpm test:e2e`: all eight local HTTP-mailbox browser journeys passed in 1 minute 24 seconds.
- `pnpm test:email`: the delivered wrong-account, verification, rejection, acceptance, membership,
  and canonical-completion journey passed against development deployment `uncommon-gopher-566` in
  45.5 seconds.

Auth Client owns the detailed authentication journey. Gaia retains only its template, route,
presentation, cleanup, and application-handoff checks; `resend-tui` owns component mailbox behavior.

## v0.3.0 — 2026-09-14

The implementation qualified as `v0.3.0-rc.1` (source `d12c8936f605dca96bdefb44f9434dfbfaaa72f1`). Stable changes only the version and documentation.

- `pnpm verify`: 77 controlled tests, backend integration, type contracts, lint, and formatting passed.
- `pnpm test:package` and `pnpm test:git`: compiled imports, declarations, backend separation, and compilation-free installation passed. The public RC tag was installed into Gaia through pnpm.
- `pnpm test:e2e`: eight isolated local Convex/Expo Web journeys passed. They cover root ownership, organization lifecycle, invitations, sessions, scope retirement, and read-only recovery.
- Gaia: root checks and affected deterministic suites passed, including session validation and deletion preparation. Live journeys passed for creation, dirty updates, section-preserving rename, failed writes, single-write recovery, coordinated deletion, account switching, invitation delivery/wrong-account/acceptance/rejection/leave, session revocation/freshness, and navigation away during pending work. Controlled HTTP member pagination/removal and compact/expanded packaged web reviews passed.

Gaia consumes roots above availability gates and standalone hooks for collection/account composition. Its controls no longer interpret workflow phases or assemble synchronization retries. Product policy, presentation, routing, cleanup, and unsupported account coordination remain outside this library.

## Retained limitations

- Member pagination fetches progressively larger HTTP prefixes; it is not cursor pagination.
- Session lists remain authoritative and bounded; the current session is separate.
- Native execution is unverified. Qualification uses Expo Web and non-production Convex targets only.
- Fallow retains the guarded action runner, two browser-covered example controls with estimated-coverage warnings, and two small invitation fragments. Their lifecycle/presentation differences do not justify another abstraction. Current findings are inherited; no suppressions or new findings were added.

## Reproduce

Run `pnpm verify`, `pnpm test:package`, and `pnpm test:git`. For browser qualification, use the isolated example setup in the README, then `pnpm test:e2e`. Publication uses the existing manually dispatched Release workflow; never move a published tag. Consumers install the compiled Git tag and do not build library source.
