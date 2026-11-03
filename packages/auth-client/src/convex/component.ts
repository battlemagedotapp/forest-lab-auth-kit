import { queryGeneric, type IndexRangeBuilder } from "convex/server";
import { v, type Infer, type GenericId } from "convex/values";
const metadata = v.union(
  v.null(),
  v.object({
    _id: v.string(),
    email: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    inviterId: v.optional(v.string()),
    role: v.optional(v.string()),
  }),
);
export type LookupMetadata = Infer<typeof metadata>;
/** Register inside the local Better Auth component, never in the parent app. */
export const lookup = queryGeneric({
  args: {
    model: v.union(
      v.literal("member"),
      v.literal("invitation"),
      v.literal("user"),
      v.literal("organization"),
    ),
    id: v.optional(v.string()),
    slug: v.optional(v.string()),
    userId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: metadata,
  handler: async (ctx, args): Promise<LookupMetadata> => {
    if (args.model === "organization" && args.slug) {
      const row = await ctx.db
        .query("organization")
        .withIndex("slug", (q) => q.eq("slug", args.slug))
        .unique();
      return row ? { _id: row._id } : null;
    }
    if (args.id) {
      const id = ctx.db.normalizeId(args.model, args.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row) return null;
      return args.model === "invitation"
        ? {
            _id: row._id,
            email: row.email,
            organizationId: row.organizationId,
            inviterId: row.inviterId,
          }
        : { _id: row._id };
    }
    if (args.model === "member" && args.organizationId && args.userId) {
      const row = await ctx.db
        .query("member")
        .withIndex("organizationId_userId", (q) =>
          // The local-install contract requires this compound index.
          (
            q as IndexRangeBuilder<
              {
                _id: GenericId<"member">;
                _creationTime: number;
                organizationId: string;
                userId: string;
              },
              ["organizationId", "userId"],
              0
            >
          )
            .eq("organizationId", args.organizationId!)
            .eq("userId", args.userId!),
        )
        .unique();
      return row ? { _id: row._id, role: row.role } : null;
    }
    if (args.model === "user" && args.email) {
      const row = await ctx.db
        .query("user")
        .withIndex("email_name", (q) => q.eq("email", args.email!.trim().toLowerCase()))
        .first();
      return row ? { _id: row._id } : null;
    }
    throw new Error("Unsupported component lookup");
  },
});
