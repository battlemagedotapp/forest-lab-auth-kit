import { createSignalQueries } from "@forest-lab/auth-kit/convex";
import { authComponent, features, requireVerifiedInvitationEmail } from "./auth";
import type { DataModel } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { v } from "convex/values";
export { markSessionsChanged } from "@forest-lab/auth-kit/convex";
export const { signals } = createSignalQueries<DataModel>({
  features,
  requireVerifiedInvitationEmail,
  getAuthUser: (ctx) => authComponent.getAuthUser(ctx),
  lookup: components.betterAuth.authData.lookup,
});
export const currentUser = query({
  args: { expectedUserId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.string(),
      email: v.string(),
      image: v.optional(v.union(v.null(), v.string())),
      name: v.string(),
    }),
  ),
  handler: async (ctx, { expectedUserId }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user || user._id !== expectedUserId) return null;
    return { _id: user._id, email: user.email, image: user.image, name: user.name };
  },
});
