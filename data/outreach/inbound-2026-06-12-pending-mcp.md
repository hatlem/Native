# INBOUND 2026-06-12 — venter på at prod/MCP er oppe igjen

Alt under er hentet ut av Outlook-svar 06-12 og skal logges via MCP
(create_sales_contact + log_contact INBOUND + log_quote + apply + activate)
så snart nativespin.com svarer.

## 1. The Big Issue (UK) — KOMPLETT TILBUD ✅
Fra: Tim Deeks <tim.deeks@canopymedia.co.uk>, Advertising Director,
Canopy Media Management Ltd (salgshus for Big Issue), M: 07764 941582,
57-61 Charterhouse Street, London EC1M 6HA. Mottatt 16:56.
- Sponsored article på bigissue.com, skrives/produseres av Big Issue-redaksjonen
  (full brief-prosess, annonsør får godkjenne endringer før publisering)
- Pris: £3 000 + £600 produksjonsgebyr
- GARANTERT 5 000 visninger per artikkel
- Ledetid 4–6 uker fra booking
- Merkes "Commercial or Sponsored content"
→ Quote: 3000 GBP FLAT, productionFee 600, inclusions
  {production: "PUBLISHER", viewsTotal: 5000}, leadTimeDays 42 (28–42, øvre).
  Finance-notis: Canopy varsler ALDRI kontonummer-endring per e-post (anti-fraud).

## 2. Amedia ordinærpriser (NO) — GJELDER ALLE AMEDIA-AVISER ✅
Fra: Maria Hagland <maria.hagland@amedia.no>, Salgssjef Amedia Annonse
(Rogaland, Sunnhordland & Hardanger), mob 46 52 00 05. Mottatt 17:24.
Vedlegg: "Amedia Annonse Rogaland - info og priser.pdf" (15 MB) — IKKE lastet ned ennå.
Sitat: «de samme digitale ordinærprisene som gjelder på tvers av alle våre aviser»

Produksjon (Amedia Innholdsbyrå):
- Full artikkelproduksjon (utreise, intervju, foto): 18 000 kr
- Video med artikkel (film ≤2 min + artikkel + foto): fra 35 500 kr
- Ferdigmateriell / enkel produksjon (deres mal / telefonintervju): 4 500–10 500 kr

Distribusjon (CPM, native annonseinngang):
- 1-saksløsning: 300 CPM
- 2-saksløsning: 300 CPM
- 3-saksløsning: 400 CPM
(1-sak = én landingsside; 3-sak = tre landingssider i samme annonseinngang)
Kombineres gjerne med «fast plass» (artikkel i redaksjonell flyt på forsiden 1–2 dager).

Pakkeeksempel Gjesdalbuen.no (startpakke):
- 1-saksløsning, 2–3 ukers kampanje, full produksjon (verdi 18 000),
  2 faste forsidedager, 100 000 native-visninger: TOTAL 34 580 kr eks mva
→ Gjesdalbuen-quote: 34580 NOK FLAT pakke, inclusions
  {production: "PUBLISHER", viewsTotal: 100000, frontpage: true,
   durationWeeks: 3, articles: 1}; + CPM-quotes 300/400 NOK.
→ VURDER (brukerbeslutning): rulle ordinærprisene ut på hele Amedia (NO)-porteføljen.
Tips fra Maria: Sandnesposten god match sammen med Gjesdalbuen (Sør-Rogaland).

## 3. Allerede logget før prod gikk ned
- KM Group/Kent: feil vedlegg, kontakt+INBOUND logget, svar SENDT 06-12 (ber om ekte ratekort)
- Metsälehti: positiv, tilbud ventes uke 25 (logget)
- HBL/Elin: ping logget; IKKE svart (vi har alt fra 06-08)
- Suomenmaa: ikke native (parallellsesjon logget); GJENSTÅR: markTitleNoNative i desk
- Gun Mart: bounce fikset i send-listen (vanessa.english@gunmart.net)

## 4. Gjenstår å logge når MCP er oppe
- [x] Big Issue: contact + INBOUND + quote 3000 GBP applied (cmqb3p3ft)
- [x] Gjesdalbuen: contact + INBOUND + pakkequote 34580 NOK applied (cmqb3q4m3); CPM-ordinærpriser dokumentert i kontakt/logg — porteføljeutrulling avventer Andreas
- [x] KM: OUTBOUND logget (cmqb3qlkn)
- [~] Suomenmaa: desk-knappene var DØDE (nestet-form-bug, fikset i deploy) — deaktiveres når fixen er live

## 5. Curation follow-up (needs migration — deferred until prod migration recovery is available)
Big Issue + Gjesdalbuen quotes were logged via MCP with semantics in the includedText NOTE, not structured fields. Desk UI can set productionFee (done for Big Issue = £600) but NOT structured `inclusions`. To give buyers the "Garantert X visninger / Ferdig skrevet artikkel" line, a migration should set:
- the-big-issue-uk NATIVE_ARTICLE: inclusions {production:"PUBLISHER", viewsTotal:5000}  (productionFee 600 already set 06-13)
- gjesdalbuen-no package (cmpn1ct2p001z0hvyoomo5l2g): productionFee, inclusions {production:"PUBLISHER", viewsTotal:100000, frontpage:true, durationWeeks:3, articles:1}
Why deferred: 2026-06-12 outage left no migration-recovery path mid-session (Chrome extension disconnected, Railway CLI logged out). Recovery is via Railway dashboard Postgres console (migrate-resolve) or `railway login`.

## 6. Bonnier ownership — VERIFIED, no action
Checked the rumored Bonnier Publications→Aller 2019 sale: FALSE (Bo Bedre = Bonnier since 1983; only Aller/Bonnier deal was 2014 Finnish titles). Bonnier subsidiaries (News / News Local / Publications / Magazines & Brands / Business) are legitimately distinct. No reassignment. Minor future cleanup only: "Komputer For Alle [NO]" sits under generic "Bonnier (NO)" but belongs in "Bonnier Publications (NO)".
