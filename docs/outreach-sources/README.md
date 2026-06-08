# Outreach source documents (mediekits / rate cards)

Index of the original PDF attachments publishers sent in reply to the Admirate
price-gathering campaign (sent from `andreas@admirate.no`). These are the **primary
sources** behind the `PriceQuote` / `commercialExtra` / `audienceNote` data ingested
into the prod catalog, so any logged price can be traced to the document it came from.

> **The PDF/PNG binaries are NOT in git.** Originals live in **Cloudflare R2**
> (bucket `nativespin-blob`, prefix `rate-cards/<date>/...`) and are linked in the DB
> via the `RateCardDocument` table (`objectKey`, `titleId`/`publisherId`, `source`).
> This folder is a local staging area (gitignored); this README is the human-readable
> manifest. Re-upload with `scripts/upload-ratecards-r2.ts` (idempotent by fileName).

All prices in the documents are **ex. VAT / eks. mva / exkl. moms** unless noted.
Currency is the publisher's home currency (NOK / SEK / EUR).

| Folder / file | Title(s) | Source contact | Market | Received | Key data captured |
|---|---|---|---|---|---|
| `amedia/Innholdsmarkedsføring - Amedia x Admirate Performance.pdf` | Fanaposten, Åsane Tidende (Amedia-wide) | Miriam Olaussen, KAM Amedia Annonse Vest | NO | 2026-06-08 | Native CPM 300/350/400 (1/2/3-sak); prod 4 500 / 18 000; no per-pub rate cards |
| `bonnier-fi/BNF ELIN .pdf` | Hufvudstadsbladet, Vasabladet (+Svenskfinland portfolio) | Elin Karppinen, Concept Manager Bonnier News B2B FI | FI | 2026-06-08 | Native/vecka HBL 1 800 € / VBL 790 €; pakke HBL+VBL 3 590 €; prod +1 000, video +500; 100% SOV |
| `edda-aksess/AKSESS 1+2 2026_justert.pdf` | Aksess (reference issue) — Edda Presse | Sissel Bjerkeset, Edda Presse | NO | (ref, sent 06-05) | Example: 4-page paid content = 35 100. (Folkemusikk 11 500 / Fotografi 12 900 from email body) |
| `jakt/Mediafakta_Allt om Jakt & Vapen_2026_A4.pdf` | Allt om Jakt & Vapen | Sofie Oskarsson, JO Förlaget | SE | 2026-06-08 | Print/banner/film/Jägarstudion rate card; native helsida 16 000 / 13 000 (from email) |
| `vestnesavisa/Annonseprisar Vestnesavisa 2025.pdf` | Vestnesavisa | Stina, Vestnesavisa (TVI Syn Media) | NO | 2026-06-08 | Banner + print only, **no native product** |
| `nmf/Mediakit_NMF_UK_2026.pdf` | Båtmagasinet, Seil Magasinet (NMF) | Håkon Nissen-Lie | NO | 2026-06-08 | Reader stats; native 5 000/9 000 uke + webTV advertorial 20 000 |
| `bonnier-healthcare/Copy of BHN Media Kit 2026 NO.pdf` | Dagens Medisin (+ NHI portfolio) | Arvid Ervik, Bonnier Healthcare | NO | 2026-06-08 | 252k HCP/uke; native sponset artikkel 200 000 (3 mnd); banner CPM 300/150; print helside 50 000 |
| `jakt/…`, `arkitektur/…` | Arkitektur (HS Media) | Anita Lindberg | NO | 2026-06-05/08 | 268k sidevisn/mnd; nyhetsbrev-native 7 300; native 15 000/14d |
| `batliv_se/Båtliv_2026.pdf` | Båtliv (SE, Marina Media/Svenska Båtunionen) | Henrik Salén | SE | 2026-06-05 | Opplag 130 200; native advertorial 19 900 SEK/utskick |
| `tumedia/TU - demografi 2026.pdf`, `tumedia/DIGI - demografi 2026.pdf` | TU.no, Digi.no | Jan-Øyvind Kristiansen / FA Media | NO | 2026-06-08 | Demografi/rekkevidde (TU 700k/mnd, Digi 300k/mnd) |
| `finans/Medieinfo Finansavisen 2026 eldst.pdf`, `finans/FA Brandstudio muligheter  2026   (1).pdf` | Finansavisen, Kapital (FA Brand Studio) | FA Media | NO | 2026-06-08 | Dekning 167k/dag; native Readpeak CPC 20; Premium SOV 60 000/uke; branded video |
| `avfall/Avfallsbransjen.no…`, `…Biogassbransjen.no…`, `…Hydrogen24.no…` | Avfallsbransjen, Biogassbransjen, Hydrogen24 | Arnt Erik / Smallstep | NO | 2026-06-04 | Content marketing 12 500/2u, 20 000/4u |
| `oyblikk/Priser2026.pdf`, `oyblikk/NettPriser2026.pdf` | Øy-Blikk | — | NO | 2026-06-08 | Banner nett + print only, **no native product** |
| `vestavind/vestavind_modulkart og prisar 2026.pdf` | Vestavind | — | NO | 2026-06-08 | Nett 1 450–2 750/uke + print modulkart, **no native product** |
| `rytter/Rytter-Nryfstevne_Medieplan-2026.pdf` | Rytter.no | — | NO | 2026-06-04 | Medieplan (native-pris i plan) |
| `aller/Aller Native 2026.pdf` | Allas, Hänt i Veckan, Hänt Extra, ELLE Mat & Vin, Femina (+Aller SE-portföljen) | Camilla Hedström, Client Manager Aller Media (SE) | SE | 2026-06-08 | Native digital paket (Allas 70k/125k/150k; Hänt 95k/143k/175k + standard 55k; Native Recept 70k/90k/110k; Hänt Extra helsida 28k/uppslag 42k); Native SOME Video 150k / Native Video 190k. Netto exkl moms |
| `aller/Alla varumarken - Aller 2026.pdf` | Hela Aller SE-portföljen (Allas, Femina, MåBra, Hänt, Svensk Dam, ELLE-familjen, Residence, Allers, Hemmets, Matmagasinet…) | Camilla Hedström | SE | 2026-06-08 | Räckvidd/demografi per varumärke (Orvesto 2024 + GA feb-25): allas.se 378k, femina.se 192k, hant.se 485k, svenskdam.se 512k, elle.se 318k, mabra.com 95k, residencemagazine.se 25k |

## Notes
- The Aller (SE) mediekit was delivered as a **WeTransfer link** (not an attachment); both
  PDFs are now downloaded and stored in `aller/` (Native product blad + full brand/reach deck).
- Cykling (SE) sent the rate card as an `ocast` link (not a PDF); native price (11 000 SEK) is in the email body.
- Some earlier-day mediekits were downloaded on Andreas's own machine and may not all be present here;
  this folder holds every attachment recoverable from the campaign inbox as of 2026-06-08.
- Per-reply ingest scripts live in `scripts/ingest-*-0608.ts` (and `-0604`/`-0605`).
