import type { Features, InvalidationApi } from "../signal-protocol.js";
export type {
  Features,
  ResourceDependency,
  InvalidationSnapshot,
  InvalidationApi,
} from "../signal-protocol.js";
import type { InvitationSurface } from "../workflows/invitations/types.js";
import type { OrganizationWorkflows } from "../workflows/organizations/types.js";
import type { SessionWorkflows } from "../workflows/sessions/types.js";
import type {
  AuthenticationWorkflows,
  GuestSessionWorkflow,
} from "../workflows/authentication/types.js";
import type { AccountWorkflows, CurrentUserBinding } from "../workflows/account/types.js";
import type { AccountsWorkflows } from "../workflows/accounts/types.js";
import type { PasskeyWorkflows } from "../workflows/passkeys/types.js";
// Parameter variance bridge for Better Auth's generated generic methods.
// Concrete endpoint signatures are retained in every consumer-facing surface.
export type Endpoint = (...args: any[]) => Promise<unknown>;
export interface SessionClient {
  useSession(): {
    data: {
      user: { id: string; email?: string; isAnonymous?: boolean | null | undefined };
      session: { id: string; token?: string };
    } | null;
    isPending: boolean;
    refetch?: () => Promise<unknown>;
  };
}
export type AuthenticationClient = SessionClient & {
  signIn: { email: Endpoint };
  signUp: { email: Endpoint };
  requestPasswordReset: Endpoint;
  resetPassword: Endpoint;
  sendVerificationEmail: Endpoint;
  signOut: Endpoint;
};
/**
 * `deviceAccountsClient()` adds `deviceAccounts` (the device's accounts and this context's choice
 * among them); Better Auth's `multiSessionClient()` adds `multiSession.revoke`.
 */
export type AccountsClient = AuthenticationClient & {
  deviceAccounts: {
    list: Endpoint;
    select(sessionToken: string | null): void;
    selected(): string | undefined;
  };
  multiSession: { revoke: Endpoint };
};
/** Better Auth's `anonymousClient()` adds `signIn.anonymous`. */
export type GuestClient = AuthenticationClient & {
  signIn: { anonymous: Endpoint };
};
/**
 * Better Auth's `passkeyClient()` (`@better-auth/passkey/client`) adds `signIn.passkey` and
 * `passkey`, whose list and removal the plugin's endpoints name.
 */
export type PasskeyClient = AuthenticationClient & {
  signIn: { passkey: Endpoint };
  passkey: { addPasskey: Endpoint; listUserPasskeys: Endpoint; deletePasskey: Endpoint };
};
export type AccountClient = AuthenticationClient &
  SessionsClient & {
    updateUser: Endpoint;
    changeEmail: Endpoint;
    changePassword: Endpoint;
  };
export type OrganizationMethods =
  | "list"
  | "getFullOrganization"
  | "listMembers"
  | "getActiveMemberRole"
  | "listInvitations"
  | "listUserInvitations"
  | "getInvitation"
  | "create"
  | "update"
  | "delete"
  | "leave"
  | "inviteMember"
  | "cancelInvitation"
  | "acceptInvitation"
  | "rejectInvitation"
  | "removeMember"
  | "updateMemberRole";
export type OrganizationClient = { organization: Record<OrganizationMethods, Endpoint> };
export type SessionsClient = Record<
  "listSessions" | "revokeSession" | "revokeOtherSessions" | "revokeSessions",
  Endpoint
>;
type ReadPayload<R> = R extends { data: infer T; error: null }
  ? T
  : R extends { data: unknown; error: unknown }
    ? never
    : R;
export type Data<E extends Endpoint> = E extends (...args: infer _Args) => Promise<infer R>
  ? ReadPayload<R>
  : never;
export type Query<E extends Endpoint> =
  NonNullable<Parameters<E>[0]> extends { query?: infer Q }
    ? NonNullable<Q>
    : Record<string, never>;
export type RefetchResult<T> = { data: T | undefined; error: unknown };
export type Result<T> = {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  refetch(): Promise<RefetchResult<T> | undefined>;
};
export type Hook<E extends Endpoint> = (
  query?: Query<E>,
  options?: { enabled?: boolean },
) => Result<Data<E>>;
export type OrganizationSurface<C extends OrganizationClient> = {
  useListOrganizations: Hook<C["organization"]["list"]>;
  useOrganization: (
    query: Query<C["organization"]["getFullOrganization"]> &
      (
        | { organizationId: string; organizationSlug?: never }
        | { organizationSlug: string; organizationId?: never }
      ),
    options?: { enabled?: boolean },
  ) => Result<Data<C["organization"]["getFullOrganization"]>>;
  useListMembers: (
    query: Query<C["organization"]["listMembers"]> & { organizationId: string },
    options?: { enabled?: boolean },
  ) => Result<Data<C["organization"]["listMembers"]>>;
  useMemberRole: (
    query: Query<C["organization"]["getActiveMemberRole"]> &
      ({ organizationId: string } | { organizationSlug: string }),
    options?: { enabled?: boolean },
  ) => Result<Data<C["organization"]["getActiveMemberRole"]>>;
  useListInvitations: (
    query: Query<C["organization"]["listInvitations"]> & { organizationId: string },
    options?: { enabled?: boolean },
  ) => Result<Data<C["organization"]["listInvitations"]>>;
  useListUserInvitations: Hook<C["organization"]["listUserInvitations"]>;
  useInvitation: (
    query: Query<C["organization"]["getInvitation"]> & { id: string },
    options?: { enabled?: boolean },
  ) => Result<Data<C["organization"]["getInvitation"]>>;
  organization: Pick<
    C["organization"],
    | "create"
    | "update"
    | "delete"
    | "leave"
    | "inviteMember"
    | "cancelInvitation"
    | "acceptInvitation"
    | "rejectInvitation"
    | "removeMember"
    | "updateMemberRole"
  >;
};
export type PasskeySurface<C extends PasskeyClient> = {
  useListPasskeys: Hook<C["passkey"]["listUserPasskeys"]>;
  passkey: Pick<C["passkey"], "addPasskey" | "deletePasskey">;
};
export type SessionSurface<C extends SessionsClient> = Pick<
  C,
  "revokeSession" | "revokeOtherSessions" | "revokeSessions"
> & { useListSessions: Hook<C["listSessions"]> };

declare const authDataClientBrand: unique symbol;
export interface AuthDataLifecycle {
  readonly [authDataClientBrand]: true;
  refresh(): Promise<void>;
  dispose(): void;
}
export type AuthDataClient<
  C extends SessionClient,
  F extends Features,
  U extends { email: string } = never,
> = AuthDataLifecycle &
  (F extends { organization: true }
    ? OrganizationSurface<C extends OrganizationClient ? C : never> &
        InvitationSurface<C extends OrganizationClient ? C : never> &
        OrganizationWorkflows<C extends OrganizationClient ? C : never>
    : unknown) &
  (F extends { sessions: true }
    ? SessionSurface<C extends SessionsClient ? C : never> &
        SessionWorkflows<C extends SessionsClient ? C : never>
    : unknown) &
  (F extends { authentication: true }
    ? AuthenticationWorkflows<C extends AuthenticationClient ? C : never>
    : unknown) &
  (F extends { account: true }
    ? AccountWorkflows<C extends AccountClient ? C : never, U>
    : unknown) &
  (F extends { guests: true } ? GuestSessionWorkflow : unknown) &
  (F extends { passkeys: true }
    ? PasskeySurface<C extends PasskeyClient ? C : never> &
        PasskeyWorkflows<C extends PasskeyClient ? C : never>
    : unknown) &
  (F extends { accounts: true }
    ? AccountsWorkflows<
        C extends AccountsClient ? C : never,
        F extends { guests: true | "on-demand" } ? true : false
      >
    : unknown);

export type AuthDataClientConfig<
  C extends SessionClient,
  F extends Features,
  U extends { email: string },
> = {
  authClient: C &
    (F extends { organization: true } ? OrganizationClient : unknown) &
    (F extends { sessions: true } ? SessionsClient : unknown) &
    (F extends { authentication: true } ? AuthenticationClient : unknown) &
    (F extends { account: true } ? AccountClient : unknown) &
    (F extends { guests: true | "on-demand" } ? GuestClient : unknown) &
    (F extends { passkeys: true } ? PasskeyClient : unknown) &
    (F extends { accounts: true } ? AccountsClient : unknown);
  api: InvalidationApi;
  /**
   * `guests` needs `authentication`: signing out returns the visitor to a guest; on demand, it
   * also needs `accounts`, whose `switchToGuest` makes the guest. So does
   * `accounts`: signing in adds an account and signing out leaves one. So does `passkeys`: a
   * passkey signs in as a password does.
   */
  features: F &
    (F extends { guests: true } ? { authentication: true } : unknown) &
    (F extends { guests: "on-demand" } ? { authentication: true; accounts: true } : unknown) &
    (F extends { passkeys: true } ? { authentication: true } : unknown) &
    (F extends { accounts: true } ? { authentication: true } : unknown);
} & (F extends { account: true }
  ? { currentUser: CurrentUserBinding<U> }
  : { currentUser?: never }) & {
    /**
     * With `guests`: whether this device holds a session at all, such as
     * `async () => (await authClient.getCookie()).includes("session_token")` with Convex's
     * `crossDomainClient()` or Better Auth's `expoClient()` (whose `getCookie()` is async since
     * Better Auth 1.7). When it answers `false`, a visitor becomes a guest at once
     * instead of after Better Auth's first session read, which could only come back empty.
     * Without it, the guest sign-in waits for that read.
     */
    hasStoredSession?: () => boolean | Promise<boolean>;
  };
