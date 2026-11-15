import { PendingButton } from "@/components/submit-button";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { getWorkspace, viewOrgIds } from "@/lib/workspace";
import { acceptableQuoteWhere } from "@/lib/commerce/quote-validity";
import { OrgSwitcher, switchableOrgs } from "@/app/org-switcher";
import { ViewAsBanner } from "@/app/view-as-banner";
import { countUnsentLists } from "@/lib/lists";
import { inter } from "@/fonts";
import { routing } from "@/i18n/routing";
import { pickClientMessages } from "@/i18n/client-messages";
import { auth } from "@/auth";
import { logout } from "@/app/auth-actions";
import { GtmScripts, GtmNoscript } from "@/app/gtm";
import { GetCookiesScripts } from "@/app/getcookies";
import { NavShell } from "@/app/nav-shell";
import { PublicHeader } from "@/app/public-header";
import { SiteFooter, siteMetadata, siteViewport } from "@/app/site-chrome";
import {
  audienceFor,
  navItemsFor,
  paletteItemsFor,
  userMenuItemsFor,
} from "@/lib/nav";
import { campaignFlowEnabled } from "@/lib/flags";
import "../globals.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return siteMetadata((await params).locale);
}

export const viewport: Viewport = siteViewport;

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "·";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email[0]?.toUpperCase() ?? "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function roleLabel(audience: ReturnType<typeof audienceFor>, role: string | undefined, t: (k: string) => string): string {
  if (role === "SUPERADMIN") return t("roleSuperAdmin");
  if (role === "DESK" || role === "CONTENT") return t("roleDesk");
  if (role === "PUBLISHER") return t("rolePublisher");
  if (audience === "agency") return t("roleAgency");
  if (audience === "advertiser") return t("roleAdvertiser");
  return t("roleGuest");
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "nav" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const ta = await getTranslations({ locale, namespace: "auth" });
  const session = await auth();
  // Only the namespaces client components read are serialised into the page
  // (i18n/client-messages.ts); server components translate on the server. A
  // visitor without a session can only open the public pages, which need a
  // fraction of them.
  const messages = pickClientMessages(await getMessages(), { signedIn: Boolean(session?.user) });
  // Per-request CSP nonce minted by middleware.ts. Threaded into any
  // inline <script>/<style> that the strict policy would otherwise block.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Staff (desk/superadmin) who also hold a buyer-org Membership — e.g.
  // helping a client build their plan directly — otherwise have no way
  // back into the buyer flow from a desk-only session; see NavOptions.
  // Resolved once per render and shared by every block below.
  const workspace = await getWorkspace(session?.user?.id);
  // A superadmin viewing as a customer (lib/view-as) gets the customer's nav,
  // so the page matches what the customer sees; the banner below leads back.
  const viewingAs = workspace?.viewingAsOrgId
    ? await prisma.organization.findUnique({
        where: { id: workspace.viewingAsOrgId },
        select: { name: true },
      })
    : null;
  const audience = viewingAs ? "advertiser" : audienceFor(session);
  // A member of several orgs sees which one is active in the header itself,
  // not only inside the avatar menu: every buyer page is scoped to it.
  const switchOrgs = await switchableOrgs(workspace);
  const activeOrgName = switchOrgs?.find((o) => o.id === workspace?.activeOrgId)?.name ?? null;
  const staffHasOrgAccess =
    (audience === "desk" || audience === "superadmin") && workspace !== null;
  const navOpts = {
    campaignFlow: campaignFlowEnabled(),
    hasOrgAccess: staffHasOrgAccess,
    // Admins of the active organisation get its audit trail (/audit).
    orgAdmin: workspace?.activeOrgId != null && workspace.activeRole === "ADMIN",
  };
  let nav = navItemsFor(audience, t, navOpts);
  const palette = paletteItemsFor(audience, t, navOpts);
  const userMenu = userMenuItemsFor(audience, t, navOpts);

  // The campaign-flow buyer nav collapses to 2 links (Planlegg kampanje +
  // Kampanjer) — Catalog/Lists/Favorites/Orders/Reports only survive via
  // the command palette, so these roles get the extra affordances below.
  const showCollapsedBuyerNav =
    navOpts.campaignFlow && (audience === "advertiser" || audience === "agency");

  // Draft-list badge on "Kampanjer": the nav item itself becomes the
  // notification for unsent SavedLists.
  if (showCollapsedBuyerNav) {
    const ws = workspace;
    // Decorative: a failed count must not take the whole app shell down.
    const draftListCount = ws?.activeOrgId
      ? await countUnsentLists(ws.activeOrgId).catch((err) => {
          log.warn("layout.badge_count_failed", { badge: "campaigns", err });
          return 0;
        })
      : 0;
    if (draftListCount > 0) {
      nav = nav.map((item) =>
        item.key === "campaigns" ? { ...item, badge: draftListCount } : item,
      );
    }
  }

  // "Needs you" badge on Home — same count the Home page itself renders as
  // cards, kept in sync by construction since both read the same conditions
  // over the same orgs (viewOrgIds): a quote waiting on the viewer (an org
  // they can commit in) plus content drafts in review.
  if (audience === "advertiser" || audience === "agency") {
    const ws = workspace;
    if (ws) {
      const orgIds = viewOrgIds(ws);
      const quoteOrgIds = orgIds.filter((id) => ws.commitOrgIds.includes(id));
      // The badge is decorative and this layout wraps every page, where no
      // error boundary of its own segment can catch it: on a failed count,
      // render without the badge instead of failing the request.
      const [quoteCount, contentCount] = await Promise.all([
        prisma.quote.count({
          where: { ...acceptableQuoteWhere(), order: null, request: { organizationId: { in: quoteOrgIds } } },
        }),
        prisma.contentAsset.count({
          where: { status: "IN_REVIEW", article: { organizationId: { in: orgIds } } },
        }),
      ]).catch((err) => {
        log.warn("layout.badge_count_failed", { badge: "home", err });
        return [0, 0] as const;
      });
      const needsCount = quoteCount + contentCount;
      if (needsCount > 0) {
        nav = nav.map((item) => (item.key === "home" ? { ...item, badge: needsCount } : item));
      }
    }
  }

  const appName = tc("appName");
  const signedIn = Boolean(session?.user);

  // A JWT session outlives the account it was minted for: deactivating a user
  // (self-service or from /desk/users) can't reach into an already-issued
  // cookie. This is the render-side half of that gate — every authenticated
  // page in the app nests inside this layout, so one check here replaces a
  // per-page guard, and `children` is never rendered for a deactivated
  // session. (getWorkspace covers the API/server-action half.)
  const deactivated = session?.user?.id
    ? Boolean(
        (
          await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { deactivatedAt: true },
          })
        )?.deactivatedAt,
      )
    : false;

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <GtmNoscript />
        <GetCookiesScripts nonce={nonce} />
        <GtmScripts nonce={nonce} />
        <NextIntlClientProvider messages={messages}>
          {signedIn ? (
            <NavShell
              brand={appName}
              nav={nav}
              palette={palette}
              menuItems={userMenu}
              signedIn={signedIn}
              showPaletteHint={showCollapsedBuyerNav}
              entitySearch={audience === "desk" || audience === "superadmin"}
              user={
                session?.user?.email
                  ? {
                      email: session.user.email,
                      initials: initialsFromEmail(session.user.email),
                      roleLabel: roleLabel(audience, session.user.role, t),
                    }
                  : undefined
              }
              orgSwitcher={<OrgSwitcher locale={locale} workspace={workspace} orgs={switchOrgs} />}
              activeOrgName={activeOrgName}
              signOutAction={
                <form action={logout}>
                  <input type="hidden" name="locale" value={locale} />
                  <PendingButton>{ta("signout")}</PendingButton>
                </form>
              }
              labels={{
                skip: t("skipToContent"),
                menu: t("menu"),
                close: t("close"),
                search: t("search"),
                searchPlaceholder: t("searchPlaceholder"),
                noResults: t("noResults"),
              }}
            />
          ) : (
            <PublicHeader
              brand={appName}
              authActions={{ signIn: ta("signin"), signUp: ta("signup") }}
            />
          )}

          {viewingAs ? (
            <ViewAsBanner locale={locale} orgName={viewingAs.name} />
          ) : null}

          <main id="main" className="container">
            {deactivated ? (
              <section className="section">
                <header className="page-header">
                  <h1>{ta("deactivatedTitle")}</h1>
                  <p className="lead">{ta("deactivatedBody")}</p>
                </header>
                <form action={logout}>
                  <input type="hidden" name="locale" value={locale} />
                  <PendingButton className="btn primary">
                    {ta("signout")}
                  </PendingButton>
                </form>
              </section>
            ) : (
              children
            )}
          </main>

          <SiteFooter locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
