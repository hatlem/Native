import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { WriterProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function WriterProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;
  if (
    !session?.user ||
    (role !== "CONTENT" && role !== "DESK" && role !== "SUPERADMIN")
  ) {
    redirect(`/${locale}/signin`);
  }
  const t = await getTranslations({ locale, namespace: "writer" });

  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    include: { languages: true, specialties: true },
  });

  return (
    <>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href="/writer" className="link">
          ← {t("backToAssignments")}
        </Link>
      </p>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("profile.title")}</h1>
        <p className="lead">{t("profile.lead")}</p>
      </header>

      <section className="section">
        {!profile ? (
          <p className="muted">{t("profile.noProfile")}</p>
        ) : (
          <div className="card">
            <WriterProfileForm
              locale={locale}
              values={{
                bio: profile.bio ?? "",
                languages: Object.fromEntries(
                  profile.languages.map((l) => [l.language, l.proficiency ?? "FLUENT"]),
                ),
                specialties: profile.specialties.map((s) => s.topic),
                ratePerArticle: profile.ratePerArticle != null ? String(profile.ratePerArticle) : "",
                ratePerWord: profile.ratePerWord != null ? String(profile.ratePerWord) : "",
                currency: profile.currency ?? "",
                maxActiveAssignments:
                  profile.maxActiveAssignments != null && profile.maxActiveAssignments > 0
                    ? String(profile.maxActiveAssignments)
                    : "",
                portfolioUrl: profile.portfolioUrl ?? "",
                active: profile.active,
              }}
            />
          </div>
        )}
      </section>
    </>
  );
}
