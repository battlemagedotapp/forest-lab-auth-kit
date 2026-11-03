import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
// Purchased credit expires after the catalog's creditMonths.
crons.daily("expire credit", { hourUTC: 0, minuteUTC: 15 }, internal.billing.expire, {});
export default crons;
