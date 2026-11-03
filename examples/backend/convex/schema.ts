import { defineSchema } from "convex/server";
import { authSignalTables } from "@strawdev/auth-client/convex";
import { billingTables } from "@strawdev/auth-client/convex/billing";
export default defineSchema({ ...authSignalTables, ...billingTables });
