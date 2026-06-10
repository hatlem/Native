# Admirate prisinnhentings-kampanje — oppsummering

_Sist oppdatert: 2026-06-04 (etter behandling av første svar-bølge)_

Dokumentet oppsummerer hva vi har bygget og gjort for å hente inn annonsepriser («annonsørinnhold») fra medier til NativeSpin-katalogen, hvordan vi gjorde det, hva som pågår nå, og veien videre. (Kjernefakta ligger også i Claudes prosjektminne `outreach_admirate_campaign`, som overlever samtale-komprimering.)

---

## 1. Mål

Hente inn reelle priser/rate cards for **annonsørinnhold** fra mediene i katalogen — på vegne av en annonsør (test først, deretter gjentatt) — og få prisene strukturert inn i systemet. Utsending skjer personlig fra **Andreas Hatlem @ Admirate** for høyest svarprosent.

---

## 2. Hva vi har gjort

### A. Kontakthistorikk-funksjon (kontaktlogg) — bygget og i prod
Per-tittel **kontakthistorikk** på desk-tittelsiden: hvem vi har kontaktet, kanal, retning, dato, notat. Mottatte tilbud (`PriceQuote`) kobles til kontakt-hendelsen.
- Ny `ContactLog`-modell + `ContactChannel`/`ContactDirection`-enums; `PriceQuote.contactLogId`.
- `ContactHistoryPanel` på `desk/titles/[id]`, server actions, 6 språk. Apply-loop (også draft) fikset.
- **Hvordan:** brainstorming → spec → plan → subagent-drevet bygging med spec+kvalitets-review. Merget til `main` (auto-deploy prod).

### B. MCP-utvidelse — bygget og i prod
`/api/mcp` utvidet: `native_log_contact`, `native_list_contact_logs`, `contactLogId` på `native_log_quote(_draft)`. API-nøkkel (`pricing:admin`) via `pnpm issue-pricing-admin-key`; MCP registrert mot `https://nativespin.com/api/mcp`.

### C. Kontakt-verifisering og -oppdagelse (agent-workflows)
- 1 903 utgivere, 3 153 titler; kun 223 unike adresser fantes. CSV-en hadde **ingen** e-poster.
- Verifisering (222): 125 bekreftet, 64 korrigert (58 anvendt). Oppdagelse (1 314 kontaktløse): 668 funnet → 589 nye adresser. Re-sjekk av høy-fanout + lav-sikre → ruting korrigert.
- **Hvordan:** `Workflow`-fan-out med haiku-agenter (WebFetch). ~90M agent-tokens.

### D. Dedupe, landtagging, sende-liste
- Dedup **per adresse + land** → ~790 grupper / ~2 248 titler. Alle utgivernavn landtagget. Junk fjernet (`andreas.hatlem@gmail.com` = testartefakt).
- Sende-liste: **`data/outreach/outreach_send_list.json`** (`{email, market, titles[]}`) — varig kopi.

### E. E-postutsending (Outlook / Admirate)
- Fra `andreas@admirate.no` via Outlook web, manuelt drevet i Chrome. 30/dag.
- Signatur **«Admirate (uten telefon)»** = standard (revert til telefon-versjon etter kampanjen).
- **16 sendt** (NO), **45 ContactLog OUTBOUND** logget.

### F. Svar-håndtering — oppsett
- **GetMailer-regel** «Kampanjesvar til GetMailer» (emne «Prisforespørsel» → `svar@getia.no`) ble **DEAKTIVERT 2026-06-04**: Admirates Microsoft 365 blokkerer ekstern auto-videresending (`550 5.7.520 Access denied … external forwarding`). GetMailer selv er korrekt satt opp (MX `mail.getmailer.co`, catch-all `getia.no` aktiv, RCPT returnerer 250). Fiks ligger i M365-admin (outbound anti-spam «automatic forwarding» = On) hvis vi vil ha hands-off-kopi igjen. I mellomtiden leses svar direkte i Outlook.
- Svar leses direkte i Andreas' Outlook-innboks (sendt-som `andreas@admirate.no`).

### H. Behandling av svar — arbeidsflyt (etablert 2026-06-04, første bølge: 7 svar)
Per svar: les i Outlook → last ned ev. PDF/mediekit → lagre i R2 + OCR (`RateCardDocument`) → logg INNGÅENDE `ContactLog` (kobles til salgskontakt) → legg priser som `PriceQuote` (m/ `priceUnit`) → oppdater publikasjonsdata (`offersNativeContent`, lesertall, `contentPolicy`, `outstandingInfo`, berikelse). Korreksjoner fra avsender (nedlagt/feil tittel) → deaktiver/merge. **Svar kun** for å (a) svare på spørsmål eller (b) be om manglende info (typisk mediekit). Aldri budsjett forpliktet; annonsør på **sektor-nivå** til kampanjen er bekreftet. Auto-acks / høflige avslutninger uten spørsmål → kun logget, ikke besvart.

(Detaljer per tittel/avsender ligger i løsningen — ContactLog, PriceQuote, RateCardDocument — ikke her.)

### I. Datamodell utvidet (etter brukerens prinsipper) — i prod
Gjentakende data skal være **strukturerte felt**, ikke freetext i `commercialExtra` (som nå kun holder det ustrukturerbare). Nye `Title`-felt + migrasjoner:
- `offersNativeContent Boolean?` — **kjernedimensjonen**: hvem tilbyr annonsørinnhold (true/false/null).
- `outstandingInfo String[]` — strukturert «mangler»-liste (tilbudt-men-upriset), driver gap-oppfølging.
- `aliases String[]` — alternative navn → dedup-matching ved innlegging (hindrer duplikater som TU.no vs «Teknisk Ukeblad»).
- `keywords String[]` — søkbare tagger; `description String?` — beskrivelse per tittel.
- `facebookFollowers` / `instagramFollowers Int?`, `agencyCommissionPct Decimal?` — gjentakende metrikk ut av `commercialExtra`.
- `discontinuedAt DateTime?` / `discontinuedNote String?` — nedlagt-markør (deaktivert + hvorfor).
- Priser logges som `PriceQuote`-rader (med `priceUnit` FLAT/CPC/CPM), ikke JSON-grid.

### J. Datavask — rutiner anvendt 2026-06-04
Når et svar avdekker datafeil, ryddes det med en gang (alt reversibelt via `active`-flagget):
- **Merge duplikater** (samme publikasjon, flere rader/utgivere): flytt logg/quotes/PDF/kontakter til kanonisk tittel, deaktiver dup med `discontinuedNote`. Verifiser likhet (samme `websiteUrl`) før merge.
- **Nedlagte/ikke-eksisterende titler** → `active=false` + `discontinuedAt`/`discontinuedNote`.
- **Omdøping** (rebrand/feilnavn) → fiks `name`+`slug`, legg gammelt navn i `aliases`.
- **Feil URL/utgiver** → fjern/korriger; deaktiver som uverifisert hvis riktig verdi ikke kan bekreftes (web-sjekk først).
- Faktasjekk via web før destruktive endringer; ellers behold og deaktiver heller enn å gjette.

### G. Rate card-lagring + OCR + strukturert datafangst — bygget og deployet til prod
- Spec: `docs/superpowers/specs/2026-06-04-ratecard-ingestion-design.md`.
- PDF-er lagres i R2 (`RateCardDocument`, gjenbruker `r2.ts` + ny `putObject`) + **full OCR** (`pdf-parse` digital + `tesseract.js` bilde-tekst, verifisert; bilder lagres ikke). Strukturert: `PriceQuote.priceUnit` (FLAT/CPC/CPM) + `rateCardDocumentId`, lesertall, `ownContentAllowed`, `contentPolicy`, `commercialExtra` (Json) — utvidbart. `RateCardsPanel` på desk-tittelsiden. `publicationCompleteness()` for komplett-sjekk.
- **Hvordan:** bygget av subagent i isolert worktree, merget til `main` og deployet (`7045928`). Kode i `src/lib/ratecard/` (`store.ts`, `ocr.ts`, `extract.ts`). Nye deps: `pdf-parse`, `tesseract.js` (isolert, dynamisk import — kjører som script/bakgrunn, ikke i request-pathen).

---

## 3. E-postmal (godkjent) og regler

**Emne:** `Prisforespørsel på annonsørinnhold i {titler}` (kort liste; «m.fl.» ved mange).

**Brødtekst (norsk; oversettes naturlig per marked):**
> Hei,
>
> Vi har en annonsør som vurderer native- og annonseplasseringer, og titlene deres er aktuelle. Kunne dere sendt oss en oversikt over priser for native og annonsørinnhold i {titler}?
>
> Formater vi er interessert i: annonsørinnhold / native-artikkel, sponset innhold, brand stories og video-native — samt andre formater dere tilbyr.
>
> Har dere ulike rate cards per publikasjon, ta gjerne med alle. Send gjerne over prisliste eller mediekit, så tar vi det derfra.

- **Ingen signatur i teksten** — Outlook-signaturen (Admirate uten telefon) legges på automatisk.
- **Titler inline, IKKE punktliste** (Outlook auto-formaterer bindestreker feil).
- **Variér åpningen litt** per mottaker (anti-spam): «Vi har en annonsør …» / «Vi jobber med en annonsør …» / «På vegne av en annonsør …».
- **Språk per marked:** NO→no, SE→sv, DK→da, FI→fi, DE/AT/CH→de, UK/IE→en.
- **Annonsør tilpasses publikasjonen** (relevant for deres lesere) — IKKE fast bransje. «Bilbransjen» var bare et eksempel for en bil-relevant tittel.

**Klient-brief (kan deles ved spørsmål):** annonsør tilpasses publikasjonen; budsjett kommer tilbake til; test først, så gjentas; mediets eget marked; annonsørinnhold; helst at vi skriver artikkelen og de godkjenner.

**Svar-policy:** logg priser; svar **kun** for å (a) svare på spørsmål, eller (b) be om manglende info; aldri forplikte/oppgi budsjett selv (utkast til Andreas).

**«Komplett» per publikasjon:** pris for annonsørinnhold + hva som inngår + egne-artikler/godkjenning kjent. Mangler noe → oppfølgings-e-post.

---

## 4. Sende-mekanikk (for å gjenoppta utsending)

- Outlook web: `https://outlook.cloud.microsoft/mail/`, innlogget som Andreas Hatlem (Admirate). Svar lander i denne innboksen.
- **Skriv hver e-post på nytt** (Ny e-post → Til → Emne → tekst → Send). Outlook-redigereren er skjør: ikke rediger midt i teksten; forkast via søppel-ikon → «OK»-dialog.
- **Logg hver sending** som ContactLog OUTBOUND per tittel — script-mønster:
  `railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm tsx <script>'` som kaller `createContactLog({ titleId, salesContactId?, channel:"EMAIL", direction:"OUTBOUND", note, actorId })` (prod-DB er kun internt tilgjengelig).
- Neste mottakere hentes fra `data/outreach/outreach_send_list.json` (filtrer bort allerede sendte).

### Sendt hittil — IKKE send på nytt
**Dag 1 (2026-06-03), 16:** salg@batmagasinet.no · robert@friflyt.no · arnt.erik@smallstep.no · oliver.brenden@hegnar.no · nryf@rytter.no · neteland@pinsebevegelsen.no · arild.ostvold@medierogledelse.no · al@hsmedia.no · tidende@tannlegeforeningen.no · red@byavisatonsberg.no · annonse@dn.no · salgbergen@amedia.no · salg@tumedia.no · marked@filmweb.no · kontor@genealogi.no · annonser@lmd.no

**Dag 2 (2026-06-05), 15 levert:** marked@amedia.no · ann-elise.ertesvag@egmont.com · annonser@bladet.no · elin.ellingsen@schibsted.no · knut@a2media.no · markus@salgsfabrikken.no · annonse@vl.no · christian.lind@tunmedia.no · cecilie.konterud@bonnier.no · argument@argumentnett.no · sissel@eddapresse.no · snorre.fjeldstad@vagant.no · rolf@askmedia.no · nina.tenvik@kampanje.com · tg@maritimt.com

**Dag 2 (2026-06-05), 16 levert SE (svensk mal, varierte emner):** filippa.wijkstrom@bonniernews.se · bokaannons@ntmmedia.se · erik.hamberg@aller.com · mediepartner@ernamedia.se · kontakt@rabaldermedia.se · annons@mitti.se · lrfannons@adelivery.se · foretag@stampen.com · annonsera@pharma-industry.se · saljavdelningen@egmont.se · veronica@rabaldermedia.se · henrik@batmedia.se · annelie@sb-media.se · gabrielle.hagman@mediakraft.se · john@adsales.se · lotta@hippson.se

**Bounce (ugyldig adresse — IKKE bruk igjen, finn riktig kontakt):** annonse@aller.no («user not found») — logget med BOUNCE-notat på 23 Aller-titler.
**Hoppet over:** andrine.wefring@lomedia.no (admin-feilruting); bl@medierogledelse.no (samme utgiver alt kontaktet via arild@ + Bjarte; titlene merget/nedlagt); elin.ellingsen@schibsted.no (SE-gruppen — samme kontakt alt kontaktet via NO-gruppen samme dag).

**Svensk mal (sv):** Emne «Prisförfrågan på annonsörsinnehåll i {titler}». Brødtekst: «Hej, / Vi har en annonsör som överväger native- och annonsplaceringar, och era titlar är aktuella. Skulle ni kunna skicka oss en översikt över priser för native och annonsörsinnehåll i {titler}? / Format vi är intresserade av: annonsörsinnehåll / native-artikel, sponsrat innehåll, brand stories och video-native — samt andra format ni erbjuder. / Har ni olika rate cards per titel, ta gärna med alla. Skicka gärna över prislista eller mediekit, så tar vi det därifrån.» Åpningsvarianter: «Vi har en annonsör…» / «Vi jobbar med en annonsör…» / «På uppdrag av en annonsör…». NB: signaturen forblir norsk (Admirate) — greit. **Variér også EMNEFELTET** (anti-spam) — ikke samme emne til alle: f.eks. «Prisförfrågan på annonsörsinnehåll i {X}» / «Native & annonsörsinnehåll i {X} – kan vi få era priser?» / «Annonsörsinnehåll i {X} – prisförfrågan» / «Förfrågan: priser för native/annonsörsinnehåll ({X})» / «Priser för annonsörsinnehåll i {X}?» / «{X} – prisförfrågan för native/annonsörsinnehåll». Variér også avslutningslinjen litt. **Outlook-Til-feltet dropper av og til de første tegnene ved klikk+skriv — ALLTID zoom-verifiser Til før send** (skjedde 2× i SE-batchen, fanget og rettet).

Skip-kilde i prod: titler med `ContactLog` OUTBOUND. Send-script: `scripts/log-outreach-batch.ts` (matcher gruppens titler på eksakt navn → logger OUTBOUND; bounce-flagg på avviste).

---

## 5. Grupper som krever manuell håndtering (ikke auto-send som de er)

- **Feilrutet, manglet ren adresse:** `musicradar@future-licensing.com` (69 Future-titler — lisensadresse, ikke salg), `andrine.wefring@lomedia.no` (admin), `team@madsack-agentur.de` (byrå), `annons@bbl.fi` (kun Borgåbladet).
- **~45 lav-sikre** (nettsider blokkert/nede — adressene er plausible, ikke bekreftet): bl.a. Egmont, Otavamedia, Bauer (`frank.froehling@baueradvance.com`), Bonnier.no, Vogue UK, Ringier CH.
- **~44 «form-only»/dormante** ekskludert fra send (kun kontaktskjema/telefon, eller nedlagt): bl.a. The Lawyer, Brand Eins, ICE — disse er levende, men har ingen e-post; må nås via skjema (eget løp).
- **~1 300 kontaktløse utgivere** (~1 762 titler) gjenstår å finne adresser til (telefon/skjema-only for mange).

---

## 6. Status: varige vs flyktige artefakter

- **Varig:** `data/outreach/outreach_send_list.json` (sende-liste), prosjektminne `outreach_admirate_campaign`, specs i `docs/superpowers/specs/`, all ContactLog/PriceQuote-data i prod-DB, lagrede PDF-er (når rate card-løsningen er live).
- **Flyktig (forsvinner etter økten):** arbeidsfiler i `/tmp` (`final_map.json`, `discover.json`, `recheck.json`), og agent-workflow- enes rå-output. `final_map.json` er speilet til `data/outreach/outreach_send_list.json`, men de rå agent-resultatene (verifisering/oppdagelse) er ikke lagret varig utover korrigeringene som ble skrevet inn i lista.

### Git/branch-status
- `main` (pushet til prod, `7045928`): kontaktlogg-funksjon, MCP-utvidelse, `issue-pricing-admin-key`, rate card-spec, **og rate card-ingestion-funksjonen** (migrasjon `20260604120000_ratecard_ingestion` kjører på deploy).
- Ikke committet: `data/outreach/outreach_send_list.json`, dette dokumentet.
- `feat/ratecard-ingestion` merget og slettet; agent-worktree ryddet.

---

## 7. Hva vi gjør nå

- Rate card-løsningen er **deployet** til prod (verifiser at deploy + migrasjon er kjørt før vi tar den i bruk).
- **Mottar** ekte prissvar/mediekit — klare til behandling (lagre PDF i R2 + OCR + logg som PriceQuote).

## 8. Veien videre

1. **Vente på oppfølgings-svar** vi ba om (estimater/mediekit/porteføljetilbud) — behandles likt når de kommer (se `outstandingInfo` per tittel i løsningen for hva som mangler).
2. **Fortsette utsending:** resten av NO (~180 grupper igjen) + øvrige markeder (SE/DK/FI/DE/AT/CH/UK/IE) med oversatt mal, ~30/dag. (Outlook-fanen logges ut etter inaktivitet — krever ny innlogging; utvidelsen kan også miste tilkobling til Mac-Chrome → `list_connected_browsers` + `select_browser`.)
3. **Utvide kontaktdekning:** finne adresser for de ~1 300 kontaktløse utgiverne; telefon/skjema-only separat.
4. **Apply til katalog:** bekreftede priser → `Product.basePrice` (eksisterende apply-flyt). Foreløpig ligger alt som `PriceQuote` (draft) koblet til kontaktlogg + rate card-dokument.
5. **Bruk de nye feltene:** filtrer katalogen på `offersNativeContent=true`; sjekk `aliases` ved import for å unngå duplikater; jobb ned `outstandingInfo`-lister via gap-oppfølging.

---

## 9. Nøkkeltall

| Mål | Tall |
|---|---|
| Utgivere / titler | 1 903 / 3 153 |
| Sende-grupper (deduped per adresse+land) | ~790 |
| Titler dekket av sende-listen | ~2 248 |
| Adresser verifisert / oppdaget | 222 / 668 |
| E-poster sendt (utsending) | 16 (NO) |
| Svar behandlet (første bølge) | 7 |
| Svar sendt på innkomne | 6 |
| Titler markert «tilbyr annonsørinnhold» | ~10 (resten ukjent til svar kommer) |
| Titler deaktivert/merget i datavask | ~11 (se løsningen for hvilke) |

---

## 10. Viktige filer og ressurser

- Sende-liste: `data/outreach/outreach_send_list.json`
- Specs: `docs/superpowers/specs/2026-06-03-contact-log-design.md`, `…/2026-06-04-ratecard-ingestion-design.md`
- Kode: `src/lib/pricing/contact-log.ts`, `src/lib/mcp/tools-*.ts`, `src/lib/storage/r2.ts`, `src/app/[locale]/desk/titles/[id]/_components/`
- Scripts: `pnpm issue-pricing-admin-key`; per-svar ingest-scripts i `scripts/` (`ingest-*.ts`), `campaign-inspect.ts` (read-only oppslag av tittel-IDer/kontakter), `backfill-structure.ts`, `backfill-enrichment.ts`, `merge-tidende-dupes.ts`, `cleanup-flagged.ts`, `resolve-flagged.ts`. Kjøremønster: `railway run --service Native sh -c "export DATABASE_URL='<DATABASE_PUBLIC_URL fra Postgres-tjenesten>'; pnpm tsx scripts/<x>.ts"` (Native-tjenesten har R2-creds; offentlig DB-proxy fra Postgres-tjenestens `DATABASE_PUBLIC_URL`). SUPERADMIN-aktør: `superadmin@nativespin.com` (`cmpmdiqtg048c0hu080m8kmok`).
- MCP: `https://nativespin.com/api/mcp` (`X-API-Key`, scope `pricing:admin`)
- Innkommende svar: GetMailer `GET https://getmailer.co/api/inbox` (regel videresender til `svar@getia.no`)
- Avsender: `andreas@admirate.no` (Outlook, signatur «Admirate (uten telefon)»)
