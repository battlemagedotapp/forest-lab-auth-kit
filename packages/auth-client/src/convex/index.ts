import {
  defineTable,
  defineSchema,
  type DataModelFromSchemaDefinition,
  type GenericDatabaseReader,
  queryGeneric,
  internalMutationGeneric,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type GenericDataModel,
  type FunctionReference,
  type ApiFromModules,
  type QueryBuilder,
  type SchemaDefinition,
  type GenericSchema,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import type { Triggers } from "@convex-dev/better-auth";
import { v } from "convex/values";
import type { lookup as componentLookup } from "./component.js";
import type { Features, ResourceDependency } from "../signal-protocol.js";
const scope = v.union(
  v.literal("directory"),
  v.literal("organization"),
  v.literal("profile"),
  v.literal("invitations"),
  v.literal("sessions"),
  v.literal("invitation"),
  v.literal("passkeys"),
);
export const authSignalTables = {
  authSignals: defineTable({ scope, subject: v.string(), revision: v.number() }).index(
    "scope_subject",
    ["scope", "subject"],
  ),
};
type MutationCtx = GenericMutationCtx<GenericDataModel>;
const signalSchema = defineSchema(authSignalTables);
type SignalDataModel = DataModelFromSchemaDefinition<typeof signalSchema>;
async function find<DataModel extends GenericDataModel>(
  ctx: GenericQueryCtx<DataModel>,
  dependency: ResourceDependency,
) {
  // The application registers authSignalTables. Narrow only the library-owned
  // table access; application callbacks retain their generated data model.
  const db = ctx.db as unknown as GenericDatabaseReader<SignalDataModel>;
  return db
    .query("authSignals")
    .withIndex("scope_subject", (q) =>
      q.eq("scope", dependency.scope).eq("subject", dependency.subject),
    )
    .unique();
}
export async function markSignal(ctx: MutationCtx, dependency: ResourceDependency) {
  const row = await find(ctx, dependency);
  if (row) await ctx.db.patch(row._id, { revision: row.revision + 1 });
  else
    await ctx.db.insert("authSignals", {
      scope: dependency.scope,
      subject: dependency.subject,
      revision: 1,
    });
}
export const markSessionsChanged = internalMutationGeneric({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await markSignal(ctx, { scope: "sessions", subject: userId });
    return null;
  },
});
type Lookup = ApiFromModules<{
  component: { lookup: typeof componentLookup };
}>["component"]["lookup"];
export type ComponentLookupReference = FunctionReference<
  "query",
  "public" | "internal",
  FunctionArgs<Lookup>,
  FunctionReturnType<Lookup>
>;
export type BackendOptions<DataModel extends GenericDataModel = GenericDataModel> = {
  features: Features;
  getAuthUser: (
    ctx: GenericQueryCtx<DataModel>,
  ) => Promise<{ _id?: string; id?: string; email: string; emailVerified?: boolean } | null>;
  lookup: ComponentLookupReference;
  /** Pass the effective policy from the same Better Auth organization options. */
  requireVerifiedInvitationEmail: boolean;
};
export function createSignalQueries<DataModel extends GenericDataModel = GenericDataModel>(
  options: BackendOptions<DataModel>,
) {
  const query = queryGeneric as QueryBuilder<DataModel, "public">;
  return {
    signals: query({
      args: {
        dependencies: v.array(
          v.object({ scope, subject: v.string(), organizationId: v.optional(v.string()) }),
        ),
      },
      returns: v.object({
        protocol: v.literal(1),
        features: v.object({
          organization: v.optional(v.boolean()),
          sessions: v.optional(v.boolean()),
          passkeys: v.optional(v.boolean()),
        }),
        userId: v.string(),
        denied: v.boolean(),
        revisions: v.array(v.number()),
      }),
      handler: async (ctx, { dependencies }) => {
        if (dependencies.length > 100) throw new Error("At most 100 dependencies per request");
        const user = await options.getAuthUser(ctx);
        if (!user) throw new Error("Unauthenticated");
        const userId = user._id ?? user.id;
        if (!userId) throw new Error("Authenticated user is missing its ID");
        const revisions: number[] = [];
        let denied = false;
        const lookup = (args: FunctionArgs<Lookup>) => ctx.runQuery(options.lookup, args);
        for (const dep of dependencies) {
          if (
            (dep.scope === "sessions" && !options.features.sessions) ||
            (dep.scope === "passkeys" && !options.features.passkeys) ||
            (dep.scope !== "sessions" && dep.scope !== "passkeys" && !options.features.organization)
          )
            throw new Error("Disabled reactive capability");
          let allowed = false;
          const related: ResourceDependency[] = [];
          if (["directory", "invitations", "sessions", "passkeys"].includes(dep.scope))
            allowed = dep.subject === userId;
          if (dep.scope === "organization") {
            let organizationId = dep.subject;
            if (organizationId.startsWith("slug:")) {
              const org = await lookup({ model: "organization", slug: organizationId.slice(5) });
              organizationId = org?._id ?? "";
              if (org) related.push({ scope: "organization", subject: organizationId });
            }
            allowed = Boolean(
              organizationId && (await lookup({ model: "member", organizationId, userId })),
            );
          }
          if (dep.scope === "profile" && dep.organizationId)
            allowed =
              Boolean(
                await lookup({ model: "member", organizationId: dep.organizationId, userId }),
              ) &&
              Boolean(
                await lookup({
                  model: "member",
                  organizationId: dep.organizationId,
                  userId: dep.subject,
                }),
              );
          if (dep.scope === "invitation") {
            const invitation = await lookup({ model: "invitation", id: dep.subject });
            allowed = Boolean(
              invitation &&
              invitation.email?.toLowerCase() === user.email.toLowerCase() &&
              (!options.requireVerifiedInvitationEmail || user.emailVerified),
            );
            if (allowed && invitation?.organizationId && invitation.inviterId) {
              related.push(
                { scope: "organization", subject: invitation.organizationId },
                { scope: "profile", subject: invitation.inviterId },
              );
            }
          }
          if (!allowed) {
            denied = true;
            revisions.push(0);
            continue;
          }
          // Do not sum joined counters: a new subject can have a lower counter
          // that cancels out the invitation's own increment.
          revisions.push((await find(ctx, dep))?.revision ?? 0);
          for (const other of related) revisions.push((await find(ctx, other))?.revision ?? 0);
        }
        return { protocol: 1 as const, features: options.features, userId, denied, revisions };
      },
    }),
  };
}
type Doc = Record<string, unknown>;
type Trigger = (ctx: MutationCtx, doc: Doc, previous?: Doc) => Promise<void>;
export type SignalTriggers = Record<
  string,
  { onCreate?: Trigger; onUpdate?: Trigger; onDelete?: Trigger }
>;
export function composeTriggers<
  DataModel extends GenericDataModel,
  Schema extends SchemaDefinition<GenericSchema, boolean>,
>(...sets: Triggers<DataModel, Schema>[]): Triggers<DataModel, Schema>;
export function composeTriggers(...sets: SignalTriggers[]): SignalTriggers;
export function composeTriggers(...sets: object[]): object {
  const result: SignalTriggers = {};
  for (const set of sets)
    for (const [table, hooks] of Object.entries(set as SignalTriggers))
      for (const event of ["onCreate", "onUpdate", "onDelete"] as const) {
        const next = hooks[event];
        if (!next) continue;
        const prior = result[table]?.[event];
        result[table] ??= {};
        result[table][event] = async (ctx, doc, old) => {
          await prior?.(ctx, doc, old);
          await next(ctx, doc, old);
        };
      }
  return result;
}
export function createSignalTriggers(options: {
  features: Features;
  lookup: BackendOptions["lookup"];
  markSessionsChanged: FunctionReference<"mutation", "internal", { userId: string }, null>;
}): SignalTriggers {
  const result: SignalTriggers = {};
  const change =
    (table: string): Trigger =>
    async (ctx, doc, old) => {
      const deps = new Map<string, ResourceDependency>();
      const add = (scope: ResourceDependency["scope"], subject: unknown) => {
        if (typeof subject !== "string" || !subject)
          throw new Error(`Missing subject for ${scope} signal`);
        if (subject) deps.set(scope + ":" + subject, { scope, subject });
      };
      for (const item of old ? [doc, old] : [doc]) {
        if (table === "organization") {
          add("organization", item._id);
          if (typeof item.slug === "string") add("organization", "slug:" + item.slug);
        }
        if (table === "member") {
          add("directory", item.userId);
          add("organization", item.organizationId);
        }
        if (table === "user") {
          add("profile", item._id);
          add("invitations", item._id);
        }
        if (table === "invitation") {
          if (typeof item.email !== "string") throw new Error("Invitation is missing its email");
          add("invitation", item._id);
          add("organization", item.organizationId);
          const recipient = await ctx.runQuery(options.lookup, {
            model: "user",
            email: item.email,
          });
          if (recipient) add("invitations", recipient._id);
        }
        if (table === "session") add("sessions", item.userId);
        if (table === "passkey") add("passkeys", item.userId);
      }
      for (const dep of deps.values()) await markSignal(ctx, dep);
    };
  if (options.features.organization)
    for (const table of ["organization", "member", "invitation", "user"])
      result[table] = { onCreate: change(table), onUpdate: change(table), onDelete: change(table) };
  // A person's sessions share one signal row, so marking it inside the mutation that signs them in
  // would make concurrent sign-ins of one account conflict on it until Convex gives up. The mark
  // runs after the session's change instead, as its own mutation.
  const sessionsChanged: Trigger = async (ctx, doc) => {
    if (typeof doc.userId !== "string") throw new Error("Session is missing its userId");
    await ctx.scheduler.runAfter(0, options.markSessionsChanged, { userId: doc.userId });
  };
  if (options.features.sessions)
    result.session = {
      onCreate: sessionsChanged,
      onUpdate: sessionsChanged,
      onDelete: sessionsChanged,
    };
  if (options.features.passkeys)
    result.passkey = {
      onCreate: change("passkey"),
      onUpdate: change("passkey"),
      onDelete: change("passkey"),
    };
  if (options.features.passkeys)
    result.passkey = {
      onCreate: change("passkey"),
      onUpdate: change("passkey"),
      onDelete: change("passkey"),
    };
  return result;
}
