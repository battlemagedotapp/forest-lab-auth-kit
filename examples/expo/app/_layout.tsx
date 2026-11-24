import { Slot } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Network from "expo-network";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { AuthDataProvider, withStoredConvexToken } from "@forest-lab/auth-kit";
import { authClient, convex, authData } from "../auth";
function Recovery() {
  useEffect(() => {
    const refresh = () => {
      void authData.refresh().catch((error) => console.error("Auth refresh failed", error));
    };
    if (Platform.OS === "web") {
      const visible = () => {
        if (document.visibilityState === "visible") refresh();
      };
      window.addEventListener("online", refresh);
      document.addEventListener("visibilitychange", visible);
      return () => {
        window.removeEventListener("online", refresh);
        document.removeEventListener("visibilitychange", visible);
      };
    }
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected) refresh();
    });
    return () => {
      app.remove();
      network.remove();
    };
  }, []);
  return null;
}
export default function Layout() {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={withStoredConvexToken(authClient)}>
      <AuthDataProvider client={authData}>
        <Recovery />
        <Slot />
      </AuthDataProvider>
    </ConvexBetterAuthProvider>
  );
}
