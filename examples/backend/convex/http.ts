import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { resend } from "./email";
import { webhook as dodoWebhook } from "./billing";
const http = httpRouter();
authComponent.registerRoutes(http, createAuth, { cors: true });
http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction((ctx, request) => resend.handleResendEventWebhook(ctx, request)),
});
http.route({ path: "/dodo-webhook", method: "POST", handler: dodoWebhook });
export default http;
