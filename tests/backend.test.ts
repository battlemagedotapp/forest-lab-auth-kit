import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, it } from "vitest";
import {
  authSignalTables,
  markSignal,
  composeTriggers,
  createSignalTriggers,
} from "../packages/auth-client/src/convex/index.js";
import {
  dependencies,
  nextExpiry,
} from "../packages/auth-client/src/cache/resource-dependencies.js";
it("increments scoped revisions transactionally and retains unrelated rows", async () => {
  const t = convexTest(defineSchema({ ...authSignalTables }), {
    "./_generated/server.js": async () => import("convex/server"),
  });
  await t.run(async (ctx) => {
    await markSignal(ctx, { scope: "directory", subject: "a" });
    await markSignal(ctx, { scope: "directory", subject: "a" });
    await markSignal(ctx, { scope: "directory", subject: "b" });
  });
  const rows = await t.run((ctx) => ctx.db.query("authSignals").collect());
  expect(rows.map((r) => [r.subject, r.revision])).toEqual([
    ["a", 2],
    ["b", 1],
  ]);
  await expect(
    t.run(async (ctx) => {
      await markSignal(ctx, { scope: "directory", subject: "a" });
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect((await t.run((ctx) => ctx.db.query("authSignals").collect()))[0]?.revision).toBe(2);
});
it("marks the owner's passkeys signal whenever a passkey is added, used or removed", async () => {
  const { makeFunctionReference } = await import("convex/server");
  const triggers = createSignalTriggers({
    features: { passkeys: true },
    lookup: makeFunctionReference("lookup:lookup"),
    markSessionsChanged: makeFunctionReference<"mutation", { userId: string }, null>(
      "auth:markSessionsChanged",
    ) as any,
  });
  const t = convexTest(defineSchema({ ...authSignalTables }), {
    "./_generated/server.js": async () => import("convex/server"),
  });
  const passkey = { _id: "passkey", userId: "owner" };
  await t.run(async (ctx) => {
    await triggers.passkey?.onCreate?.(ctx as any, passkey);
    await triggers.passkey?.onUpdate?.(ctx as any, { ...passkey, counter: 1 }, passkey);
    await triggers.passkey?.onDelete?.(ctx as any, passkey);
  });
  const rows = await t.run((ctx) => ctx.db.query("authSignals").collect());
  expect(rows.map((r) => [r.scope, r.subject, r.revision])).toEqual([["passkeys", "owner", 3]]);
});
it("marks a person's sessions signal after the change, so sign-ins of one account never conflict", async () => {
  const { makeFunctionReference } = await import("convex/server");
  const triggers = createSignalTriggers({
    features: { sessions: true },
    lookup: makeFunctionReference("lookup:lookup"),
    markSessionsChanged: makeFunctionReference<"mutation", { userId: string }, null>(
      "auth:markSessionsChanged",
    ) as any,
  });
  const t = convexTest(defineSchema({ ...authSignalTables }), {
    "./_generated/server.js": async () => import("convex/server"),
  });
  const session = { _id: "session", userId: "owner" };
  await t.run(async (ctx) => {
    await triggers.session?.onCreate?.(ctx as any, session);
    await triggers.session?.onUpdate?.(ctx as any, { ...session, updatedAt: 1 }, session);
    await triggers.session?.onDelete?.(ctx as any, session);
  });
  const [rows, scheduled] = await t.run(async (ctx) => [
    await ctx.db.query("authSignals").collect(),
    await ctx.db.system.query("_scheduled_functions").collect(),
  ]);
  expect(rows).toEqual([]);
  expect(scheduled.map((job) => [job.name, job.args])).toEqual(
    Array(3).fill(["auth:markSessionsChanged", [{ userId: "owner" }]]),
  );
});
it("composes application triggers first and propagates rejection", async () => {
  const calls: string[] = [];
  const hooks = composeTriggers(
    {
      member: {
        onCreate: async () => {
          calls.push("app");
        },
      },
    },
    {
      member: {
        onCreate: async () => {
          calls.push("library");
        },
      },
    },
  );
  await hooks.member?.onCreate?.({} as any, {});
  expect(calls).toEqual(["app", "library"]);
  const failure = composeTriggers(
    {
      member: {
        onDelete: async () => {
          throw new Error("denied");
        },
      },
    },
    {
      member: {
        onDelete: async () => {
          calls.push("unexpected");
        },
      },
    },
  );
  await expect(failure.member?.onDelete?.({} as any, {})).rejects.toThrow("denied");
  expect(calls).not.toContain("unexpected");
});
it("tracks returned directory and member dependencies without directory fan-out", () => {
  expect(dependencies("list", {}, [{ id: "b" }, { id: "a" }], "user")).toContainEqual({
    scope: "organization",
    subject: "b",
  });
  expect(
    dependencies(
      "listMembers",
      { organizationId: "a" },
      { members: [{ userId: "member" }] },
      "user",
    ),
  ).toContainEqual({ scope: "profile", subject: "member", organizationId: "a" });
});
it("selects future expiry only, preserving already-expired endpoint payloads", () => {
  const data = [{ expiresAt: 1 }, { expiresAt: 200 }, { expiresAt: new Date(300) }];
  expect(nextExpiry(data, 100)).toBe(200);
  expect(nextExpiry(data, 400)).toBeUndefined();
  expect(data).toHaveLength(3);
});

it("authorizes signal scopes and enforces invitation verification and protocol", async () => {
  const { defineTable, makeFunctionReference } = await import("convex/server");
  const { v } = await import("convex/values");
  const { createSignalQueries } = await import("../packages/auth-client/src/convex/index.js");
  const { lookup } = await import("../packages/auth-client/src/convex/component.js");
  const schema = defineSchema({
    ...authSignalTables,
    member: defineTable({ organizationId: v.string(), userId: v.string() }).index(
      "organizationId_userId",
      ["organizationId", "userId"],
    ),
    invitation: defineTable({
      email: v.string(),
      organizationId: v.string(),
      inviterId: v.string(),
      privateNote: v.optional(v.string()),
    }),
  });
  const { signals } = createSignalQueries({
    features: { organization: true, sessions: true, passkeys: true },
    lookup: makeFunctionReference("lookup:lookup"),
    requireVerifiedInvitationEmail: true,
    getAuthUser: async (ctx) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity
        ? {
            id: identity.subject,
            email: "recipient@example.com",
            emailVerified: identity.emailVerified === true,
          }
        : null;
    },
  });
  const t = convexTest(schema, {
    "./_generated/server.js": async () => import("convex/server"),
    "./auth.ts": async () => ({ signals }),
    "./lookup.ts": async () => ({ lookup }),
  });
  const invitation = await t.run(async (ctx) => {
    await ctx.db.insert("member", { organizationId: "org", userId: "owner" });
    return ctx.db.insert("invitation", {
      email: "recipient@example.com",
      organizationId: "org",
      inviterId: "owner",
      privateNote: "not needed by the bridge",
    });
  });
  expect(
    await t.query(makeFunctionReference<"query">("lookup:lookup"), {
      model: "invitation",
      id: invitation,
    }),
  ).toEqual({
    _id: invitation,
    email: "recipient@example.com",
    organizationId: "org",
    inviterId: "owner",
  });
  const ref = makeFunctionReference<"query">("auth:signals");
  const owner = t.withIdentity({ subject: "owner" });
  const outsider = t.withIdentity({ subject: "outsider" });
  expect(
    (await owner.query(ref, { dependencies: [{ scope: "organization", subject: "org" }] })).denied,
  ).toBe(false);
  expect(
    (await outsider.query(ref, { dependencies: [{ scope: "organization", subject: "org" }] }))
      .denied,
  ).toBe(true);
  expect(
    (await outsider.query(ref, { dependencies: [{ scope: "sessions", subject: "owner" }] })).denied,
  ).toBe(true);
  expect(
    (await outsider.query(ref, { dependencies: [{ scope: "passkeys", subject: "owner" }] })).denied,
  ).toBe(true);
  expect(
    (await owner.query(ref, { dependencies: [{ scope: "passkeys", subject: "owner" }] })).denied,
  ).toBe(false);
  expect(
    (await outsider.query(ref, { dependencies: [{ scope: "invitation", subject: invitation }] }))
      .denied,
  ).toBe(true);
  const verified = t.withIdentity({ subject: "recipient", emailVerified: true });
  expect(
    (await verified.query(ref, { dependencies: [{ scope: "invitation", subject: invitation }] }))
      .denied,
  ).toBe(false);
  await t.run(async (ctx) => {
    await markSignal(ctx, { scope: "profile", subject: "owner" });
    await markSignal(ctx, { scope: "profile", subject: "owner" });
    await markSignal(ctx, { scope: "profile", subject: "new-inviter" });
  });
  const before = await verified.query(ref, {
    dependencies: [{ scope: "invitation", subject: invitation }],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(invitation, { inviterId: "new-inviter" });
    await markSignal(ctx, { scope: "invitation", subject: invitation });
  });
  const after = await verified.query(ref, {
    dependencies: [{ scope: "invitation", subject: invitation }],
  });
  // Equal sums must still produce a changed subscription snapshot.
  expect(before.revisions.reduce((a: number, b: number) => a + b, 0)).toBe(
    after.revisions.reduce((a: number, b: number) => a + b, 0),
  );
  expect(before.revisions).not.toEqual(after.revisions);
  await expect(
    owner.query(ref, {
      dependencies: Array.from({ length: 101 }, () => ({ scope: "organization", subject: "org" })),
    }),
  ).rejects.toThrow("100");
  await expect(t.query(ref, { dependencies: [] })).rejects.toThrow("Unauthenticated");
});
