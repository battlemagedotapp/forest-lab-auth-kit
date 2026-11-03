import { defineSchema } from "convex/server";
import { authSignalTables } from "@forest-lab/auth-kit/convex";
import { billingTables } from "@forest-lab/auth-kit/convex/billing";
export default defineSchema({ ...authSignalTables, ...billingTables });
