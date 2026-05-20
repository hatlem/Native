import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      orgId: string | null;
      orgType: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
    orgId?: string | null;
    orgType?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: string;
    orgId?: string | null;
    orgType?: string | null;
  }
}
