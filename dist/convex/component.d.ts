import { type Infer } from "convex/values";
declare const metadata: import("convex/values").VUnion<{
    organizationId?: string | undefined;
    email?: string | undefined;
    role?: string | undefined;
    inviterId?: string | undefined;
    _id: string;
} | null, [import("convex/values").VNull<null, "required">, import("convex/values").VObject<{
    organizationId?: string | undefined;
    email?: string | undefined;
    role?: string | undefined;
    inviterId?: string | undefined;
    _id: string;
}, {
    _id: import("convex/values").VString<string, "required">;
    email: import("convex/values").VString<string | undefined, "optional">;
    organizationId: import("convex/values").VString<string | undefined, "optional">;
    inviterId: import("convex/values").VString<string | undefined, "optional">;
    role: import("convex/values").VString<string | undefined, "optional">;
}, "required", "organizationId" | "email" | "role" | "inviterId" | "_id">], "required", "organizationId" | "email" | "role" | "inviterId" | "_id">;
export type LookupMetadata = Infer<typeof metadata>;
/** Register inside the local Better Auth component, never in the parent app. */
export declare const lookup: import("convex/server").RegisteredQuery<"public", {
    organizationId?: string | undefined;
    email?: string | undefined;
    userId?: string | undefined;
    id?: string | undefined;
    slug?: string | undefined;
    model: "organization" | "invitation" | "user" | "member";
}, Promise<{
    organizationId?: string | undefined;
    email?: string | undefined;
    role?: string | undefined;
    inviterId?: string | undefined;
    _id: string;
} | null>>;
export {};
//# sourceMappingURL=component.d.ts.map