/**
 * Prepaid billing for organizations: members read their organization's wallet, owners and admins buy top-ups
 * (Dodo hosted checkout), Dodo's webhook grants the credit, and the app charges it with `charge`.
 *
 * Env: DODO_PAYMENTS_ENVIRONMENT (test_mode | live_mode), DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_SECRET.
 */
import {
  applyWebhookEvent,
  billingMode,
  createCheckout,
  defineCatalog,
  expireCredit,
  history,
  verifyWebhook,
  wallet as readWallet,
  walletValidator,
  webhookEventValidator,
} from "@strawdev/auth-client/convex/billing";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { authComponent } from "./auth";

export const catalog = defineCatalog({
  currency: "JPY",
  creditMonths: 24,
  packs: [
    {
      id: "jpy500",
      price: 500,
      credit: 500,
      products: { test_mode: "pdt_0Nr76pU3cy4TbomloU2cg", live_mode: undefined },
    },
    {
      id: "jpy1000",
      price: 1000,
      credit: 1000,
      products: { test_mode: "pdt_0Nr76upNe6encMwgQ47QQ", live_mode: undefined },
    },
    {
      id: "jpy3000",
      price: 3000,
      credit: 3150,
      products: { test_mode: "pdt_0Nr76xK270Inah6i1tfF0", live_mode: undefined },
    },
    {
      id: "jpy10000",
      price: 10000,
      credit: 11000,
      products: { test_mode: "pdt_0Nr76zotNVn8NhRil96lm", live_mode: undefined },
    },
  ],
});

const mode = () => billingMode(process.env.DODO_PAYMENTS_ENVIRONMENT ?? "test_mode");

/** The signed-in member of `organizationId`, or an error; `buyer` also requires owner or admin. */
async function member(ctx: QueryCtx, organizationId: string, buyer = false) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new Error("Not signed in");
  const row = await ctx.runQuery(components.betterAuth.authData.lookup, {
    model: "member",
    organizationId,
    userId: user._id,
  });
  if (!row) throw new Error("Not a member of this organization");
  if (buyer && !["owner", "admin"].includes(row.role ?? ""))
    throw new Error("Only owners and admins can buy credit");
  return user;
}

export const wallet = query({
  args: { organizationId: v.string() },
  returns: walletValidator,
  handler: async (ctx, { organizationId }) => {
    await member(ctx, organizationId);
    return readWallet(ctx, organizationId);
  },
});

export const ledger = query({
  args: { organizationId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { organizationId, paginationOpts }) => {
    await member(ctx, organizationId);
    return history(ctx, organizationId, paginationOpts);
  },
});

export const buyer = internalQuery({
  args: { organizationId: v.string() },
  returns: v.object({ email: v.string(), name: v.string() }),
  handler: async (ctx, { organizationId }) => {
    const user = await member(ctx, organizationId, true);
    return { email: user.email, name: user.name };
  },
});

export const checkout = action({
  args: { owner: v.string(), packId: v.string() },
  returns: v.string(),
  handler: async (ctx, { owner, packId }): Promise<string> => {
    const customer: { email: string; name: string } = await ctx.runQuery(internal.billing.buyer, {
      organizationId: owner,
    });
    return createCheckout({
      catalog,
      mode: mode(),
      apiKey: process.env.DODO_PAYMENTS_API_KEY!,
      owner,
      packId,
      customer,
      returnUrl: `${process.env.SITE_URL ?? "http://localhost:8099"}/?billing=${owner}`,
    });
  },
});

export const apply = internalMutation({
  args: { event: webhookEventValidator },
  handler: (ctx, { event }) => applyWebhookEvent(ctx, catalog, mode(), event),
});

export const expire = internalMutation({
  args: {},
  handler: (ctx) => expireCredit(ctx),
});

/** POST /dodo-webhook: verify, then apply in one mutation (replays are no-ops). */
export const webhook = httpAction(async (ctx, request) => {
  let event;
  try {
    event = await verifyWebhook(request, process.env.DODO_PAYMENTS_WEBHOOK_SECRET!);
  } catch (e) {
    return new Response(String(e), { status: 401 });
  }
  const result = await ctx.runMutation(internal.billing.apply, { event });
  console.log("dodo", event.type, event.id, JSON.stringify(result));
  return Response.json({ received: true });
});
