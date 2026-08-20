import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      orgId: string | null;
      orgType: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role?: UserRole;
    orgId?: string | null;
    orgType?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: UserRole;
    orgId?: string | null;
    orgType?: string | null;
  }
}
