import { useLayoutEffect, useSyncExternalStore } from "react";
import type { CacheRuntime } from "../../cache/query-cache.js";
import type { GuestClient } from "../../client/types.js";
import { useClientBoundary } from "../../client/provider-context.js";
import { getAuthErrorCode, ignored } from "../shared/action.js";
import type { WorkflowAction, WorkflowError } from "../shared/types.js";
import type { GuestSessionState } from "./types.js";

type Write = (body: object, options: { throw: true; retry: 0 }) => Promise<unknown>;
type GuestSession = ReturnType<typeof createGuestStore>;

const target = { operation: "signInAsGuest" } as const;
const guestSessions = new WeakMap<CacheRuntime, GuestSession>();

/** The runtime's guest session, when the client was created with `guests: true`. */
export const guestSession = (runtime: CacheRuntime) => guestSessions.get(runtime);

function createGuestStore(
  auth: GuestClient,
  runtime: CacheRuntime,
  hasStoredSession?: () => boolean | Promise<boolean>,
) {
  const listeners = new Set<() => void>();
  let attempt: Promise<void> | undefined;
  let error: WorkflowError | null = null;
  let established = false;
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => revision,
    get attempt() {
      return attempt;
    },
    get error() {
      return error;
    },
    get established() {
      return established;
    },
    /** The first authentication was reached: from now on the app stays through identity changes. */
    establish() {
      if (established) return;
      established = true;
      changed();
    },
    /** The device holds no session, so Better Auth's session read can only come back empty. */
    async holdsNoSession() {
      try {
        return (await hasStoredSession?.()) === false;
      } catch {
        return false;
      }
    },
    /** One anonymous sign-in at a time, shared by the provider and sign-out. */
    ensure() {
      if (attempt) return attempt;
      error = null;
      let phase: WorkflowError["phase"] = "write";
      attempt = (async () => {
        try {
          let answer: unknown;
          try {
            answer = await (auth.signIn.anonymous as Write)({}, { throw: true, retry: 0 });
          } catch (cause) {
            // Another request already made this visitor a guest: read that session instead.
            if (getAuthErrorCode(cause) !== "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY")
              throw cause;
          }
          phase = "synchronization";
          if (!takeSession(auth, answer)) await runtime.refreshSession();
        } catch (cause) {
          error = { phase, cause, writeSucceeded: phase !== "write" };
          throw cause;
        } finally {
          attempt = undefined;
          changed();
        }
      })();
      changed();
      return attempt;
    },
  };
}

type SessionAtom = { get(): object; set(value: object): void };

/**
 * Takes a guest's sign-in answer as Better Auth's session when it carries one (the server's
 * `guests()`), sparing the session read. Better Auth still reads it again in the background.
 */
function takeSession(auth: GuestClient, answer: unknown) {
  const atom = (auth as { $store?: { atoms?: Record<string, SessionAtom | undefined> } }).$store
    ?.atoms?.session;
  const { session, user } = (answer ?? {}) as { session?: unknown; user?: unknown };
  if (!atom || typeof session !== "object" || !session || typeof user !== "object" || !user)
    return false;
  atom.set({ ...atom.get(), data: { session, user }, error: null, isPending: false });
  return true;
}

/** Provider lifecycle: a visitor without a session becomes a guest; readiness latches once. */
export function useGuestSessionLifecycle(
  runtime: CacheRuntime,
  identity: { userId?: string; ready: boolean; pending: boolean },
) {
  const guest = guestSessions.get(runtime);
  const subscribe = guest?.subscribe ?? idle;
  const failed = useSyncExternalStore(
    subscribe,
    () => guest?.error != null,
    () => guest?.error != null,
  );
  const { userId, ready, pending } = identity;
  useLayoutEffect(() => {
    if (!guest || runtime.disposed) return;
    if (ready) guest.establish();
    // A failed attempt waits for its explicit retry rather than looping. Without a stored
    // session, the sign-in need not wait for a session read that can only come back empty.
    if (userId || failed) return;
    const ensure = () => void guest.ensure().catch(() => {});
    if (!pending) return ensure();
    // A session that arrives first, an unmount or disposal cancels the answer: a guest sign-in by
    // a signed-in device would replace its account's session.
    let current = true;
    void guest.holdsNoSession().then((none) => none && current && !runtime.disposed && ensure());
    return () => {
      current = false;
    };
  }, [guest, runtime, userId, ready, pending, failed]);
}
const idle = () => () => {};

export function createGuestSession(
  auth: GuestClient,
  runtime: CacheRuntime,
  hasStoredSession?: () => boolean | Promise<boolean>,
) {
  const guest = createGuestStore(auth, runtime, hasStoredSession);
  guestSessions.set(runtime, guest);
  function useGuestSession(): GuestSessionState {
    const { disposed } = useClientBoundary(runtime);
    useSyncExternalStore(guest.subscribe, guest.getSnapshot, guest.getSnapshot);
    useSyncExternalStore(runtime.subscribeAuth, runtime.getAuthRevision, runtime.getAuthRevision);
    const observation = runtime.authObservation;
    const pending = guest.attempt !== undefined;
    const error = guest.error;
    const retry: WorkflowAction<[], void> = {
      isDisabled: disposed || pending,
      isPending: pending,
      disabledReason: disposed ? { code: "disabled" } : pending ? { code: "busy" } : null,
      run: async () => {
        if (runtime.disposed) return ignored("obsolete");
        if (guest.attempt) return ignored("busy");
        try {
          await guest.ensure();
          return { status: "success", data: undefined };
        } catch {
          return { status: "error", error: guest.error! };
        }
      },
    };
    return {
      userId: observation.userId,
      isAnonymous: observation.isAnonymous,
      isEstablished: guest.established || observation.ready,
      feedback: error ? [{ target, error: error.cause, diagnostics: error, recovery: retry }] : [],
      isPending: pending,
      diagnostics: { pendingAction: pending ? target : null, error },
      // A failed guest sign-in is always recoverable; reset never dismisses recovery.
      reset() {},
    };
  }
  return { useGuestSession };
}
