import type { CacheRuntime } from "../../cache/query-cache.js";
import type { GuestClient } from "../../client/types.js";
import type { WorkflowError } from "../shared/types.js";
import type { GuestSessionState } from "./types.js";
/** The runtime's guest session, when the client was created with `guests: true`. */
export declare const guestSession: (runtime: CacheRuntime) => {
    subscribe(this: void, listener: () => void): () => boolean;
    getSnapshot: () => number;
    readonly attempt: Promise<void> | undefined;
    readonly error: WorkflowError | null;
    readonly established: boolean;
    /** The first authentication was reached: from now on the app stays through identity changes. */
    establish(): void;
    /** The device holds no session, so Better Auth's session read can only come back empty. */
    holdsNoSession(): Promise<boolean>;
    /** One anonymous sign-in at a time, shared by the provider and sign-out. */
    ensure(): Promise<void>;
} | undefined;
/** Provider lifecycle: a visitor without a session becomes a guest; readiness latches once. */
export declare function useGuestSessionLifecycle(runtime: CacheRuntime, identity: {
    userId?: string;
    ready: boolean;
    pending: boolean;
}): void;
export declare function createGuestSession(auth: GuestClient, runtime: CacheRuntime, hasStoredSession?: () => boolean | Promise<boolean>): {
    useGuestSession: () => GuestSessionState;
};
//# sourceMappingURL=guest.d.ts.map