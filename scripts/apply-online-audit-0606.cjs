/** Apply the 2026-06-06 online audit (workflow wf_1fdfa859-833) to the send list.
 *
 * Input: /tmp/verify_verdicts.json — 455 per-group verdicts (titles alive? ad email correct?)
 * Rules (catalog-data-standard: quarantine over guess):
 *   - email confirmed  -> keep
 *   - email corrected  -> use correctedEmail (must come from a LIVE publisher page;
 *                         web.archive.org sources are NOT current -> quarantine instead)
 *   - email unconfirmed -> whole group to quarantine, never sent
 *   - title alive      -> keep — UNLESS the verdict note says it belongs to a different
 *                         publisher than this contact -> title-quarantine (re-home later)
 *   - title renamed    -> keep under currentName (old name recorded in renames report)
 *   - title dead/merged -> strip (recorded in kill report)
 *   - title uncertain  -> strip to title-quarantine for manual review
 *   - group left with 0 titles -> dropped (recorded)
 * Contacted groups (verifiedBy delivered/reply) pass through untouched.
 * IDEMPOTENT: the uncontacted half is always rebuilt from the verdicts' inputs, and
 * prior audit-0606 quarantine entries are replaced, so re-running is safe.
 * Writes: outreach_send_list.json (rebuilt), outreach_send_list_quarantine.json,
 *         outreach_online_audit_0606.json (full provenance), /tmp/audit_summary.json
 */
const fs = require("fs");

const sendList = JSON.parse(fs.readFileSync("outreach_send_list.json", "utf8"));
const verdicts = JSON.parse(fs.readFileSync("/tmp/verify_verdicts.json", "utf8"));
const quarantineFile = JSON.parse(fs.readFileSync("outreach_send_list_quarantine.json", "utf8"))
  .filter((q) => !/^audit-0606/.test(q.reason || "")); // drop prior runs of this audit

const CONTACTED = new Set(["delivered", "reply"]);
const contacted = sendList.filter((g) => CONTACTED.has(g.verifiedBy));

// diacritic-safe title matching: "Se og Hør" === "Se og Hor", "æ" === "ae"
const norm = (s) =>
  s.toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();

// alive titles whose verdict note says they belong to a different publisher
const WRONG_PUBLISHER =
  /(published by .{0,30}, not|separate publisher|not (an? )?(aller|svd|bonnier|egmont|this publisher)|wrong publisher|absent from (the )?(publisher|aller|current brand))/i;

const out = [...contacted];
const newQuarantine = [];
const killed = [];
const renamed = [];
const titleQuarantine = [];
const droppedGroups = [];
const emailCorrections = [];
let dupDropped = 0;

for (const r of verdicts) {
  const g = r.input; // original group, pre-audit
  const v = r.verdict;
  if (!v) {
    newQuarantine.push({ email: g.email, market: g.market, titles: g.titles, reason: "audit-0606: no verdict returned" });
    continue;
  }

  // --- email ---
  const archiveSourced = v.emailVerdict === "corrected" && /web\.archive\.org/i.test(v.emailSource || "");
  if (v.emailVerdict === "unconfirmed" || archiveSourced) {
    newQuarantine.push({
      email: g.email, market: g.market, titles: g.titles,
      reason: archiveSourced
        ? "audit-0606: corrected email only found on web.archive.org (not current)"
        : "audit-0606: no ad email confirmable on publisher's own site — " + (v.summary || "").slice(0, 200),
    });
    continue;
  }
  let email = g.email, by = "audit-0606:email-on-site";
  if (v.emailVerdict === "corrected") {
    email = v.correctedEmail;
    by = "audit-0606:email-corrected";
    emailCorrections.push({ market: g.market, from: g.email, to: email, source: v.emailSource });
  }

  // --- titles ---
  const T = new Map(v.titles.map((t) => [norm(t.name), t]));
  const keep = [];
  for (const name of g.titles) {
    const t = T.get(norm(name));
    if (!t) { titleQuarantine.push({ market: g.market, group: g.email, title: name, status: "uncertain", note: "audit-0606: title missing from verdict" }); continue; }
    if (t.status === "alive") {
      if (WRONG_PUBLISHER.test(t.note || "")) {
        titleQuarantine.push({ market: g.market, group: g.email, title: name, status: "wrong-publisher", note: t.note, evidence: t.evidenceUrl || null });
        continue;
      }
      keep.push(name);
      continue;
    }
    if (t.status === "renamed" && t.currentName) {
      keep.push(t.currentName);
      renamed.push({ market: g.market, group: g.email, from: name, to: t.currentName, note: t.note, evidence: t.evidenceUrl || null });
      continue;
    }
    if (t.status === "dead" || t.status === "merged") {
      killed.push({ market: g.market, group: g.email, title: name, status: t.status, becameTitle: t.currentName || null, note: t.note, evidence: t.evidenceUrl || null });
      continue;
    }
    // uncertain (or renamed without a currentName — treat as uncertain)
    if (/duplicate/i.test(t.note)) { dupDropped++; continue; }
    titleQuarantine.push({ market: g.market, group: g.email, title: name, status: t.status, note: t.note, evidence: t.evidenceUrl || null });
  }

  if (!keep.length) {
    droppedGroups.push({ email: g.email, market: g.market, titles: g.titles, reason: "audit-0606: no titles survived (dead/merged/uncertain/wrong-publisher)" });
    continue;
  }
  const entry = { email, market: g.market, titles: keep, verifiedBy: by, auditedAt: "2026-06-06" };
  if (email.toLowerCase() !== g.email.toLowerCase()) entry.wasEmail = g.email;
  out.push(entry);
}

fs.writeFileSync("outreach_send_list.json", JSON.stringify(out, null, 2) + "\n");
fs.writeFileSync("outreach_send_list_quarantine.json", JSON.stringify(
  [...quarantineFile, ...newQuarantine, ...droppedGroups.map((d) => ({ email: d.email, market: d.market, titles: d.titles, reason: d.reason }))],
  null, 2) + "\n");
fs.writeFileSync("outreach_online_audit_0606.json", JSON.stringify({
  auditedAt: "2026-06-06", workflowRun: "wf_1fdfa859-833",
  groupsAudited: verdicts.length,
  killed, renamed, titleQuarantine, emailCorrections,
  quarantinedGroups: newQuarantine.map((q) => ({ email: q.email, market: q.market, reason: q.reason })),
  droppedGroups: droppedGroups.map((d) => ({ email: d.email, market: d.market, titles: d.titles })),
  verdicts,
}, null, 2) + "\n");

const summary = {
  contactedPassedThrough: contacted.length,
  auditedGroups: verdicts.length,
  outputGroups: out.length,
  outputTitles: out.reduce((a, g) => a + g.titles.length, 0),
  emailCorrections: emailCorrections.length,
  groupsQuarantined: newQuarantine.length,
  groupsDroppedEmpty: droppedGroups.length,
  titlesKilled: killed.length,
  titlesRenamed: renamed.length,
  titlesQuarantined: titleQuarantine.length,
  duplicatesDropped: dupDropped,
};
fs.writeFileSync("/tmp/audit_summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
