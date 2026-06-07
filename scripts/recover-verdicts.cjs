// Recover every per-title verdict + ad-email from workflow agent transcripts.
const fs = require("fs"), path = require("path");
const BASE = "/Users/andreashatlem/.claude/projects/-Users-andreashatlem-Native/44b3aa22-0fb6-4217-a974-88553b059778/subagents/workflows";
const dirs = ["wf_2c98314c-a6e", "wf_a81501f1-2d3", "wf_38bc5e06-70d"];
const verdicts = new Map(); // "email\ttitle" -> {email,title,status,note}
const ademails = new Map(); // email -> {email,adEmail,source}
let files = 0, payloads = 0;
for (const d of dirs) {
  const dir = path.join(BASE, d);
  if (!fs.existsSync(dir)) continue;
  for (const fn of fs.readdirSync(dir)) {
    if (!fn.endsWith(".jsonl")) continue;
    files++;
    let txt;
    try { txt = fs.readFileSync(path.join(dir, fn), "utf8"); } catch { continue; }
    for (const line of txt.split("\n")) {
      if (line.indexOf("verdicts") === -1) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const content = o.message && o.message.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c.type === "tool_use" && c.name === "StructuredOutput" && c.input && c.input.verdicts) {
          payloads++;
          const inp = c.input;
          const em = (inp.email || "").toLowerCase();
          for (const v of inp.verdicts) {
            const k = em + "\t" + (v.title || "").toLowerCase();
            if (!verdicts.has(k)) verdicts.set(k, { email: inp.email, title: v.title, status: v.status, note: v.note });
          }
          if (inp.adEmail && !ademails.has(em)) ademails.set(em, { email: inp.email, adEmail: inp.adEmail, source: inp.adEmailSource });
        }
      }
    }
  }
}
const all = [...verdicts.values()];
const by = all.reduce((a, v) => { a[v.status] = (a[v.status] || 0) + 1; return a; }, {});
const groups = new Set(all.map((v) => v.email.toLowerCase())).size;
console.log("files scanned:", files, "| payloads:", payloads);
console.log("unique verdicts:", all.length, "| groups covered:", groups);
console.log("by status:", JSON.stringify(by));
console.log("adEmails recovered:", ademails.size);
fs.writeFileSync("/tmp/all_verdicts.json", JSON.stringify(all));
fs.writeFileSync("/tmp/all_ademails.json", JSON.stringify([...ademails.values()]));
