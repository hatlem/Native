import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { updateWriterProfile } from "@/app/writer-profile-actions";
import { ContentLanguage, ContentTopic } from "@prisma/client";

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

  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    include: { languages: true, specialties: true },
  });
  if (!profile) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-lg font-semibold">My profile</h1>
        <p className="mt-4 text-sm text-neutral-500">
          This account has no writer profile.
        </p>
      </main>
    );
  }

  const myLangs = new Set(profile.languages.map((l) => l.language));
  const myTopics = new Set(profile.specialties.map((s) => s.topic));

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-semibold">My profile</h1>
      <form action={updateWriterProfile} className="mt-4 space-y-4 text-sm">
        <input type="hidden" name="locale" value={locale} />

        <label className="block">
          <span className="font-medium">Bio</span>
          <textarea
            name="bio"
            defaultValue={profile.bio ?? ""}
            rows={3}
            className="mt-1 w-full rounded border p-2"
          />
        </label>

        <fieldset>
          <legend className="font-medium">Languages</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {Object.values(ContentLanguage).map((lang) => (
              <label key={lang} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="languages"
                  value={lang}
                  defaultChecked={myLangs.has(lang)}
                />
                {lang}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="font-medium">
            Proficiency (applies to all selected)
          </span>
          <select
            name="proficiency"
            defaultValue="FLUENT"
            className="mt-1 block rounded border p-1"
          >
            <option value="NATIVE">Native</option>
            <option value="FLUENT">Fluent</option>
            <option value="WORKING">Working</option>
          </select>
        </label>

        <fieldset>
          <legend className="font-medium">Specialties</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {Object.values(ContentTopic).map((topic) => (
              <label key={topic} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="specialties"
                  value={topic}
                  defaultChecked={myTopics.has(topic)}
                />
                {topic}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-medium">Rate / article</span>
            <input
              name="ratePerArticle"
              defaultValue={
                profile.ratePerArticle ? String(profile.ratePerArticle) : ""
              }
              className="mt-1 w-full rounded border p-1"
            />
          </label>
          <label className="block">
            <span className="font-medium">Rate / word</span>
            <input
              name="ratePerWord"
              defaultValue={
                profile.ratePerWord ? String(profile.ratePerWord) : ""
              }
              className="mt-1 w-full rounded border p-1"
            />
          </label>
          <label className="block">
            <span className="font-medium">Currency</span>
            <input
              name="currency"
              defaultValue={profile.currency ?? ""}
              className="mt-1 w-full rounded border p-1"
            />
          </label>
          <label className="block">
            <span className="font-medium">Max active assignments</span>
            <input
              name="maxActiveAssignments"
              type="number"
              defaultValue={profile.maxActiveAssignments ?? ""}
              className="mt-1 w-full rounded border p-1"
            />
          </label>
        </div>

        <label className="block">
          <span className="font-medium">Portfolio URL</span>
          <input
            name="portfolioUrl"
            defaultValue={profile.portfolioUrl ?? ""}
            className="mt-1 w-full rounded border p-1"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="active"
            defaultChecked={profile.active}
          />
          <span className="font-medium">Available for new work</span>
        </label>

        <button
          type="submit"
          className="rounded bg-black px-3 py-1.5 text-white"
        >
          Save profile
        </button>
      </form>
    </main>
  );
}
