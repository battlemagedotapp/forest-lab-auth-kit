import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { betterAuth } from "better-auth/minimal";
import { anonymous, bearer, multiSession, organization } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { convex } from "@convex-dev/better-auth/plugins";
import { createSignalTriggers } from "@forest-lab/auth-kit/convex";
import { deviceAccounts } from "@forest-lab/auth-kit/better-auth";
import { components, internal } from "./_generated/api";
import authConfig from "./auth.config";
import type { DataModel } from "./_generated/dataModel";
import { sendAuthEmail } from "./email";
import schema from "./betterAuth/schema";
export const features = { organization: true, sessions: true } as const;
export const requireVerifiedInvitationEmail = true;
export const authComponent: ReturnType<typeof createClient<DataModel, typeof schema>> =
  createClient(components.betterAuth, {
    local: { schema },
    authFunctions: internal.auth,
    triggers: createSignalTriggers({
      features,
      lookup: components.betterAuth.authData.lookup,
      markSessionsChanged: internal.authData.markSessionsChanged,
    }),
  });
const siteUrl = process.env.SITE_URL ?? "http://localhost:8099";
// The web app serves Better Auth from its own origin (app/api/auth), so the session is a cookie.
// With COOKIE_DOMAIN, every app under that domain shares it (the browser tests' two origins,
// SITE_URL and SECOND_SITE_URL).
const cookieDomain = process.env.COOKIE_DOMAIN;
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => ({
  baseURL: siteUrl,
  trustedOrigins: [siteUrl, process.env.SECOND_SITE_URL ?? siteUrl, "reactive-auth-example://"],
  database: authComponent.adapter(ctx),
  advanced: {
    database: { generateId: false as const },
    ...(cookieDomain && { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({
        user,
        newEmail,
        url,
      }: {
        user: { email: string };
        newEmail: string;
        url: string;
      }) =>
        sendAuthEmail(ctx, {
          to: user.email,
          subject: `Approve email change to ${newEmail}`,
          url,
        }),
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) =>
      sendAuthEmail(ctx, { to: user.email, subject: "Reset your password", url }),
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) =>
      sendAuthEmail(ctx, { to: user.email, subject: "Verify your email", url }),
  },
  plugins: [
    expo(),
    // Guests (the `/guest` page) are linked when they sign in or up. Keep the guest's user while
    // its page still holds the guest session; an application forgets linked guests later.
    anonymous({ disableDeleteAnonymousUser: true }),
    organization({
      schema: { invitation: { additionalFields: { ticket: { type: "number", required: false } } } },
      requireEmailVerificationOnInvitation: requireVerifiedInvitationEmail,
      sendInvitationEmail: async (data) =>
        sendAuthEmail(ctx, {
          to: data.email,
          subject: "Organization invitation",
          url: `${siteUrl}/?invitationId=${data.id}`,
        }),
    }),
    // Several accounts on one device, each tab acting as one of them.
    multiSession(),
    bearer(),
    deviceAccounts(),
    convex({ authConfig }),
  ],
});
export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();
