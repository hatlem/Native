#!/usr/bin/env tsx
/**
 * Walks all Publishers without an APPROVED ContactCandidate, picks a
 * representative URL from one of their titles, probes locale-specific
 * paths, extracts candidate emails, scores them, and upserts into
 * ContactCandidate (PENDING) for admin review.
 *
 * Run: pnpm scrape-contacts
 *
 * Safe to rerun — @@unique([publisherId, email]) prevents duplicates.
 */
import { prisma } from "@/lib/prisma";
import { scrapePublisher, type Fetcher } from "@/lib/outreach/scraper";

const PER_HOST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;
const lastFetchByHost = new Map<string, number>();

const fetcher: Fetcher = async (url: string) => {
  const host = new URL(url).hostname;
  const last = lastFetchByHost.get(host);
  if (last) {
    const wait = PER_HOST_DELAY_MS - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastFetchByHost.set(host, Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "NativeSpinPublisherDiscovery/1.0 (+https://nativespin.com/partnerships-bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
      contentType: res.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
};

async function main() {
  const publishers = await prisma.publisher.findMany({
    where: {
      contactCandidates: {
        none: { status: "APPROVED" },
      },
    },
    include: {
      titles: {
        select: { websiteUrl: true },
        where: { websiteUrl: { not: null } },
        take: 1,
      },
    },
  });

  console.log(`[scrape] ${publishers.length} publishers without approved candidate`);
  let scraped = 0;
  let noUrl = 0;
  let errors = 0;
  let candidatesInserted = 0;

  for (let i = 0; i < publishers.length; i++) {
    const pub = publishers[i];
    const url = pub.titles[0]?.websiteUrl;
    if (!url) {
      noUrl++;
      console.log(`[${i + 1}/${publishers.length}] ${pub.name} — no URL`);
      continue;
    }
    const root = url.replace(/\/+[^/]*$/, "").replace(/^(https?:\/\/[^/]+).*$/, "$1");
    try {
      const result = await scrapePublisher({
        publisherId: pub.id,
        rootUrl: root,
        countryCode: pub.countryCode,
        fetcher,
      });
      const top = result.candidates[0];
      console.log(
        `[${i + 1}/${publishers.length}] ${new URL(root).hostname} — ${result.candidates.length} candidates${top ? ` (best: ${top.confidence})` : ""}`,
      );
      for (const c of result.candidates) {
        await prisma.contactCandidate.upsert({
          where: { publisherId_email: { publisherId: pub.id, email: c.email } },
          update: { confidence: c.confidence, sourceUrl: c.sourceUrl, name: c.name, role: c.role, phone: c.phone },
          create: {
            publisherId: pub.id,
            email: c.email,
            name: c.name,
            role: c.role,
            phone: c.phone,
            sourceUrl: c.sourceUrl,
            confidence: c.confidence,
          },
        });
        candidatesInserted++;
      }
      scraped++;
    } catch (err) {
      errors++;
      console.error(`[${i + 1}/${publishers.length}] ${pub.name} — ERROR ${(err as Error).message}`);
    }
  }

  console.log(`\n[scrape] done. scraped=${scraped} no_url=${noUrl} errors=${errors} candidates_upserted=${candidatesInserted}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
