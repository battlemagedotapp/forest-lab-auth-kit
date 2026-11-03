# Source organization

The package lives in `packages/auth-client`. Its name and public imports remain `@forest-lab/auth-kit`; moving source files does not add supported deep imports.

```text
src/
  index.tsx                        Public frontend exports
  signal-protocol.ts               Shared wire types without frontend dependencies
  client/
    create-client.ts               Capability selection and public method wrappers
    provider.tsx                   Existing Convex connection, identity and guest lifecycle
    provider-context.ts            Matching-provider checks and runtime association
    types.ts                       Better Auth endpoint inference and client capabilities
    convex-token.ts                Convex token Better Auth already handed over (withStoredConvexToken)
  cache/
    query-cache.ts                 Private QueryClient, subscriptions, refresh and expiry
    use-cached-resource.ts         Read observers, protected-data masking and dependencies
    resource-dependencies.ts       Endpoint-to-signal dependency discovery
  workflows/
    shared/
      action.ts                    Action readiness, guarded completion and feedback
      identity-action.ts           Expected session-transition lifecycle and receipts
      identity-sync.ts             Session result parsing and bounded synchronization
      locks.ts                     Observable runtime-local operation conflicts
      form.ts                      RHF validation, defaults and value-only bindings
      root.tsx                     Typed root/context binding; no workflow state of its own
      type-contracts.ts            Form and callback contracts shared by workflow domains
      types.ts                     Common action, policy and form contracts
    invitations/
      workflows.tsx                Invitation reads, actions and acceptance recovery
      form.ts                      Invitation-specific validation and submission
      types.ts                     Invitation contracts inferred from Better Auth
    organizations/
      workflows.tsx                Directory, settings, creation and member workflows
      types.ts                     Organization and member contracts
    sessions/
      workflows.tsx                Session-list actions and freshness feedback
      types.ts                     Session contracts
    authentication/
      workflows.tsx                Guest entry, reset, verification and sign-out lifecycles
      guest.ts                     Guest (anonymous) session, first-authentication latch
      types.ts                     Typed authentication form and outcome contracts
    account/
      workflows.tsx                Reactive profile, email, password and reauthentication flows
      types.ts                     Current-user binding and account contracts
    accounts/
      workflows.tsx                The device's accounts: switching and signing one or all out
      types.ts                     Accounts contracts
  better-auth/
    index.ts                       deviceAccounts(): the device's accounts (server plugin)
    client.ts                      deviceAccountsClient(): the tab's account (client plugin)
  convex/
    index.ts                       Application signal queries and transactional triggers
    component.ts                   Component-local access/dependency metadata readers
```

Domain folders supply context, so their implementation and type files do not repeat the domain name. Shared types contain only concepts used across workflows; organization and session types live with their implementations. The frontend entry point only exports supported symbols.

## Naming and ownership

- `useWorkflowAction` coordinates an operation; it is not another cache or authentication hook.
- `ActionExecution` describes guarded write/callback phases. It does not imply a database transaction or whole-endpoint atomicity.
- `useCommittedRef` retains the latest committed configuration for asynchronous work. Render-time options must not escape through an abandoned render.
- `useOrganizationRecovery` owns only the minimal successful-write receipt. Canonical organizations remain in the existing query cache.
- `useOrganizationResource` resolves explicit scope and observes organization/role reads. It does not select the session's active organization.
- `FormFieldIssue`, `FormValidationIssue`, and `FormFieldErrors` describe shared form feedback. Schema definitions preserve input/output inference across root and context consumers.
- Action handles, aggregate workflow `isPending`, and bound recovery feedback are the ordinary control contract. Workflow reads report `isLoading`, `isFetching`, and `queryError`; `isPending` never describes a read.
- A guest is a Better Auth anonymous user. `"guest"` availability (sign-in/up) admits one; organization, invitation, session and account workflows need an account and report `accountRequired`. One runtime-wide guest session (`guest.ts`) is shared by the provider and sign-out, so a visitor never gets two guests.
- Resource reads start as soon as the Better Auth session is known; Convex authentication gates only the freshness signals. Cached results belong to one user session and survive readiness changes and token refreshes. Diagnostic phases are for troubleshooting, not consumer sequencing. Recovery receipts remain internal to their domain.

Keep public names stable unless a consumer contract is intentionally revised. Internal filenames are not package exports. Do not import backend modules from frontend implementation, or React modules from backend helpers.

## Where changes belong

Add endpoint dependencies to `cache/resource-dependencies.ts`; lifecycle/invalidation changes belong in `cache/query-cache.ts`. Put a domain rule in its workflow unless multiple existing workflows need the same mechanism. Put platform lifecycle wiring, navigation, presentation, uploads, and application cleanup in the example or consumer.

Tests ending in `.types.ts` or `.types.tsx` are compile-time consumer contracts. Their names identify capabilities, endpoint inference, backend integration, Gaia compatibility, invitations, or organization/session workflows. Behavioral tests use `.test.ts` or `.test.tsx`. The package check compiles the same type contracts against an installed artifact.

The source tree is deliberately shallow. Avoid a generic utility layer or one-file-per-symbol decomposition. See [pagination](pagination.md) before replacing member reads with a direct Convex query.
