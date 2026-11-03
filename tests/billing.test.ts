import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  applyWebhookEvent,
  balanceLevel,
  billingTables,
  charge,
  createCheckout,
  defineCatalog,
  expireCredit,
  grant,
  history,
  signWebhook,
  verifyWebhook,
  wallet,
} from "../packages/auth-client/src/convex/billing.js";

const catalog = defineCatalog({
  currency: "JPY",
  creditMonths: 24,
  packs: [
    {
      id: "jpy500",
      price: 500,
      credit: 500,
      products: { test_mode: "pdt_500", live_mode: undefined },
    },
    {
      id: "jpy3000",
      price: 3000,
      credit: 3150,
      products: { test_mode: "pdt_3000", live_mode: undefined },
    },
  ],
});

const setup = () =>
  convexTest(defineSchema({ ...billingTables }), {
    "./_generated/server.js": async () => import("convex/server"),
  });

const paid = (paymentId: string, pack = "jpy500", owner = "org_a", product = "pdt_500") => ({
  id: `msg_${paymentId}`,
  type: "payment.succeeded",
  data: {
    payment_id: paymentId,
    metadata: { owner, pack },
    product_cart: [{ product_id: product, quantity: 1 }],
    total_amount: 500,
    currency: "JPY",
  },
});

describe("ledger", () => {
  it("grants and charges once per key, and never goes negative unless debt is allowed", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      expect(
        (await grant(ctx, { owner: "o", amount: 1000, key: "g1", reason: "test" })).applied,
      ).toBe(true);
      expect(
        (await grant(ctx, { owner: "o", amount: 1000, key: "g1", reason: "test" })).applied,
      ).toBe(false);
      expect(await charge(ctx, { owner: "o", amount: 300, key: "c1", reason: "task" })).toEqual({
        ok: true,
        applied: true,
        balance: 700,
      });
      expect((await charge(ctx, { owner: "o", amount: 300, key: "c1", reason: "task" })).ok).toBe(
        true,
      );
      expect(await charge(ctx, { owner: "o", amount: 800, key: "c2", reason: "task" })).toEqual({
        ok: false,
        balance: 700,
        shortBy: 100,
      });
      expect((await wallet(ctx, "o")).balance).toBe(700);
      expect(
        await charge(ctx, {
          owner: "o",
          amount: 800,
          key: "c3",
          reason: "storage",
          allowDebt: true,
        }),
      ).toEqual({
        ok: true,
        applied: true,
        balance: -100,
      });
      // a grant repays the debt first; only the rest is usable credit
      await grant(ctx, { owner: "o", amount: 500, key: "g2", reason: "test" });
      expect((await wallet(ctx, "o")).balance).toBe(400);
      const lots = await ctx.db.query("billingLots").collect();
      expect(lots.map((l) => l.remaining)).toEqual([0, 400]);
      const page = await history(ctx, "o", { numItems: 10, cursor: null });
      expect(page.page.map((e) => [e.kind, e.amount, e.balance])).toEqual([
        ["grant", 500, 400],
        ["charge", -800, -100],
        ["charge", -300, 700],
        ["grant", 1000, 1000],
      ]);
    });
  });

  it("rejects non-integer and non-positive amounts", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await expect(grant(ctx, { owner: "o", amount: 1.5, key: "x", reason: "" })).rejects.toThrow();
      await expect(charge(ctx, { owner: "o", amount: 0, key: "y", reason: "" })).rejects.toThrow();
    });
  });

  it("charges the soonest-expiring credit first and expires what is left", async () => {
    const t = setup();
    const now = Date.UTC(2026, 0, 1);
    await t.run(async (ctx) => {
      await grant(ctx, { owner: "o", amount: 500, key: "late", reason: "", expiresAt: now + 2000 });
      await grant(ctx, { owner: "o", amount: 500, key: "soon", reason: "", expiresAt: now + 1000 });
      await charge(ctx, { owner: "o", amount: 300, key: "c", reason: "" });
      expect((await wallet(ctx, "o")).nextExpiry).toEqual({ at: now + 1000, amount: 200 });
      expect(await expireCredit(ctx, now + 1500)).toBe(1);
      expect(await expireCredit(ctx, now + 1500)).toBe(0);
      expect((await wallet(ctx, "o")).balance).toBe(500);
    });
  });

  it("serializes concurrent charges: the balance is never overdrawn", async () => {
    const t = setup();
    await t.run((ctx) => grant(ctx, { owner: "o", amount: 1000, key: "g", reason: "" }));
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        t.run((ctx) => charge(ctx, { owner: "o", amount: 300, key: `c${i}`, reason: "" })),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await t.run(async (ctx) => (await wallet(ctx, "o")).balance)).toBe(100);
  });

  it("reports levels relative to the last top-up", () => {
    expect(balanceLevel(0, 0)).toBe("ok");
    expect(balanceLevel(400, 1000)).toBe("ok");
    expect(balanceLevel(300, 1000)).toBe("low");
    expect(balanceLevel(100, 1000)).toBe("critical");
    expect(balanceLevel(0, 1000)).toBe("empty");
    expect(balanceLevel(-5, 1000)).toBe("empty");
  });

  it("adds calendar months, clamped to the month's end", () => {
    expect(new Date(addMonths(Date.UTC(2026, 0, 31), 1)).toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
    expect(new Date(addMonths(Date.UTC(2026, 10, 3), 24)).toISOString().slice(0, 10)).toBe(
      "2028-11-03",
    );
  });
});

describe("Dodo events", () => {
  it("grants a pack's credit once per payment, with its expiry", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      expect(await applyWebhookEvent(ctx, catalog, "test_mode", paid("pay_1"))).toEqual({
        status: "granted",
        owner: "org_a",
        amount: 500,
      });
      expect((await applyWebhookEvent(ctx, catalog, "test_mode", paid("pay_1"))).status).toBe(
        "duplicate",
      );
      const w = await wallet(ctx, "org_a");
      expect(w.balance).toBe(500);
      expect(w.lastTopUp).toBe(500);
      expect(w.nextExpiry!.at).toBeGreaterThan(Date.now() + 700 * 86400_000);
    });
  });

  it("ignores payments that are not ours or whose cart does not match the pack", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const other = { ...paid("pay_x"), data: { ...paid("pay_x").data, metadata: {} } };
      expect((await applyWebhookEvent(ctx, catalog, "test_mode", other)).status).toBe("ignored");
      // metadata claims the big pack but the cart holds the small product
      expect(
        (await applyWebhookEvent(ctx, catalog, "test_mode", paid("pay_y", "jpy3000"))).status,
      ).toBe("ignored");
      expect(
        (
          await applyWebhookEvent(ctx, catalog, "test_mode", {
            id: "m",
            type: "payment.failed",
            data: {},
          })
        ).status,
      ).toBe("ignored");
      expect((await wallet(ctx, "org_a")).balance).toBe(0);
    });
  });

  it("takes back refunded credit (full or partial) once per refund", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await applyWebhookEvent(
        ctx,
        catalog,
        "test_mode",
        paid("pay_3k", "jpy3000", "org_a", "pdt_3000"),
      );
      await ctx.db.patch((await ctx.db.query("billingPurchases").first())!._id, {
        totalAmount: 3000,
      });
      const partial = {
        id: "m1",
        type: "refund.succeeded",
        data: { refund_id: "ref_1", payment_id: "pay_3k", amount: 1000, is_partial: true },
      };
      expect(await applyWebhookEvent(ctx, catalog, "test_mode", partial)).toEqual({
        status: "refunded",
        owner: "org_a",
        amount: 1050,
      });
      expect((await applyWebhookEvent(ctx, catalog, "test_mode", partial)).status).toBe(
        "duplicate",
      );
      const full = {
        id: "m2",
        type: "refund.succeeded",
        data: { refund_id: "ref_2", payment_id: "pay_3k", is_partial: false },
      };
      expect((await applyWebhookEvent(ctx, catalog, "test_mode", full)) as unknown).toMatchObject({
        amount: 2100,
      });
      expect((await wallet(ctx, "org_a")).balance).toBe(0);
    });
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_" + btoa("0123456789abcdef0123456789abcdef");
  const request = async (body: string, opts: { ts?: number; sig?: string } = {}) => {
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = opts.sig ?? (await signWebhook(secret, "msg_1", ts, body));
    return new Request("https://x/webhook", {
      method: "POST",
      body,
      headers: { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
    });
  };
  const body = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "p" } });

  it("accepts a valid signature", async () => {
    const event = await verifyWebhook(await request(body), secret);
    expect(event).toEqual({ id: "msg_1", type: "payment.succeeded", data: { payment_id: "p" } });
  });
  it("rejects a tampered body, a wrong signature and an old timestamp", async () => {
    const good = await request(body);
    const tampered = new Request(good.url, {
      method: "POST",
      headers: good.headers,
      body: body.replace('"p"', '"q"'),
    });
    await expect(verifyWebhook(tampered, secret)).rejects.toThrow("Invalid webhook signature");
    await expect(verifyWebhook(await request(body, { sig: "AAAA" }), secret)).rejects.toThrow();
    await expect(
      verifyWebhook(await request(body, { ts: Math.floor(Date.now() / 1000) - 600 }), secret),
    ).rejects.toThrow("timestamp");
  });
});

describe("checkout", () => {
  it("creates a hosted checkout for the pack's product with the owner in metadata", async () => {
    let sent: { url: string; body: any; auth: string | null } | undefined;
    const url = await createCheckout({
      catalog,
      mode: "test_mode",
      apiKey: "sk_test",
      owner: "org_a",
      packId: "jpy500",
      customer: { email: "a@example.com" },
      returnUrl: "https://app/billing",
      fetch: async (u, init) => {
        sent = {
          url: u as string,
          body: JSON.parse(init!.body as string),
          auth: new Headers(init!.headers).get("Authorization"),
        };
        return Response.json({
          checkout_url: "https://test.checkout.dodopayments.com/session/cks_1",
        });
      },
    });
    expect(url).toBe("https://test.checkout.dodopayments.com/session/cks_1");
    expect(sent).toEqual({
      url: "https://test.dodopayments.com/checkouts",
      auth: "Bearer sk_test",
      body: {
        product_cart: [{ product_id: "pdt_500", quantity: 1 }],
        customer: { email: "a@example.com" },
        metadata: { owner: "org_a", pack: "jpy500" },
        return_url: "https://app/billing",
      },
    });
    await expect(
      createCheckout({
        catalog,
        mode: "live_mode",
        apiKey: "k",
        owner: "o",
        packId: "jpy500",
        customer: { email: "a@b" },
        returnUrl: "x",
      }),
    ).rejects.toThrow("Unknown pack");
  });
});
