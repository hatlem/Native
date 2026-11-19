import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export const partial = "nativespin";

export default defineRailway((ctx) => {
  if (ctx.environment === "staging") {
    const nativeVolume = volume("native-volume", {
      alerts: { usage: { "100": {}, "80": {}, "95": {} } },
      allowOnlineResize: true,
      region: "europe-west4-drams3a",
      sizeMB: 50000,
    });
    const native = service("Native", {
      source: github("hatlem/Native", { branch: "main", checkSuites: false }),
      build: { buildEnvironment: "V3", builder: "NIXPACKS" },
      deploy: {
        startCommand: "pnpm next start",
        healthcheckPath: "/api/health",
        preDeployCommand: ["pnpm prisma migrate deploy"],
        healthcheckTimeout: 300,
      },
      replicas: { "europe-west4-drams3a": 1 },
      domains: [{ domain: "staging.nativespin.com", port: 8080 }],
      networking: { privateNetworkEndpoint: "native" },
      volumeMounts: { "/data/": nativeVolume },
      env: {
        AUTH_APP_NAME: preserve(),
        AUTH_EMAIL_FROM: preserve(),
        AUTH_EMAIL_REPLY_TO: preserve(),
        AUTH_SECRET: preserve(),
        DATABASE_URL: preserve(),
        NEXT_PUBLIC_APP_NAME: preserve(),
        NEXT_PUBLIC_SITE_URL: preserve(),
        NIXPACKS_NODE_VERSION: preserve(),
        RESEND_API_KEY: preserve(),
      },
    });

    return project("nativespin", {
      resources: [nativeVolume, native],
    });
  }

  const native = service("Native", {
    source: github("hatlem/Native", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "NIXPACKS" },
    deploy: {
      startCommand: "pnpm next start",
      healthcheckPath: "/api/health",
      preDeployCommand: ["pnpm prisma migrate deploy"],
      healthcheckTimeout: 300,
    },
    replicas: { "europe-west4-drams3a": 1 },
    domains: [{ domain: "nativespin.com", port: 8080 }, { domain: "www.nativespin.com", port: 8080 }],
    networking: { privateNetworkEndpoint: "native" },
    env: {
      AUTH_APP_NAME: preserve(),
      AUTH_EMAIL_FROM: preserve(),
      AUTH_EMAIL_REPLY_TO: preserve(),
      AUTH_SECRET: preserve(),
      CAMPAIGN_FLOW: preserve(),
      DATABASE_URL: preserve(),
      FEEDBACK_INGEST_KEY: preserve(),
      GETPLATFORM_AI_KEY: preserve(),
      GETPLATFORM_AI_URL: preserve(),
      NEXT_PUBLIC_APP_NAME: preserve(),
      NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID: preserve(),
      NEXT_PUBLIC_GETTALK_USERNAME: preserve(),
      NEXT_PUBLIC_GTM_ID: preserve(),
      NEXT_PUBLIC_SITE_URL: preserve(),
      NIXPACKS_NODE_VERSION: preserve(),
      OPENAI_API_KEY: preserve(),
      OUTREACH_DAILY_CAP: preserve(),
      OUTREACH_FROM: preserve(),
      OUTREACH_HOURLY_CAP: preserve(),
      OUTREACH_REPLY_TO: preserve(),
      R2_ACCESS_KEY_ID: preserve(),
      R2_ACCOUNT_ID: preserve(),
      R2_BUCKET: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
      RESEND_API_KEY: preserve(),
      RESEND_WEBHOOK_SECRET: preserve(),
      SELLER_ADDRESS_LINE1: preserve(),
      SELLER_CITY: preserve(),
      SELLER_COUNTRY: preserve(),
      SELLER_LEGAL_NAME: preserve(),
      SELLER_ORG_NUMBER: preserve(),
      SELLER_POSTAL_CODE: preserve(),
      SELLER_REGISTRY: preserve(),
    },
  });

  return project("nativespin", {
    resources: [native],
  });
});
