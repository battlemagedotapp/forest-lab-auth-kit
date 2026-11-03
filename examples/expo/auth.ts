import { createAuthClient } from "better-auth/react";
import {
  anonymousClient,
  multiSessionClient,
  organizationClient,
  inferOrgAdditionalFields,
} from "better-auth/client/plugins";
import type { createAuth } from "../backend/convex/auth";
import { expoClient } from "@better-auth/expo/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { ConvexReactClient, useQuery } from "convex/react";
import { api } from "../backend/convex/_generated/api";
import { createAuthDataClient, deviceAccountsClient } from "@forest-lab/auth-kit";
// A browser (not the server rendering the web app's pages).
const web = Platform.OS === "web" && typeof window !== "undefined";
export const authClient = createAuthClient({
  // The web app serves Better Auth from its own origin (app/api/auth), so the session is a cookie.
  baseURL: web ? window.location.origin : process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
  plugins: [
    organizationClient({ schema: inferOrgAdditionalFields<ReturnType<typeof createAuth>>() }),
    anonymousClient(),
    convexClient(),
    multiSessionClient(),
    // Each tab acts as its own account among those the browser keeps signed in.
    deviceAccountsClient(web ? { storage: sessionStorage } : {}),
    ...(web
      ? []
      : [
          expoClient({
            scheme: "reactive-auth-example",
            storagePrefix: "reactive-auth-example",
            storage: SecureStore,
          }),
        ]),
  ],
});
export const convex = new ConvexReactClient(
  process.env.EXPO_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210",
  // Keep the first token (withStoredConvexToken's, fresh) until its scheduled refresh.
  { initialAuthTokenReuse: true },
);
export const authData = createAuthDataClient({
  authClient,
  api: api.authData,
  features: {
    organization: true,
    sessions: true,
    authentication: true,
    account: true,
    accounts: true,
  },
  currentUser: {
    useCurrentUser() {
      const { data: session } = authClient.useSession();
      const identity = session?.user.id;
      const data = useQuery(
        api.authData.currentUser,
        identity ? { expectedUserId: identity } : "skip",
      );
      return { data, identity, isPending: Boolean(identity) && data === undefined, error: null };
    },
  },
});

// The `/guest` page shows an app that keeps guests: every visitor plays at once as a guest.
export const guestAuthData = createAuthDataClient({
  authClient,
  api: api.authData,
  features: { authentication: true, guests: true, accounts: true },
  // On native, a visitor with no stored session becomes a guest without waiting for an empty
  // session read; the web's session cookie is out of the page's reach.
  hasStoredSession: web ? undefined : () => authClient.getCookie().includes("session_token"),
});
