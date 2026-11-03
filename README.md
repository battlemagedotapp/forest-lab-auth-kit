# Better Auth × Convex Client

`@strawdev/auth-client` supplies presentation-neutral authentication, account, organization, invitation, member, and session workflows around your existing Better Auth client backed by Convex. Better Auth retains credentials and reactive session ownership. The library owns reusable forms, guarded writes, synchronization, and recovery; authenticated Convex revision queries keep supported resources fresh.

The v0.4 contract extends the compatible organization/session API with opt-in authentication and account workflows. Navigation, styling, application data, and product policy remain application-owned.

## Setup

```tsx
import { createAuthDataClient, AuthDataProvider } from "@strawdev/auth-client";

export const authData = createAuthDataClient({
  authClient, // existing concretely typed Better Auth React client
  api: api.authData,
  features: {
    authentication: true,
    account: true,
    organization: true,
    sessions: true,
  },
  currentUser: {
    // Existing identity-checked reactive Convex projection; never copied into the private cache.
    useCurrentUser,
  },
});

// Inside the existing official ConvexBetterAuthProvider:
<AuthDataProvider client={authData}>{children}</AuthDataProvider>;
```

Pass `withStoredConvexToken(authClient)` to `ConvexBetterAuthProvider` when the client keeps its cookies where the page can read them (`crossDomainClient()` or `expoClient()`; not with [accounts](#accounts), whose session is an HttpOnly cookie): the first Convex token fetch for a session uses the token the convex plugin already set with the sign-in or session read (`convex_jwt`) instead of another round trip, when it is the current session's, has more than a minute left and was not handed out before; refreshes ask the server. Give `ConvexReactClient` `initialAuthTokenReuse: true` (experimental in Convex) so it keeps that token until its scheduled refresh.

Enable `organizationClient()` on the original client for organization capabilities. For guests, enable `anonymousClient()` and see [Guests](#guests). Keep that client, the official authentication provider, and application foreground/network refresh wiring. Do not add another QueryClient or authentication layer.

## Workflow roots and hooks

Each root adds no markup and owns one workflow. Its context hook reads that instance. The equivalent standalone hook creates an instance for explicit composition; do not call both to control the same workflow.

| Root                     | Context hook                       | Standalone hook             |
| ------------------------ | ---------------------------------- | --------------------------- |
| OrganizationDirectory    | useOrganizationDirectoryContext    | useOrganizationDirectory    |
| OrganizationCreateForm   | useOrganizationCreateFormContext   | useOrganizationCreateForm   |
| OrganizationSettings     | useOrganizationSettingsContext     | useOrganizationSettings     |
| OrganizationMembers      | useOrganizationMembersContext      | useOrganizationMembers      |
| InvitationForm           | useInvitationFormContext           | useInvitationForm           |
| ReceivedInvitations      | useReceivedInvitationsContext      | useReceivedInvitations      |
| InvitationResponse       | useInvitationResponseContext       | useInvitationResponse       |
| OrganizationInvitations  | useOrganizationInvitationsContext  | useOrganizationInvitations  |
| Sessions                 | useSessionsContext                 | useSessions                 |
| SignInForm               | useSignInFormContext               | useSignInForm               |
| SignUpForm               | useSignUpFormContext               | useSignUpForm               |
| PasswordResetRequestForm | usePasswordResetRequestFormContext | usePasswordResetRequestForm |
| PasswordResetForm        | usePasswordResetFormContext        | usePasswordResetForm        |
| EmailVerification        | useEmailVerificationContext        | useEmailVerification        |
| ProfileSettings          | useProfileSettingsContext          | useProfileSettings          |
| EmailChangeForm          | useEmailChangeFormContext          | useEmailChangeForm          |
| PasswordChangeForm       | usePasswordChangeFormContext       | usePasswordChangeForm       |
| ReauthenticationForm     | useReauthenticationFormContext     | useReauthenticationForm     |
| SignOut                  | useSignOutContext                  | useSignOut                  |
| Accounts                 | useAccountsContext                 | useAccounts                 |
| PasskeySignIn            | usePasskeySignInContext            | usePasskeySignIn            |
| Passkeys                 | usePasskeysContext                 | usePasskeys                 |

All are properties of the configured `authData` client. Scope, identity changes, and genuine departure retire private state and unfinished callbacks. With `guests: true`, the client also has `useGuestSession()` (no root: it reads the client's one guest session).

```tsx
function InvitationPage({ invitationId }) {
  return (
    <authData.InvitationResponse
      invitationId={invitationId}
      onAccepted={({ organization }) => navigateToOrganization(organization.slug)}
    >
      <InvitationControls />
    </authData.InvitationResponse>
  );
}

function InvitationControls() {
  const workflow = authData.useInvitationResponseContext();
  const accept = workflow.actions.accept;
  return (
    <>
      <button disabled={accept.isDisabled} onClick={() => void accept.run()}>
        Accept
      </button>
      <Feedback entries={workflow.feedback} />
    </>
  );
}
```

Workflows that own a read expose `isLoading` (no settled result yet), `isFetching`, and `queryError` for initial content. Their `isPending` always means an owned action is running, never that the read is loading. Action handles already compute eligibility: `run`, `isDisabled`, `isPending`, and structured `disabledReason`. The workflow's aggregate `isPending` is suitable for presentation such as preventing a containing dialog from closing while any owned action runs. Applications need not inspect diagnostics or combine loading, permissions, conflicts, or recovery flags.

## Forms and typed composition

Fields expose `name`, `value`, `onChange(value)`, `onBlur`, `isDisabled`, and `error`; React Hook Form stays internal. Submit through `form.actions.submit`. Custom validation and Zod transformations retain distinct draft-input and endpoint-output types.

Bind schema-backed definitions once outside rendering:

```tsx
const CreateOrganization = authData.defineOrganizationCreateForm(
  z.object({ name: z.string().min(1) }).transform(({ name }) => ({
    name,
    slug: name.toLowerCase().replaceAll(" ", "-"),
  })),
);

function CreatePage() {
  return (
    <CreateOrganization.Root
      initialValues={{ name: "" }}
      onCreated={({ organization }) => navigateToOrganization(organization.slug)}
    >
      <CreateControls />
    </CreateOrganization.Root>
  );
}

function CreateControls() {
  const form = CreateOrganization.useWorkflowContext();
  const name = form.field("name");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.actions.submit.run();
      }}
    >
      <input
        name={name.name}
        value={name.value}
        onChange={(event) => name.onChange(event.target.value)}
        onBlur={name.onBlur}
        disabled={name.isDisabled}
      />
      {name.error && <p role="alert">{name.error.message}</p>}
      <button disabled={form.actions.submit.isDisabled}>Create</button>
      <Feedback entries={form.feedback} />
    </form>
  );
}
```

Also available: `defineOrganizationSettings(schema)` and `defineInvitationForm(schema)`. Each definition exposes `Root`, `useWorkflowContext()`, and standalone `useWorkflow(options)`. A same-typed replacement schema supports localized validation without recreating the definition or resetting drafts. Non-schema roots use endpoint field types directly.

Authentication/account form definitions follow the same pattern (`defineSignInForm`, `defineSignUpForm`, reset, verification, profile, email, password, and reauthentication). Their input is the editable draft while schema output is the Better Auth payload, so an application can infer custom fields or transform presentation values without another controller.

Settings expose `form` only while an authorized organization exists. Pristine drafts adopt remote updates; dirty drafts remain intact and expose `hasServerChanges`. Explicit reset adopts the latest authorized projection. This is draft preservation, not server-side optimistic concurrency.

## Actions and recovery

| Workflow                   | Controls                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Directory                  | `select(organizationId)`                                                                                    |
| Creation / invitation form | `actions.submit`                                                                                            |
| Settings                   | `form.actions.submit`, `actions.update.run(data)`, `actions.leave`, `actions.delete`                        |
| Members                    | `member(id).remove`, `member(id).updateRole(role)`                                                          |
| Received invitations       | `invitation(id).accept`, `invitation(id).reject`                                                            |
| Single invitation          | `actions.accept`, `actions.reject`                                                                          |
| Outgoing invitations       | `invitation(id).cancel`, `invitation(id).resend`                                                            |
| Sessions                   | `session(id).revoke`, `actions.revokeOthers`, `actions.revokeAll`                                           |
| Sign in / sign up          | `form.actions.submit`                                                                                       |
| Reset / verification       | `form.actions.submit`                                                                                       |
| Profile                    | `form.actions.submit`, `actions.update.run(data)`, `actions.updateImage.run(image)`                         |
| Email / password / reauth  | `form.actions.submit`                                                                                       |
| Sign out                   | `actions.signOut`                                                                                           |
| Accounts                   | `account(userId).switch`, `account(userId).signOut`, `actions.signOutAll`, `actions.switchToGuest` (guests) |
| Passkey sign-in            | `actions.signIn`                                                                                            |
| Passkeys                   | `actions.add.run({ name? })`, `passkey(id).remove`                                                          |

Observed-item actions resolve current payloads internally. Resend preserves supported custom invitation fields. Do not copy rows into mutation payloads.

Render operation feedback directly. A successful write followed by failed synchronization carries a library-bound read-only recovery action:

```tsx
function Feedback({ entries }) {
  return entries.map((entry, index) => (
    <div key={index}>
      {entry.error && <p role="alert">{localizeError(entry.error)}</p>}
      {entry.recovery && (
        <button disabled={entry.recovery.isDisabled} onClick={() => void entry.recovery.run()}>
          Retry refresh
        </button>
      )}
    </div>
  ));
}
```

`reset()` dismisses settled feedback, not outstanding recovery. Recovery stays renderable after an accepted invitation disappears and never repeats the successful write or deletion preparation. Conflicting writes remain disabled until synchronization finishes.

Optional `onError` presents operation errors through application-owned notifications without wrapping each action promise. Ordinary form/read errors can remain inline. This private cache does not feed a consumer's global TanStack mutation-error host; avoid presenting the same failure both inline and as a toast unintentionally.

`getAuthErrorCode(error)` returns Better Auth's code (`INVALID_EMAIL_OR_PASSWORD`, `EMAIL_NOT_VERIFIED`, ...) from feedback errors, whether thrown or nested in a fetch error; map it to localized copy.

Actions return `WorkflowOutcome` for advanced callers. Diagnostic causes, phases, and write-success information remain available under `diagnostics`; ordinary controls should not inspect them to sequence work.

## Stable ownership and application policy

Host completion and recovery roots **above** organization availability gates. Render protected content conditionally below them; never retain unauthorized data just to preserve mounting.

Use canonical completion callbacks for routing: `onCreated`, `onUpdated`, and `onAccepted` receive the canonical organization. `onLeft` and `onDeleted` follow confirmed directory absence. Failed writes do not navigate. Callback-driven departure after completion delivery does not relabel success as obsolete; genuine earlier departure suppresses delivery. Callback failures do not repeat writes or callbacks, and the library cannot cancel application code once an asynchronous callback starts.

Pass cleanup through `beforeDelete({ organizationId, signal })`. Preparation runs before deletion under the organization's operation lock. Failure prevents deletion; genuine departure aborts the signal and suppresses subsequent deletion. The application owns idempotent cleanup, confirmation dialogs, timeouts, and server guards. Cancellation cannot undo completed cleanup or an HTTP request already sent.

Keep personal-organization ordering/restrictions, role policies, owner counts, upload processing, navigation, and unsupported authentication methods in the application. Directory selection is controlled and never changes Better Auth's active organization automatically. Explicit invalid selections do not fall back; `fallback="first"` is opt-in.

Identity workflows observe the configured Better Auth session hook and official Convex authentication readiness; they do not add a second session cache. Sign-in, sign-up, reauthentication, and sign-out recognize only their expected identity transition. Unrelated account changes retire callbacks and private recovery. Password reset and reauthentication distinguish read recovery from post-write cleanup, so retrying never repeats a consumed token or password submission. Secret fields are cleared after every submitted attempt and are never included in feedback or callback payloads.

`account: true` requires one typed current-user binding backed by the application's existing reactive, identity-checked user query. Profile drafts adopt remote changes while pristine and preserve local edits while dirty. Profile completion waits for the authoritative projection. The binding is consumed directly—its data is neither mirrored nor stored in TanStack Query.

Members expose the visible page and pagination metadata, not their internal fetched prefix. The HTTP transport requests progressively larger ordered prefixes; it is not efficient cursor pagination. See [pagination limits](docs/pagination.md). Session-list responses remain bounded and authoritative; the current session is separate rather than inserted into that list.

## Guests

Better Auth's [anonymous plugin](https://www.better-auth.com/docs/plugins/anonymous) gives a visitor a session before they have an account. The adapter recognizes such a user from `session.user.isAnonymous` whether or not the app keeps guests:

- A guest is someone who may sign in or up: `SignInForm` and `SignUpForm` are available with no user or an anonymous one. Signing in from a guest's session is a link, not an unrelated account: completion carries `guestUserId`, the guest that Better Auth linked (its `onLinkAccount` runs on the backend).
- Everything else needs an account. Organization, invitation, session and account workflows (profile included), reauthentication and, with `guests: true`, sign-out report `disabledReason: { code: "accountRequired" }` to a guest. Their reads still run and come back empty.
- With email verification required, sign-up returns no session and links nothing; verification signs no one in. The guest is linked when they sign in from the same browser afterwards.

`features: { authentication: true, guests: true }` (client-only; it needs `anonymousClient()`) is for an app where every visitor plays at once as a guest:

- `AuthDataProvider` signs a visitor with no session in anonymously, once, and records when the first authentication is reached. Pass `hasStoredSession` (with `crossDomainClient()` or `expoClient()`: `() => authClient.getCookie().includes("session_token")`) so a visitor whose device holds no session becomes a guest at once, alongside Better Auth's first session read rather than after it: one round trip less before the first paint. Without it, the guest sign-in waits for that read.
- Add `guests()` from `@strawdev/auth-client/better-auth` to the server's plugins so a guest's sign-in answers with its session: the client takes it as the session instead of reading it again, another round trip less (Better Auth still reads it once more in the background). Without it, the guest sign-in is followed by a session read.
- Signing out (and `PasswordResetForm`'s `signOutAfterReset`) leaves a fresh guest; recovery retries the guest sign-in without signing out again. A guest resetting an account's password keeps their own session.
- `useGuestSession()` returns `userId`, `isAnonymous`, `isEstablished` and the usual `feedback`/`isPending`. `isEstablished` turns true at the first authentication and never false again: gate the first paint on it, never on Convex's `isAuthenticated`, which turns false for a moment whenever a token changes hands. A failed guest sign-in is feedback whose `recovery` retries it.

```tsx
function Game() {
  const guest = authData.useGuestSession();
  if (!guest.isEstablished) return <Curtain feedback={guest.feedback} />;
  return <World account={!guest.isAnonymous} />; // stays mounted through sign-in and sign-out
}
```

Host `SignInForm`, `SignUpForm` and `SignOut` roots above any guest/account switch so their completion survives the identity change (`examples/expo/app/guest.tsx`). Keep an auth error boundary keyed by session (such as the integration's `AuthBoundary`) beside the app rather than around it, or every sign-in remounts the app.

On the backend, use `anonymous({ disableDeleteAnonymousUser: true, onLinkAccount })`. By default the guest's user and sessions are deleted inside the sign-in request, while the page still holds the guest's session; its refresh then clears the new session too. Move the guest's application data in `onLinkAccount` and delete the linked guest later (a scheduled mutation). Guests should not get application side effects meant for accounts, such as a personal organization (`allowUserToCreateOrganization: (user) => !user.isAnonymous`).

Turn `guests` on only in an app built around guests. An app with sign-in pages and signed-out routes keeps it off: its guards expect a visitor with no session. In Gaia, only the World Game turns it on; the main app never does.

An app with sign-in pages where only one page welcomes guests (such as a public link anyone may edit) uses `guests: "on-demand"` with `accounts`: no visitor becomes a guest by themselves, and `useAccounts().actions.switchToGuest` makes one when the page asks, from a signed-out context too. Signing out then leaves the context signed out, as without guests, and there is no `useGuestSession()`.

## Accounts

Several accounts signed in on one device, each browser tab acting as one of them, as an email
client or Google's apps do. It needs Better Auth served from the app's own origin, so the session is
a real cookie (shared by every app under one domain with `advanced.crossSubDomainCookies`): the web
app passes `/api/auth/*` to the Convex site, as the integration's Next.js and TanStack Start
handlers do (the example uses an Expo Router API route, `app/api/auth/[...path]+api.ts`; a static
host can rewrite the path). `crossDomain` is not used.

```ts
// Backend (Better Auth options)
import { deviceAccounts } from "@strawdev/auth-client/better-auth";
plugins: [multiSession(), bearer(), deviceAccounts() /* organization(), convex(), ... */];

// Client
import { deviceAccountsClient } from "@strawdev/auth-client";
const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [
    multiSessionClient(),
    deviceAccountsClient({ storage: sessionStorage }),
    convexClient(),
  ],
});
const authData = createAuthDataClient({
  authClient,
  api,
  features: { authentication: true, accounts: true /* , ... */ },
});
```

- **The device keeps the accounts** (Better Auth's `multiSession()`); its session cookie names the
  latest. `deviceAccounts()` lists them (`authData.useDeviceAccounts()`, `authClient.deviceAccounts.list()`),
  each with its organizations and role there when the organization plugin is on.
- **Each tab acts as its own.** `deviceAccountsClient()` keeps the tab's session token in `storage`
  and names it in every request (`bearer()`); a tab without one adopts the device's on its first
  session read. Convex follows: the provider's token is the tab's account's.
- **Switching** (`account(userId).switch`) is the tab's alone. **Signing in** from an account adds
  another, and the tab becomes it. **Signing out** (`SignOut`, `account(userId).signOut`) leaves
  one account; a tab whose account is gone moves on to the device's next within the same session
  read, never showing a passing sign-out. `actions.signOutAll` is Better Auth's sign-out: every
  account. A password change that revokes other sessions keeps every tab signed in.
- A guest who signs in or up leaves the device's accounts, linked to the account. Its session stays until the guest is deleted (by the anonymous plugin at once, or by the application later; see Guests), so a page still holding it keeps working until it moves on.
- With guests, `actions.switchToGuest` makes the tab a guest: the device's guest if it keeps one,
  else a new one beside the device's accounts, which stay signed in.

`accounts` is client-only and needs `authentication`. Product rules (which account opens which
organization, the switcher's presentation) stay in the application.

## Passkeys

Passkeys beside the password, through Better Auth's
[passkey plugin](https://www.better-auth.com/docs/plugins/passkey): an account made with email and
password adds a passkey, then signs in with it.

```ts
// Backend (Better Auth options): one relying party for every app under the cookie's domain
import { passkey } from "@better-auth/passkey";
plugins: [passkey({ rpID: "example.com", rpName: "Example", origin: appOrigins })];

// Client
import { passkeyClient } from "@better-auth/passkey/client";
const authClient = createAuthClient({ plugins: [passkeyClient() /* , ... */] });
const authData = createAuthDataClient({
  authClient,
  api,
  features: { authentication: true, passkeys: true /* , ... */ },
});
```

- **Signing in** (`usePasskeySignIn`): `actions.signIn` asks the browser for a passkey. With
  `autoFill: true`, the device's passkeys are also among the browser's suggestions for a field marked
  `autocomplete="username webauthn"`, rendered with the workflow; that ceremony waits outside the
  workflow until one is chosen. Either finishes as a password sign-in does: synchronization and its
  recovery, a guest linked, an account added beside the device's others. A closed prompt completes
  as `{ outcome: "cancelled" }`, without an error.
- **Managing** (`usePasskeys`): the account's passkeys (`data`), `actions.add` (the browser makes
  one) and `passkey(id).remove`. Adding needs a recent sign-in (Better Auth's `freshAge`):
  `needsFreshSession` turns on, and the application reauthenticates (`ReauthenticationForm`) before
  adding again.

`passkeys` is backed by the `passkeys` signal (the `passkey` table's triggers), so set it on both
sides; it needs `authentication`.

## Billing (prepaid wallets)

One prepaid wallet per owner (an organization id, or any string you bill), an append-only ledger, credit that expires,
and [Dodo Payments](https://dodopayments.com) as merchant of record (it handles tax, invoices and payouts). Amounts are
integers in the catalog currency's major unit (yen for JPY).

```ts
// convex/schema.ts
import { billingTables } from "@strawdev/auth-client/convex/billing";
export default defineSchema({ ...authSignalTables, ...billingTables });

// convex/billing.ts — see examples/backend/convex/billing.ts for the whole file
export const catalog = defineCatalog({
  currency: "JPY",
  creditMonths: 24,
  packs: [
    { id: "jpy500", price: 500, credit: 500, products: { test_mode: "pdt_…", live_mode: "pdt_…" } },
  ],
});
```

- **Reads** (from your own authorized queries): `wallet(ctx, owner)` → balance, last top-up, `level`
  (`ok` · `low` ≤ 30 % · `critical` ≤ 10 % · `empty`) and the next expiry; `history(ctx, owner, paginationOpts)`;
  `purchases(ctx, owner)`.
- **Writes** (inside your mutations): `grant(ctx, { owner, amount, key, reason })` and
  `charge(ctx, { owner, amount, key, reason, allowDebt? })`. The `key` makes each one apply once. Without `allowDebt`
  a short balance charges nothing and returns `{ ok: false, shortBy }`; with it the balance may go below zero, and the
  next grant repays the debt first. Charges use the soonest-expiring credit first; `expireCredit(ctx)` (a daily cron)
  removes what is left of expired credit.
- **Buying**: your action authorizes the buyer and calls `createCheckout({ catalog, mode, apiKey, owner, packId,
customer, returnUrl })`; the browser's `useCheckout(api.billing.checkout).start(owner, packId)` sends the tab to
  Dodo's hosted checkout.
- **Webhook**: an `httpAction` calls `verifyWebhook(request, secret)` (Standard Webhooks signature, 5-minute window)
  and runs a mutation with `applyWebhookEvent(ctx, catalog, mode, event)`: `payment.succeeded` grants the pack's
  credit (only when the cart holds that pack's product), `refund.succeeded` takes back the refunded share. Replays
  change nothing. Subscribe the endpoint to `payment.succeeded` and `refund.succeeded`.
- **Env**: `DODO_PAYMENTS_ENVIRONMENT` (`test_mode` · `live_mode`), `DODO_PAYMENTS_API_KEY`,
  `DODO_PAYMENTS_WEBHOOK_SECRET`.

## Low-level reads and methods

```tsx
const organizations = authData.useListOrganizations();
const organization = authData.useOrganization({ organizationSlug: "design" });
const members = authData.useListMembers({ organizationId, limit: 20, offset: 0 });
const received = authData.useListUserInvitations();
const invitation = authData.useInvitation({ id: invitationId });
await authData.organization.inviteMember({ organizationId, email, role: "member" });
```

Other reads: `useMemberRole`, `useListInvitations`, `useListSessions`, `useListPasskeys`. Each returns `data`, `error`, `isPending`, `isFetching`, and `refetch`. Resource `refetch()` can retry after a synchronization failure. Client errors (HTTP 4xx except rate limiting) hide previous private results; server/network refresh errors can retain previously authorized data. Query arguments use the upstream endpoint fields. The second hook argument accepts `{ enabled: false }`. Explicit organization scope is required; these hooks do not follow `activeOrganizationId`.

Mutation methods preserve upstream argument tuples, callbacks, throw options, and return values. Supported organization methods are `create`, `update`, `delete`, `leave`, `inviteMember` (including resend), `cancelInvitation`, `acceptInvitation`, `rejectInvitation`, `removeMember`, and `updateMemberRole`. Session methods are `revokeSession`, `revokeOtherSessions`, and `revokeSessions`. Passkey methods are `passkey.addPasskey` and `passkey.deletePasskey`.

A successful mutation starts cache invalidation; it does not wait for the UI to refresh. Read failures do not change the mutation result. A write finishing after a session change cannot invalidate the new session's cache. `await authData.refresh()` explicitly waits for observed reads to refresh and rejects refresh failures. Original-client/server mutations also propagate through backend signals.

The adapter has a private QueryClient and does not shadow an application's QueryClientProvider. Construct one adapter per configured client and mount its provider once. `dispose()` permanently releases its cache and subscriptions, hides mounted results, and rejects subsequent writes; ordinary unmounting supports remount/Strict Mode.

## Backend registration

Use the official Better Auth **local component installation** with organization schema generation. The runnable setup is in `examples/backend/convex`.

1. Add `authSignalTables` from `/convex` to your application schema.
2. In the Better Auth component, re-export `lookup` from `/convex/component` in an `authData.ts` module. These helpers must remain inside the component, not be exposed directly as public application endpoints.
3. Ensure the local `member` schema has `organizationId_userId`; retain Better Auth's generated `user.email_name` and `organization.slug` indexes.
4. Export `markSessionsChanged` from `/convex` in the app's `authData.ts`.
5. Pass `createSignalTriggers({ features, lookup: components.betterAuth.authData.lookup, markSessionsChanged: internal.authData.markSessionsChanged })` into the official `createClient` triggers option. Use `composeTriggers(applicationTriggers, signalTriggers)` to preserve existing callbacks and ordering.
6. Export `createSignalQueries({ features, lookup, getAuthUser, requireVerifiedInvitationEmail }).signals` as an authenticated public app query. `getAuthUser` delegates to your official auth component.
7. Pass the generated `api.authData` reference to the adapter.

Use the same backend-backed `organization`, `sessions` and `passkeys` flags on both sides. `authentication`, `account` and `guests` are client-only workflow capabilities. Protocol/capability mismatches surface as synchronization errors. Supply the **effective** invitation verification requirement from your auth configuration; it is required rather than guessed. In the example a shared `true` constant configures both Better Auth and the bridge. Account for Better Auth's generated/custom-ID defaults if your policy is implicit.

The example sets `advanced.database.generateId: false` so Convex allocates database IDs. Its indexes include session expiry and invitation lookup indexes. Schema generation remains application-owned; regenerate after changing auth plugins/options.

## Guarantees and limits

- Only observed reads subscribe. Identical dependency batches share a watch; each batch is bounded to 100 subjects.
- Directory results watch their organizations, without rewriting a signal for every member on rename. Member rows watch visible profiles; received invitations watch organization/inviter changes.
- Identity keys and cancellation prevent old responses from crossing user/session boundaries. Authentication/access loss masks protected results.
- Initial dependency snapshots revalidate HTTP reads. This is eventual freshness across two transports, not an atomic multi-endpoint snapshot.
- Triggers are atomic with the triggering database operation. A Better Auth endpoint can perform several operations. Bulk session deletion uses a scheduled revision update to reduce contention.
- Reads use a five-second stale time, five-minute inactive retention, cancellation, and no retries. There is no periodic polling. Observers of the same resource share one expiry timer. Future expiry dates cause one-shot refreshes; returned records are never filtered/reinterpreted by the adapter.
- Call `refresh()` from application-owned foreground/network events. It does not renew the Better Auth session. Browser and native wiring live in the example layout.
- Custom fields flow through endpoint types and payloads. Custom table/field renaming, arbitrary additional plugins, teams, SSR, and offline mutation replay are outside this release.

## Replacing an application-owned auth cache

The workflows replace supported-domain form state, action readiness, conflict guards, and synchronization/recovery sequencing as well as query keys and invalidation. Keep presentation, navigation, product cleanup, and unsupported authentication methods in the application.

- Prefer workflow roots or hooks for the supported journeys. Low-level methods are advanced escape hatches; they confirm writes, not synchronized navigation data. Do not wrap ordinary supported controls in another mutation/controller layer.
- `refetch()` returns `{ data, error }`, or `undefined` when disabled/disposed or when the identity changed. It rejects read failures. Hook state uses `isPending` and `isFetching`; it is not the full TanStack observer API.
- Use the original client directly only for advanced escape hatches or authentication methods outside the enabled workflow surface. Backend triggers update supported resources; call `refresh()` only when an advanced integration explicitly needs to await them. Keep cleanup of application-owned organization data before deleting the Better Auth organization.
- Move each connected set of readers and writers together. During a staged migration, retain old signal producers while any application still consumes their contract; do not assume an existing application's signal queries are interchangeable with this package's generated references.

## Installation

Install the precompiled release:

```sh
pnpm add '@strawdev/auth-client@github:strawdotdev/auth-client#v0.8.0'
```

Release tags contain the ready-to-use package at the repository root: JavaScript, declarations, and source maps. Installation does not compile this library, install its development tooling, or require permission to run its build scripts. The application still bundles normally and supplies the documented peer dependencies and authentication/backend configuration.

Keep the dependency manifest and lockfile in each application. Upgrade deliberately to another release tag; development commits do not change an installed release. Private repositories require Git access on developer machines and CI. No npm account or package registry configuration is needed.

The repository has one release path: its manually triggered **Release** GitHub Actions workflow builds and tests the package, updates the `dist` distribution branch, and creates an immutable version tag and GitHub Release. The canonical repository is [strawdotdev/auth-client](https://github.com/strawdotdev/auth-client).

## Development

Node 24 and pnpm 12. Run `pnpm install`, then `pnpm build`. `pnpm check` covers library/example types, Oxlint, and Oxfmt; `pnpm test` runs controlled contracts. `pnpm test:package` installs a packed tarball in an isolated plain-React consumer and reports bundled incremental size.

For the example:

1. In `examples/backend`, run `pnpm exec convex dev` and select a separate development deployment. The checked-in generated files are refreshed by Convex.
2. Configure deployment variables `BETTER_AUTH_SECRET`, `SITE_URL` (default example web URL `http://localhost:8099`), `AUTH_EMAIL_DELIVERY=controlled`, and `MAILBOX_URL`. The browser tests open the example on two origins under one domain, which share its session cookie: set `SITE_URL=http://one.auth.test:8099`, `SECOND_SITE_URL=http://two.auth.test:8099` and `COOKIE_DOMAIN=auth.test` (Playwright's Chromium resolves `*.auth.test` to this machine).
3. Run `pnpm mailbox`. The development-only sink binds localhost:8025 and stores messages in memory. A local Convex backend can use `http://127.0.0.1:8025`; a cloud deployment needs its own reachable test email delivery service.
4. Copy the Expo `.env.example` to `.env.local` and set that deployment's client and HTTP URLs.
5. Run root `pnpm dev`. The library, backend, and Expo watchers remain active. Run `pnpm test:e2e` against the example and mailbox.

The controlled suite never depends on external delivery. The separately selected live-email
qualification uses an isolated Convex development deployment with `AUTH_EMAIL_DELIVERY=resend`,
`AUTH_EMAIL_FROM`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET`; its Resend webhook targets
`/resend-webhook`. Run an Expo Web client for that deployment, set
`AUTH_CLIENT_EMAIL_BASE_URL` and `AUTH_CLIENT_EMAIL_DEPLOYMENT` locally, then run
`pnpm test:email`. `pnpm mailbox:live` opens the development component through
`@strawdev/resend-tui`; it is read-only.

`pnpm --filter @example/expo build` exports web; `build:native` produces an Android JavaScript bundle. `android` builds the development app. Use `adb reverse` for local backend/Metro ports when testing on an emulator. Native OS permissions, storage, deep links, and lifecycle events are application responsibilities.

No credentials are included. Publishing and migrating existing applications are separate actions.

## Compatibility and provenance

Development baseline: Better Auth 1.6.22, Convex integration 0.12.5, Convex 1.45.0, TanStack React Query 5.102.8, React 19.2; the example uses Expo SDK 57. Peers initially cover these minor lines. React/TanStack are optional peers for backend-only installs and required when importing the root React entry point.

Version `0.2.0` adds React Hook Form 7.88.0 and @hookform/resolvers 5.9.1 as runtime dependencies. Zod is a peer on the tested `~4.6.4` line (`pnpm add zod@4.6.4`). These are installed dependencies, not vendored code; the application does not compile the library. Backend entry points still exclude React/form code from their import graph, although installed runtime dependencies may bring their own React peer requirements. The existing `v0.1.0` release does not contain these form additions.

The official 0.12.5 provider type resolves its abstract session to `never` with this Better Auth version in the example. The example isolates a type cast at that upstream provider boundary; adapter and hook types remain concrete.

Architecture and cancellation patterns were informed by the reference application and Better Auth UI; see `THIRD_PARTY_NOTICES.md`. Verification results and remaining qualification are recorded in `VERIFICATION.md`.

For a typed application context, call `createSignalQueries<DataModel>(options)` using the application's generated Convex `DataModel`. Compose application hooks with `composeTriggers<DataModel, typeof localAuthSchema>(applicationTriggers, signalTriggers)` to retain the official integration's schema-specific callback types. Component lookup references are checked against the exported reader's validator-derived arguments and return metadata.

## Maintaining this repository

The package source is in `packages/auth-client`. See the [source organization guide](docs/architecture.md) for module ownership and naming, and the [Convex pagination review](docs/pagination.md) for the distinction between component cursors and Better Auth's HTTP endpoint contract. These are repository maintenance notes; the package's four public import paths (`.`, `/better-auth`, `/convex`, `/convex/component`) remain unchanged.
