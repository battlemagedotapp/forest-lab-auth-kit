type Organization = {
    id: string;
    name: string;
    slug: string;
    logo?: string | null;
};
/** An organization a device account belongs to, with its role there. */
export type DeviceAccountOrganization = Organization & {
    role: string;
};
export type DeviceAccountsOptions = {
    /**
     * Filters and orders an account's organizations as the application shows them, such as hiding
     * those being deleted or putting a personal one first. Runs on the server for each account.
     */
    organizations?: (userId: string, organizations: DeviceAccountOrganization[]) => DeviceAccountOrganization[] | Promise<DeviceAccountOrganization[]>;
};
/**
 * Every account signed in on this device, from the multi-session plugin's cookies: the server half
 * of the client's accounts. Needs Better Auth's `multiSession()` and, for each context (a browser
 * tab) to act as its own account, `bearer()`. With the organization plugin, each account carries
 * its organizations and its role in each, so a switcher can show them without signing in as each.
 *
 * `GET /device-accounts/list` answers as `listDeviceSessions` does (one entry per user, the newest
 * sign-in last), each entry adding `organizations`.
 *
 * The device's session cookie keeps naming an account while one remains. When a context signs out
 * the device's current account while acting as another (multi-session moves the device on only
 * when the two are the same), the acting account becomes the device's. A session read for a
 * context's own account that finds it gone (signed out elsewhere) leaves the device's cookies as
 * they are: Better Auth would clear them, taking the device's own account with it. A guest (the
 * anonymous plugin) who signs in or up leaves the device's accounts, linked to the account.
 */
export declare const deviceAccounts: (options?: DeviceAccountsOptions) => {
    id: "device-accounts";
    hooks: {
        after: {
            matcher: (context: import("better-auth").HookEndpointContext) => boolean;
            handler: import("better-auth").Middleware<import("better-auth").MiddlewareOptions, (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<void>>;
        }[];
    };
    endpoints: {
        listDeviceAccounts: import("better-auth").StrictEndpoint<"/device-accounts/list", {
            method: "GET";
            requireHeaders: true;
        }, {
            session: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                userId: string;
                expiresAt: Date;
                token: string;
                ipAddress?: string | null | undefined;
                userAgent?: string | null | undefined;
            };
            user: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            };
            organizations: DeviceAccountOrganization[];
        }[]>;
    };
};
/**
 * The server half of `guests`: a guest's sign-in answers with the session it made, beside the
 * token and user the anonymous plugin answers with, so the client takes it as the session rather
 * than reading it again (one round trip less before a guest's first page). Needs Better Auth's
 * `anonymous()`.
 */
export declare const guests: () => {
    id: "guests";
    hooks: {
        after: {
            matcher: (context: import("better-auth").HookEndpointContext) => boolean;
            handler: import("better-auth").Middleware<import("better-auth").MiddlewareOptions, (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                session: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    userId: string;
                    expiresAt: Date;
                    token: string;
                    ipAddress?: string | null | undefined;
                    userAgent?: string | null | undefined;
                } & Record<string, any>;
                user: unknown;
            } | undefined>>;
        }[];
    };
};
export {};
//# sourceMappingURL=index.d.ts.map