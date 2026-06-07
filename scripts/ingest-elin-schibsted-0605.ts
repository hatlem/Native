/** Log Elin Ellingsen (Schibsted) INBOUND, 2026-06-05 11:10. Reply already sent 11:50.
 * Routing til salgsrådgiver; spurte hvilken kunde. Ingen priser ennå. Titler: E24, VG Helg, Godt.no. */
import { createContactLog } from "@/lib/pricing/contact-log";
const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const note =
  "INBOUND 2026-06-05: Elin Ellingsen (Schibsted, elin.ellingsen@schibsted.com). Setter oss i kontakt med en salgsrådgiver i Schibsted. " +
  "Spurte hvilken kunde forespørselen gjelder. Svart med budsjett-rammeverk (bransjerelevant aktør, samler estimater, native-only, tidligst etter sommeren, konkret kunde ved skarp bestilling) 2026-06-05 11:50. Ingen priser ennå.";
const IDS = ["cmpmdiq9t01i80hu0ovhyeukt","cmpmdiqa101u40hu0oe0d70pl","cmpmdiq9z01qv0hu0366zse3q"]; // E24, VG Helg, Godt.no
(async () => {
  for (const titleId of IDS) await createContactLog({ titleId, channel:"EMAIL", direction:"INBOUND", note, actorId: ACTOR });
  console.log("Elin Ellingsen (Schibsted) INBOUND logget på E24, VG Helg, Godt.no.");
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
