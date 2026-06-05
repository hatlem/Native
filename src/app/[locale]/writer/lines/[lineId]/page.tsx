import { prisma } from "@/lib/prisma";
import { requireLineWriter } from "@/lib/writers/guard";
import { saveDraft, runSpecCheck, setAssetStatus } from "@/app/desk-actions";

export default async function WriterLine({
  params,
}: {
  params: Promise<{ locale: string; lineId: string }>;
}) {
  const { locale, lineId } = await params;
  await requireLineWriter(lineId, locale); // redirects if not assigned

  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      orderId: true,
      brief: {
        select: {
          id: true,
          message: true,
          audience: true,
          doNotes: true,
          dontNotes: true,
          assets: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              body: true,
              specPassed: true,
              reviewNotes: true,
            },
          },
        },
      },
    },
  });

  if (!line?.brief) {
    return <main className="p-6 text-sm">No brief for this line yet.</main>;
  }

  const latest = line.brief.assets[0];

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <section>
        <h1 className="text-lg font-semibold">Brief</h1>
        <dl className="mt-2 space-y-1 text-sm">
          <div>
            <dt className="inline font-medium">Message: </dt>
            <dd className="inline">{line.brief.message}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Audience: </dt>
            <dd className="inline">{line.brief.audience}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Do: </dt>
            <dd className="inline">{line.brief.doNotes}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Don&apos;t: </dt>
            <dd className="inline">{line.brief.dontNotes}</dd>
          </div>
        </dl>
      </section>

      <form action={saveDraft} className="space-y-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={line.orderId} />
        <input type="hidden" name="orderLineId" value={line.id} />
        <label className="block text-sm font-medium">Article</label>
        <textarea
          name="body"
          defaultValue={latest?.body ?? ""}
          rows={18}
          className="w-full rounded border p-2 font-mono text-sm"
        />
        <button
          type="submit"
          className="rounded bg-black px-3 py-1.5 text-sm text-white"
        >
          Save draft
        </button>
      </form>

      {latest ? (
        <div className="flex items-center gap-4 text-sm">
          <span>
            Status: <strong>{latest.status}</strong>
            {latest.specPassed === true
              ? " · spec ✓"
              : latest.specPassed === false
                ? " · spec ✗"
                : ""}
          </span>
          <form action={runSpecCheck}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={line.orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
            <button type="submit" className="underline">
              Run spec check
            </button>
          </form>
          <form action={setAssetStatus}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={line.orderId} />
            <input type="hidden" name="assetId" value={latest.id} />
            <input type="hidden" name="target" value="IN_REVIEW" />
            <button type="submit" className="underline">
              Submit for review
            </button>
          </form>
        </div>
      ) : null}

      {latest?.reviewNotes ? (
        <p className="text-sm text-amber-700">
          Review notes: {latest.reviewNotes}
        </p>
      ) : null}
    </main>
  );
}
