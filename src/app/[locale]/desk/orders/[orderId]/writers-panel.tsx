import { loadRoster } from "@/lib/writers/roster";
import { rankWriters } from "@/lib/writers/match";
import { languageForCountry, topicForCategory } from "@/lib/writers/criteria";
import {
  addWriterToPool,
  removeWriterFromPool,
} from "@/app/writer-pool-actions";
import type { ContentLanguage, ContentTopic } from "@prisma/client";
import { SafeEmail } from "@/components/safe-email";

type Props = {
  locale: string;
  orderId: string;
  poolWriterIds: string[];
  // Derived from the order's lines' titles (country code + category).
  criteriaCountry: string;
  criteriaCategory: string;
};

export async function WritersPanel({
  locale,
  orderId,
  poolWriterIds,
  criteriaCountry,
  criteriaCategory,
}: Props) {
  const roster = await loadRoster();
  const language: ContentLanguage | null = languageForCountry(criteriaCountry);
  const topics: ContentTopic[] = [topicForCategory(criteriaCategory)];
  const ranked = rankWriters(roster, { language, topics });

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold">Writers</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Ranked by language ({language ?? "—"}) and specialty (
        {topics.join(", ")}). Add candidates to this order&apos;s pool, then
        assign one per line below.
      </p>
      <ul className="mt-3 divide-y divide-neutral-100">
        {ranked.map((w) => {
          const inPool = poolWriterIds.includes(w.id);
          return (
            <li key={w.id} className="flex items-center justify-between py-2">
              <div className="text-sm">
                <span className="font-medium">{w.name ?? <SafeEmail address={w.email} />}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  {w.languages.map((l) => l.language).join(", ") || "no langs"}
                  {" · "}
                  {w.specialties.map((s) => s.topic).join(", ") || "no topics"}
                  {w.maxActiveAssignments != null
                    ? ` · ${w.activeAssignments}/${w.maxActiveAssignments}`
                    : ` · ${w.activeAssignments} active`}
                  {!w.active ? " · inactive" : ""}
                  {w.match.overCapacity ? " · ⚠ over capacity" : ""}
                </span>
              </div>
              <form action={inPool ? removeWriterFromPool : addWriterToPool}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name="writerId" value={w.id} />
                <button type="submit" className="text-xs underline">
                  {inPool ? "Remove" : "Add to pool"}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
