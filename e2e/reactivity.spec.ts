import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Isolated local fixtures exercise time/policy boundaries without adding public test endpoints.
function updateFixture(
  model: "invitation" | "user" | "session",
  field: "_id" | "email",
  value: string,
  update: Record<string, unknown>,
) {
  execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "run",
      "--deployment",
      "local",
      "--component",
      "betterAuth",
      "adapter:updateOne",
      JSON.stringify({ input: { model, where: [{ field, value }], update } }),
    ],
    {
      cwd: fileURLToPath(new URL("../examples/backend", import.meta.url)),
      stdio: "pipe",
    },
  );
}
async function signUp(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Sign-up email", { exact: true }).fill(email);
  await page.getByLabel("Sign-up password", { exact: true }).fill("Example-password-123!");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  let url = "";
  await expect
    .poll(async () => {
      const messages = (await (await fetch("http://127.0.0.1:8025")).json()) as {
        to: string;
        url: string;
      }[];
      url = messages.findLast((m) => m.to === email)?.url ?? "";
      return url;
    })
    .toBeTruthy();
  await page.goto(url);
  await page.goto("/");
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  const signInEmail = page.getByLabel("Email", { exact: true });
  await expect(signOut.or(signInEmail)).toBeVisible();
  if (await signInEmail.isVisible()) {
    await signInEmail.fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Example-password-123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(signOut).toBeVisible();
}

test("failed deletion and failed completion refresh do not navigate or repeat the write", async ({
  page,
}) => {
  const suffix = Date.now();
  await signUp(page, `delete-recovery-${suffix}@example.com`);
  const name = `Recovery ${suffix}`;
  await page.getByLabel("Organization name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create organization", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByLabel("Rename organization")).toHaveValue(name);
  const selectedId = new URL(page.url()).searchParams.get("organizationId");
  expect(selectedId).toBeTruthy();
  let denyWrite = true;
  let failRefresh = false;
  let deleteRequests = 0;
  await page.route(
    (url) => url.pathname.endsWith("/organization/delete"),
    async (route) => {
      deleteRequests++;
      if (denyWrite)
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "TEST_DELETE_DENIED", message: "Deletion denied" }),
        });
      else await route.continue();
    },
  );
  await page.route(
    (url) => url.pathname.endsWith("/organization/list"),
    async (route) => {
      if (failRefresh)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "TEST_REFRESH_UNAVAILABLE",
            message: "Directory unavailable",
          }),
        });
      else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Delete organization", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Forbidden" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("organizationId")).toBe(selectedId);
  denyWrite = false;
  failRefresh = true;
  await page.getByRole("button", { name: "Delete organization", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry organization refresh", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("organizationId")).toBe(selectedId);
  expect(deleteRequests).toBe(2);
  failRefresh = false;
  await page.getByRole("button", { name: "Retry organization refresh", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("organizationId")).toBeNull();
  expect(deleteRequests).toBe(2);
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});

test("session freshness requires application-owned sign-in recovery", async ({ page }) => {
  const email = `freshness-${Date.now()}@example.com`;
  await signUp(page, email);
  const revoke = page.getByRole("button", { name: "Revoke session", exact: true }).first();
  await expect(revoke).toBeVisible();
  const sessionId = await revoke.locator("..").locator("div").first().textContent();
  expect(sessionId).toBeTruthy();
  updateFixture("session", "_id", sessionId!, { createdAt: Date.now() - 2 * 86400000 });
  await page.reload();
  await expect(page.getByText("Sign in again to manage sessions.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke session", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Example-password-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Revoke session", exact: true })).toBeVisible();
  await expect(page.getByText("Sign in again to manage sessions.", { exact: true })).toHaveCount(0);
});
test("two clients receive invitations and membership updates without polling", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const recipient = await browser.newContext();
  const a = await owner.newPage();
  const b = await recipient.newPage();
  const suffix = Date.now();
  const email = `recipient-${suffix}@example.com`;
  await signUp(a, `owner-${suffix}@example.com`);
  await signUp(b, email);
  const name = `Organization ${suffix}`;
  await a.getByLabel("Organization name", { exact: true }).fill(name);
  await a.getByRole("button", { name: "Create organization", exact: true }).click();
  await a.getByRole("button", { name, exact: true }).click();
  await a.getByLabel("Invite email", { exact: true }).fill(email);
  await a.getByRole("button", { name: "Invite member", exact: true }).click();
  await expect(b.getByRole("button", { name: "Accept invitation", exact: true })).toBeVisible();
  await b.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(b.getByText(`Accepted organization-${suffix}`, { exact: true })).toBeVisible();
  await expect(b.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(a.getByText(`${email} (member)`, { exact: true })).toBeVisible();
  await b.getByRole("button", { name, exact: true }).click();
  await a.getByLabel("Rename organization").fill("Renamed " + suffix);
  await a.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(b.getByRole("button", { name: "Renamed " + suffix, exact: true })).toBeVisible();
  const displayName = `Member ${suffix}`;
  await b.getByLabel("Profile name", { exact: true }).fill(displayName);
  await b.getByRole("button", { name: "Update profile", exact: true }).click();
  await expect(a.getByText(`${displayName} (member)`, { exact: true })).toBeVisible();
  const recipientRow = a.getByText(`${displayName} (member)`, { exact: true }).locator("..");
  await recipientRow.getByRole("button", { name: "Make admin", exact: true }).click();
  await expect(b.getByText(`${displayName} (admin)`, { exact: true })).toBeVisible();
  await recipient.setOffline(true);
  await a.getByLabel("Rename organization").fill("Recovered " + suffix);
  await a.getByRole("button", { name: "Rename", exact: true }).click();
  await recipient.setOffline(false);
  await b.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(b.getByRole("button", { name: "Recovered " + suffix, exact: true })).toBeVisible();
  await b.waitForTimeout(1000);
  let reads = 0;
  const count = (request: import("@playwright/test").Request) => {
    if (request.method() === "GET" && request.url().includes("/api/auth/organization/")) reads++;
  };
  b.on("request", count);
  await b.waitForTimeout(5500);
  b.off("request", count);
  expect(reads).toBe(0);
  await a
    .getByText(`${displayName} (admin)`, { exact: true })
    .locator("..")
    .getByRole("button", { name: "Remove member", exact: true })
    .click();
  await expect(b.getByRole("button", { name: "Recovered " + suffix, exact: true })).toHaveCount(0);
  await b.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(b.getByLabel("Email", { exact: true })).toBeVisible();
  await owner.close();
  await recipient.close();
});

test("schema fields reach Better Auth and wrong-recipient, cancelled and expired links retain server behavior", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const recipient = await browser.newContext();
  const outsider = await browser.newContext();
  try {
    const a = await owner.newPage();
    const b = await recipient.newPage();
    const c = await outsider.newPage();
    const suffix = Date.now();
    const email = `schema-recipient-${suffix}@example.com`;
    await signUp(a, `schema-owner-${suffix}@example.com`);
    await signUp(b, email);
    await signUp(c, `outsider-${suffix}@example.com`);
    const name = `Schema ${suffix}`;
    await a.getByLabel("Organization name", { exact: true }).fill(name);
    await a.getByRole("button", { name: "Create organization", exact: true }).click();
    await a.getByRole("button", { name, exact: true }).click();
    const invite = async () => {
      await a.getByLabel("Ticket invite email").fill(email);
      await a.getByLabel("Invitation ticket", { exact: true }).fill("42");
      const response = a.waitForResponse(
        (r) => r.url().endsWith("/organization/invite-member") && r.request().method() === "POST",
      );
      await a.getByRole("button", { name: "Invite with ticket", exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(200);
      const body = (await result.json()) as { id: string; ticket: number };
      expect(body.ticket).toBe(42);
      await expect(a.getByText("Ticket 42", { exact: true })).toBeVisible();
      return body.id;
    };
    const id = await invite();
    const wrong = c.waitForResponse(
      (r) => r.url().includes("/organization/get-invitation") && r.status() === 403,
    );
    await c.goto(`/?invitationId=${id}`);
    expect(await (await wrong).json()).toMatchObject({
      code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
    });
    await expect(
      c.getByRole("button", { name: "Accept linked invitation", exact: true }),
    ).toHaveCount(0);
    await a.getByRole("button", { name: "Cancel invitation", exact: true }).click();
    await expect(a.getByRole("button", { name: "Cancel invitation", exact: true })).toHaveCount(0);
    const cancelled = b.waitForResponse(
      (r) => r.url().includes("/organization/get-invitation") && r.status() === 400,
    );
    await b.goto(`/?invitationId=${id}`);
    expect(await (await cancelled).json()).toMatchObject({ code: "INVITATION_NOT_FOUND" });
    const expiringId = await invite();
    updateFixture("invitation", "_id", expiringId, { expiresAt: Date.now() - 1000 });
    const expired = b
      .waitForResponse(
        (r) =>
          r.url().includes("/organization/get-invitation") &&
          r.url().includes(expiringId) &&
          r.status() === 400,
      )
      .then((response) => response.json());
    await b.goto(`/?invitationId=${expiringId}`);
    expect(await expired).toMatchObject({ code: "INVITATION_NOT_FOUND" });
    await expect(
      b.getByRole("button", { name: "Accept linked invitation", exact: true }),
    ).toHaveCount(0);
  } finally {
    await owner.close();
    await recipient.close();
    await outsider.close();
  }
});

test("recipient verification policy recovers through application-owned verification", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const recipient = await browser.newContext();
  try {
    const a = await owner.newPage();
    const b = await recipient.newPage();
    const suffix = Date.now();
    const email = `verification-recipient-${suffix}@example.com`;
    await signUp(a, `verification-owner-${suffix}@example.com`);
    await signUp(b, email);
    const name = `Verification ${suffix}`;
    await a.getByLabel("Organization name", { exact: true }).fill(name);
    await a.getByRole("button", { name: "Create organization", exact: true }).click();
    await a.getByRole("button", { name, exact: true }).click();
    await a.getByLabel("Invite email", { exact: true }).fill(email);
    const response = a.waitForResponse(
      (r) => r.url().endsWith("/organization/invite-member") && r.status() === 200,
    );
    await a.getByRole("button", { name: "Invite member", exact: true }).click();
    const { id } = (await (await response).json()) as { id: string };
    updateFixture("user", "email", email, { emailVerified: false });
    const forbidden = b.waitForResponse(
      (r) => r.url().includes("/organization/get-invitation") && r.status() === 403,
    );
    await b.goto(`/?invitationId=${id}`);
    expect(await (await forbidden).json()).toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION",
    });
    const before = (await (await fetch("http://127.0.0.1:8025")).json()) as Array<{
      to: string;
      url: string;
    }>;
    await b.getByRole("button", { name: "Send verification email", exact: true }).click();
    let url = "";
    await expect
      .poll(
        async () => {
          const messages = (await (await fetch("http://127.0.0.1:8025")).json()) as Array<{
            to: string;
            url: string;
          }>;
          url =
            messages
              .slice(before.length)
              .find((message) => message.to === email && message.url.includes("verify-email"))
              ?.url ?? "";
          return url;
        },
        { timeout: 30000 },
      )
      .toBeTruthy();
    await b.goto(url);
    await b.goto(`/?invitationId=${id}`);
    await b.getByRole("button", { name: "Accept linked invitation", exact: true }).click();
    await expect(b.getByText(`Accepted verification-${suffix}`, { exact: true })).toBeVisible();
  } finally {
    await owner.close();
    await recipient.close();
  }
});

test("headless invitation detail, resend, cancellation and rejection stay reactive", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const recipient = await browser.newContext();
  try {
    const a = await owner.newPage();
    const b = await recipient.newPage();
    const suffix = Date.now();
    const email = `workflow-${suffix}@example.com`;
    await signUp(a, `workflow-owner-${suffix}@example.com`);
    await signUp(b, email);
    const name = `Workflow ${suffix}`;
    await a.getByLabel("Organization name", { exact: true }).fill(name);
    await a.getByRole("button", { name: "Create organization", exact: true }).click();
    await a.getByRole("button", { name, exact: true }).click();
    const invite = async () => {
      await a.getByLabel("Invite email", { exact: true }).fill(email);
      await a.getByRole("button", { name: "Invite member", exact: true }).click();
      await expect(b.getByRole("button", { name: "Open invitation", exact: true })).toBeVisible();
    };
    await invite();
    const resent = a.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/organization/invite-member") &&
        request.postDataJSON()?.resend === true,
    );
    await a.getByRole("button", { name: "Resend invitation", exact: true }).click();
    await resent;
    await expect(a.getByRole("button", { name: "Cancel invitation", exact: true })).toBeEnabled();
    await a.getByRole("button", { name: "Cancel invitation", exact: true }).click();
    await expect(b.getByRole("button", { name: "Open invitation", exact: true })).toHaveCount(0);
    await invite();
    await b.getByRole("button", { name: "Open invitation", exact: true }).click();
    await b.getByRole("button", { name: "Reject linked invitation", exact: true }).click();
    await expect(a.getByRole("button", { name: "Cancel invitation", exact: true })).toHaveCount(0);
    await expect(b.getByRole("button", { name: "Open invitation", exact: true })).toHaveCount(0);
    await invite();
    await b.getByRole("button", { name: "Open invitation", exact: true }).click();
    await b.getByRole("button", { name: "Accept linked invitation", exact: true }).click();
    await expect(b.getByText(`Accepted workflow-${suffix}`, { exact: true })).toBeVisible();
    await expect(b.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(a.getByText(`${email} (member)`, { exact: true })).toBeVisible();
  } finally {
    await owner.close();
    await recipient.close();
  }
});

test("revoking another session removes its protected cached reads", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  const suffix = Date.now();
  const email = `sessions-${suffix}@example.com`;
  await signUp(a, email);
  const name = `Sessions ${suffix}`;
  await a.getByLabel("Organization name", { exact: true }).fill(name);
  await a.getByRole("button", { name: "Create organization", exact: true }).click();
  await expect(a.getByRole("button", { name, exact: true })).toBeVisible();
  let sessionId = "";
  b.on("response", async (response) => {
    if (response.url().includes("/api/auth/get-session")) {
      try {
        const body = await response.json();
        sessionId = body?.session?.id ?? sessionId;
      } catch {
        /* A superseded request may have no response body. */
      }
    }
  });
  await b.goto("/");
  await b.getByLabel("Email", { exact: true }).fill(email);
  await b.getByLabel("Password", { exact: true }).fill("Example-password-123!");
  await b.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(b.getByRole("button", { name, exact: true })).toBeVisible();
  await expect.poll(() => sessionId).toBeTruthy();
  await a
    .getByText(sessionId, { exact: true })
    .locator("..")
    .getByRole("button", { name: "Revoke session", exact: true })
    .click();
  await expect(b.getByRole("button", { name, exact: true })).toHaveCount(0);
  await first.close();
  await second.close();
});

test("organization workflows preserve drafts, paginate members, and prepare deletion", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const [a, b, c] = await Promise.all(contexts.map((context) => context.newPage()));
    const suffix = Date.now();
    const ownerEmail = `domain-owner-${suffix}@example.com`;
    const adminEmail = `domain-admin-${suffix}@example.com`;
    const memberEmail = `domain-member-${suffix}@example.com`;
    await signUp(a!, ownerEmail);
    await signUp(b!, adminEmail);
    await signUp(c!, memberEmail);
    const name = `Domain ${suffix}`;
    await a!.getByLabel("Organization name", { exact: true }).fill(name);
    await a!.getByRole("button", { name: "Create organization", exact: true }).click();
    await a!.getByRole("button", { name, exact: true }).click();
    async function invite(email: string, recipient: Page) {
      await a!.getByLabel("Invite email", { exact: true }).fill(email);
      await a!.getByRole("button", { name: "Invite member", exact: true }).click();
      await recipient.getByRole("button", { name: "Accept invitation", exact: true }).click();
      await expect(recipient.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await invite(adminEmail, b!);
    await a!
      .getByText(`${adminEmail} (member)`, { exact: true })
      .locator("..")
      .getByRole("button", { name: "Make admin", exact: true })
      .click();
    await b!.getByRole("button", { name, exact: true }).click();
    await expect(b!.getByText(`${adminEmail} (admin)`, { exact: true })).toBeVisible();
    await b!.getByLabel("Rename organization").fill("Local draft");
    const remote = `Remote ${suffix}`;
    await a!.getByLabel("Rename organization").fill(remote);
    await a!.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(b!.getByText("Organization changed on the server", { exact: true })).toBeVisible();
    await expect(b!.getByLabel("Rename organization")).toHaveValue("Local draft");
    await b!.getByRole("button", { name: "Reset organization draft", exact: true }).click();
    await expect(b!.getByLabel("Rename organization")).toHaveValue(remote);
    const slug = `canonical-${suffix}`;
    await a!.getByLabel("Organization slug", { exact: true }).fill(slug);
    await a!.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(b!.getByLabel("Organization slug", { exact: true })).toHaveValue(slug);
    await a!.getByLabel("Invite email", { exact: true }).fill(memberEmail);
    await a!.getByRole("button", { name: "Invite member", exact: true }).click();
    await c!.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(c!.getByText(`Accepted ${slug}`, { exact: true })).toBeVisible();
    await a!.getByRole("button", { name: "Next members", exact: true }).click();
    await expect(a!.getByText("Member page 2", { exact: true })).toBeVisible();
    await a!
      .getByText(`${memberEmail} (member)`, { exact: true })
      .locator("..")
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(a!.getByText("Member page 1", { exact: true })).toBeVisible();
    await expect(c!.getByRole("button", { name: remote, exact: true })).toHaveCount(0);
    await b!.getByRole("button", { name: "Leave organization", exact: true }).click();
    await expect(b!.getByRole("button", { name: remote, exact: true })).toHaveCount(0);
    const deniedLeave = a!.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/leave") && response.request().method() === "POST",
    );
    await a!.getByRole("button", { name: "Leave organization", exact: true }).click();
    expect((await deniedLeave).status()).toBe(400);
    await expect(a!.getByRole("button", { name: remote, exact: true })).toBeVisible();
    await a!.getByRole("button", { name: "Fail deletion preparation", exact: true }).click();
    let deletions = 0;
    a!.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/organization/delete"))
        deletions++;
    });
    await a!.getByRole("button", { name: "Delete organization", exact: true }).click();
    await expect(a!.getByText("Example cleanup failed", { exact: true })).toBeVisible();
    expect(deletions).toBe(0);
    await a!.getByRole("button", { name: "Allow deletion preparation", exact: true }).click();
    await a!.getByRole("button", { name: "Delete organization", exact: true }).click();
    await expect(a!.getByRole("button", { name: remote, exact: true })).toHaveCount(0);
    expect(deletions).toBe(1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
