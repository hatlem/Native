# Online Audit — 2026-06-06

Every uncontacted publisher group in the outreach send list was checked online
(workflow `wf_1fdfa859-833`, 455 agents): each title for a current still-publishing
signal, each ad email against the publisher's own site (raw-HTML extraction).
Per the catalog data standard: no live signal -> quarantined, never guessed alive.

## Results

| | count |
|---|---|
| Groups audited | 455 |
| Groups kept sendable | 421 |
| Titles confirmed alive | 1153 (incl. 56 already-contacted groups) |
| Titles killed (dead/merged) | 20 |
| Titles renamed (kept under new name) | 20 |
| Titles quarantined (uncertain / wrong publisher) | 31 |
| Ad emails corrected from publisher site | 35 |
| Groups quarantined (email unconfirmable) | 13 |
| Groups dropped (no surviving titles) | 21 |

## Killed titles (closed or merged away — also mark discontinued in DB)

- **Eltern** (DE, group verkaufsbuero.hamburg@ad-alliance.de) — DEAD. Print Eltern ceased 2023 (digital-only on eltern.de); brand transferred to Funke 2025. Ad Alliance brand page now 404. Print magazine as sold subscription title is dead; only online + a free pharmacy customer magazine remain. [https://de.wikipedia.org/wiki/Eltern_(Zeitschrift)]
- **AOK** (DK, group annoncering@berlingskemedia.dk) — MERGED -> Berlingske (AOK section, berlingske.dk/aok). Standalone aok.dk merged into berlingske.dk in 2018; now redirects to berlingske.dk/aok. Still an active content pillar per Berlingske's own site description ('Nyheder, Opinion, Business og AOK'). [https://www.dr.dk/nyheder/penge/berlingske-lukker-stribe-af-hjemmesider-i-massiv-sparerunde]
- **Turkulainen** (FI, group mediamyynti@aamuset.fi) — DEAD. On indefinite publishing pause since 13.4.2020; newest site articles late 2023/early 2024; publisher gave up editorial premises, no return [https://www.ts.fi/uutiset/5642660]
- **Akademikerbladet** (DK, group annoncer@folkeskolen.dk) — DEAD. Journalisten (5 May 2026): 'Akademikerbladet eksisterer ikke laengere' - DM board discontinued both print and digital; final issue March 2026, replaced by a newsletter without editorial independence. [https://journalisten.dk/efter-maaneders-mystik-er-akademikerbladet-nu-endegyldigt-doedt/]
- **Landfreund** (DE, group onlinevermarktung@lv.de) — MERGED -> die grüne. Swiss LV title; ceased with May 2022 issue, replaced by 'die grüne' in top agrar/profi combo-abo; landfreund.de 301-redirects to topagrar.com [https://www.diegruene.ch/artikel/panorama/landfreund-eingestellt-die-gruene-top-agrar-profi-419231]
- **Helserevyen** (NO, group annonser@dagensmedisin.no) — DEAD. helserevyen.no returns HTTP 410 Gone (apex) / 403 (www); last Wayback snapshot Aug 2024 was already a parked seller-ratings landing page, no real content [http://web.archive.org/web/20240808050650/https://www.helserevyen.no/]
- **Arena** (SE, group jesper.bengtsson@arenagruppen.se) — MERGED -> Dagens Arena. Print magazine 'Magasinet Arena' ceased in 2017 after 24 yrs (economic reasons); journalism moved to online Dagens Arena, which is live and publishing today (2026-06-06). [https://www.journalisten.se/nyheter/magasinet-arena-laggs-ned/]
- **Uusi Suomi** (FI, group myynti@almamedia.fi) — MERGED -> Iltalehti. Publisher (Alma Media) announced 2026-05-20 that Uusi Suomi's politics/international content and the Puheenvuoro blog merge into Iltalehti in autumn 2026; subscriptions convert to Iltalehti Plus Extra. Site still live today (articles dated 2026-06-06, HTTP 200), but the title is being folded into Iltalehti. [https://www.almamedia.fi/blog/2026/05/20/iltalehti-ja-uusi-suomi-yhdistavat-toimituksensa/]
- **BWagrar** (DE, group kundenservice@ulmer.de) — MERGED -> Baden-Württembergisches landwirtschaftliches Wochenblatt (BW Wochenblatt). From Feb 2026 (issue 5/2026) BWagrar + Badische Bauernzeitung merged into BW Wochenblatt; BWagrar now continues only as the Stuttgart regional edition under that masthead. Publisher still sells 'BW Wochenblatt Regionalausgabe BWagrar' with 2026 pricing and has a 2026 BWW Mediadaten PDF. [https://www.ulmer.de/server_mediacenter/BWW_Mediadaten_2026.pdf]
- **Sport+Mode** (DE, group torsten.wessel@chmielorz.de) — MERGED -> SAZsport. VDS (German sports-retail assn) confirms sport+mode was merged into SAZsport on 1 Sept 2021; not in Chmielorz's current brands list. [https://www.vds-sportfachhandel.de/fusion-sazsport-sportmode/]
- **Reality** (IE, group sales@redcoms.org) — DEAD. Redemptorist Communications ceased publishing Reality; last issue Dec 2022, confirmed by the Redemptorists' own news site cssr.news. [https://www.cssr.news/2022/12/reality-a-magazine-closes-but-also-an-era-in-irish-religious-culture/]
- **Trä & Möbelforum** (SE, group info@tmf.se) — DEAD. Publisher TMF's own news article (dated 2023-05-10) states the last print issue of Trä & Möbelforum was released in 2023 after ~20 years (since 2005); content moved to TMF digital channels. Dedicated domain traomobelforum.se no longer connects (ECONNREFUSED). [https://www.tmf.se/om-tmf/nyheter/20232/052/tra--mobelforum--nastan-20-ar-av-branschtidningsinnehall-blir-nu-digitalt/]
- **Banana Split** (DK, group admin@basilisk.dk) — DEAD. Publisher's own catalog subtitles it 'Tidsskrift for multinational litteratur (1991-2010)'; only back issues (1-28) sold, no current/forthcoming issues. [https://basilisk.dk/product-category/banana-split/]
- **Hotel & Restaurant** (DK, group hrf@hansreitzel.dk) — DEAD. DK hotel/restaurant trade magazine in HORESTA's lineage was relaunched as VISITOR (2020) and the print magazine was closed on 23 Feb 2023 with no print replacement; HORESTA's current media page lists only newsletters and social, no such title. [https://www.horesta.dk/nyheder/2023/februar/horesta-oeger-digitale-fokus-og-lukker-branchemagasin/]
- **National Geographic Norge** (NO, group hsmedia@hsmedia.no) — DEAD. Norwegian edition ceased; last issue 15/2020 [https://deichman.no/utgivelse/pd94e073556e58f3ed55e258fa30e1fa9]
- **Aktiv Trening** (NO, group hsmedia@hsmedia.no) — MERGED -> I Form. Final print May 2023, merged into I Form (Bonnier cut NO editor) [https://www.journalisten.no/bonnier-slar-sammen-magasiner-kutter-norsk-redaktor/541833]
- **Östra Småland** (SE, group tony.sjosten@gotamedia.se) — DEAD. Closed by Gota Media in Nov 2019 (SVT + Barometern reporting) [https://www.svt.se/nyheter/lokalt/smaland/ostra-smaland-och-nyheterna-laggs-ner]
- **Nybro Tidning** (SE, group tony.sjosten@gotamedia.se) — DEAD. Domain nybrotidning.se is an infinite 301 redirect loop (no site); KB record shows publication ended 2021-10-14; Nybro now covered by Barometern /nybro [https://libris.kb.se/dtqsfp8tb047v7r3]
- **U Magazine** (IE, group karl.byrne@dmgmedia.ie) — DEAD. Ceased print July 2018 (Harmonia/Irish Studio title, not DMG); final newsstand issue Aug 2018 [https://www.irishtimes.com/business/it-s-not-u-it-s-digital-as-another-glossy-exits-the-news-stands-1.3559013]
- **Meidän Talo** (FI, group yritysasiakkaat@a-lehdet.fi) — MERGED -> Unelmien Talo&Koti. Print ceased; final issue 27 Nov 2024; subscribers moved to Avotakka / Unelmien Talo&Koti; own brand page now redirects [https://www.meillakotona.fi/lehdet/meidan-talo]

## Renamed titles (alive — send list updated to new name; add old name as alias in DB)

- **Ringkøbing-Skjern Dagblad** -> **Dagbladet Ringkøbing-Skjern** (DK, group business@jfm.dk). Founded as Ringkjøbing Amts Dagblad, renamed Dagbladet Ringkøbing-Skjern; live JFM title at dbrs.dk (HTTP 200) and on JFM brands page [https://dbrs.dk/]
- **ELLE Denmark** -> **ELLE (published by Toast Projects)** (DK, group mediesalg@aller.dk). Left Aller from 2024 (Aller did not renew the license); now published in Denmark by Toast Projects. Title still alive (elle.dk live) but no longer an Aller title. [https://journalisten.dk/elle-danmark-fortsaetter-paa-print-under-ny-udgiver/]
- **Ukeavisen Ledelse** -> **Dagens Perspektiv** (NO, group bl@medierogledelse.no). Publisher Medier og Ledelse (Magne Lerø) lists Dagens Perspektiv as its product, not Ukeavisen Ledelse; successor site dagensperspektiv.no is live with daily 2026 articles on ledelse/arbeidsliv. [https://www.dagensperspektiv.no/]
- **Research Professional** -> **Research Professional News** (UK, group advertise@researchresearch.com). Now the Clarivate-owned umbrella brand 'Research Professional News'; news at researchprofessionalnews.com, funding database rebranded to Pivot-RP; no discrete magazine titled 'Research Professional' [https://clarivate.com/academia-government/scientific-and-academic-research/research-funding-analytics/research-professional-news/publications/]
- **Neues Deutschland** -> **nd (nd.DerTag / nd.DieWoche)** (DE, group c.hoppe@nd-online.de). Old nd-online.de redirects to nd-aktuell.de; rebranded to 'nd', weekday edition now nd.DerTag, weekend nd.DieWoche; live with June 2026 articles. Print ePaper ceased 1 Apr 2026, now digital-only. [https://www.nd-aktuell.de/]
- **Vagabond** -> **Vagabond Reiselyst** (NO, group info@vagabondreiselyst.no). vagabond.no 301-redirects to vagabondreiselyst.no; title folded into Magasinet Reiselyst after acquisition and now publishes as 'Vagabond Reiselyst' with dated articles through May 2026 - clearly alive under the merged brand. [https://vagabondreiselyst.no/]
- **MotorMagasinet** -> **Motor (NAF-magasinet Motor / motor.no)** (NO, group phb@hsmedia.no). HS Media's brands page lists 'Motor' (NAF magazine), not 'MotorMagasinet'; NAF Motor is published 4x/yr to members and motor.no updates daily with 2026 content (sommerdekktest 2026, El Prix 2026). The Danish/Swedish 'MotorMagasinet' is an unrelated Nordiske Medier title. [https://www.hsmedia.no/publikasjoner/motor]
- **Camping & Husvagn** -> **Husvagn & Camping (Allt om Husvagn & Camping)** (SE, group anders@sb-media.se). On-file title is the publisher's leading caravan/camping magazine, branded 'Husvagn & Camping' (word order). Actively publishing: dated article 2026-03-02 plus content through June 2026; published by Story House Egmont, ad sales by SB Media. [https://www.husvagnochcamping.se/artiklar/artikel/20260302/husvagn-camping-50-ar-andra-delen/]
- **Personal & Ledarskap** -> **TLNT (tlnt.se)** (SE, group annons@chef.se). Sveriges Tidskrifter trade press confirms Personal & Ledarskap (founded 1969) was phased out and replaced by new brand TLNT, live Nov 2023; personalledarskap.se now serves TLNT.se branding; TLNT active with 2024 articles + live LinkedIn. [https://sverigestidskrifter.se/artikel/ny-mediesajt-inom-hr-vd-jag-vill-skaka-om-pa-riktigt/]
- **KøgeAvisen** -> **Ugeavisen Køge** (DK, group koege.salg@sn.dk). Köge weekly is published by Sjællandske Medier as 'Ugeavisen Køge'; its own contact page is active and a current edition (Uge 17, April 2026) exists on e-pages. [https://www.sn.dk/kontakt-os/kontakt-ugeavis/kontakt-ugeavisen-koege/]
- **Børsens Magasin** -> **Børsen Pleasure** (DK, group thomas@media-sales.dk). Børsen's lifestyle supplement, now branded 'Børsen Pleasure'; borsen.dk/nyheder/pleasure carries articles dated 2026-06-07 (live signal). [https://borsen.dk/nyheder/pleasure]
- **Elektriker** -> **Fagbladet DEF** (DK, group def@def.dk). Elektrikeren (Dansk El-Forbunds fagblad) renamed to Fagbladet DEF in 2023 (wk 38); still actively publishing 6x/yr, next issue 12-08-2026 per Danske Medier media DB. [https://media.danskemedier.dk/default.asp?blad=124]
- **Post Magazine** -> **Insurance Post** (UK, group csqueries@infopro-digital.com). Now branded Insurance Post at postonline.co.uk; live site with 2026-dated content (2026 Power List, British Insurance Awards 8 July 2026) [https://www.postonline.co.uk/people/7960292/insurance-post-podcast-reveals-2026-power-list]
- **Computer Business Review** -> **Tech Monitor** (UK, group aziz.rahman@techmonitor.ai). Publisher's own article states CBR (print mag from 1993) rebranded to Tech Monitor in 2020; cbronline.com redirects to techmonitor.ai, which publishes current 2026 articles. [https://www.techmonitor.ai/leadership/strategy/computer-business-review-tech-monitor]
- **Energy 2.0** -> **ENERGY (formerly Energy 4.0)** (DE, group sales@publish-industry.net). publish-industry's product page at /en/products/energy-2-0/ now brands the title 'Energy 4.0' / 'ENERGY'; active with a March 2026 e-paper edition and a 2026 mediakit dated Jan 2026. [https://www.publish-industry.net/en/products/energy-2-0/]
- **Der Österreichische Journalist** -> **Österreichs Journalist:in** (AT, group vertrieb@oberauer.com). Renamed March 2021 to gender-inclusive title; still published by Oberauer (latest issue 2026#02 in shop), confirmed by Wikipedia + derStandard. [https://de.wikipedia.org/wiki/%C3%96sterreichs_Journalist:in]
- **Logistikk i Norden** -> **Intelligent Logistik** (SE, group gb@intelligentlogistik.se). No standalone title 'Logistik i Norden' exists; the publisher's actual active brand is 'Intelligent Logistik' (self-described as 'Nordens största logistiktidning'). Site live with newest articles dated Oct 27 2025; build date 2026-06-06; om-oss says still published (two issues/year). [https://intelligentlogistik.com/om-oss/]
- **Byggdrifteren** -> **NemiTek** (NO, group jan.erik@nemitek.no). Magazine Byggdrifteren was rebranded to NemiTek; first NemiTek issue released 2026-02-25 per Fagforbundet announcement 'Byggdrifteren blir NemiTek' [https://www.fagforbundet.no/a/388423/yrke/vaktmestere-og-byggdriftere/aktuelt/byggdrifteren-bli-nemitek/]
- **Lakimiesuutiset** -> **Juristiuutiset** (FI, group niina.tuulaskoski@saarsalo.fi). Publisher Lakimiesliitto renamed to Juristiliitto (official 19 May 2025); member magazine rebranded Lakimiesuutiset -> Juristiuutiset, active (81st volume, 2026 media card) [https://juristiliitto.fi/tietoa-lehdesta/]
- **Kuljetus** -> **Kuljetus & Logistiikka** (FI, group myynti@kuljetuslehti.fi). Publisher site now brands the title 'Kuljetus & Logistiikka'; fresh 2026 issue announcement confirms it is actively publishing [https://www.kuljetuslehti.fi/2026/lue-kuljetus-logistiikka-lehden-uusi-numero-3/]

## Title quarantine (manual review — not sent)

- **Allers DK** (DK, group mediesalg@aller.dk) — uncertain. No standalone 'Allers' magazine on Aller DK's brands page; 'Allers weeklies' is Aller's umbrella term for its portfolio, and a single 'Allers' title is the NO/SE edition, not a DK title.
- **Costume DK** (DK, group mediesalg@aller.dk) — wrong-publisher. Alive but published by Bonnier Publications, not Aller; absent from Aller's brands page. PressReader shows issues 226-229 across 2024-2025.
- **Hjemmet (DK)** (DK, group mediesalg@aller.dk) — wrong-publisher. Alive but published by Egmont, not Aller; absent from Aller's brands page. Weekly (every Monday), hjemmet.dk live (HTTP 200), ~123k copies/week.
- **Costume Living** (DK, group mediesalg@aller.dk) — wrong-publisher. Alive but published by Bonnier Publications, not Aller; absent from Aller's brands page. Listed in Bonnier's current portfolio as a high-end spin-off of Costume.
- **Auranmaan Viikkolehti** (FI, group mediamyynti@aamuset.fi) — wrong-publisher. avl.fi carries April 2026 articles; prints Tue/Fri for Auranmaa region (separate publisher)
- **Nordwest-Zeitung (NWZ)** (DE, group anzeigen@owl-mediasolutions.de) — wrong-publisher. nwzonline.de actively publishing 2026; Oldenburg title acquired by Madsack Jan 2026 but unchanged name. NOT marketed by OWL Media Solutions (separate publisher)
- **Norsk Politi** (NO, group vidar@salgsfabrikken.no) — uncertain. Magasinet Norsk Politi published by Politidirektoratet (separate publisher, not Salgsfabrikken); latest issue found dated 2018, landing page is JS-rendered with no visible current issues and no closure notice.
- **Health Service Journal** (UK, group advertising@solicitorsjournal.com) — wrong-publisher. hsj.co.uk live with 2026 NHS news and HSJ Digital Awards 2026; separate publisher from Solicitors Journal
- **University Times** (IE, group advertising@trinitynews.ie) — wrong-publisher. Live universitytimes.ie with articles dated May/June 2026; TCDSU's editorially-independent student paper (separate publisher from Trinity News).
- **absatzwirtschaft** (DE, group sales@wuv.de) — wrong-publisher. Live at absatzwirtschaft.de with fresh 2026 articles; print ceased June 2024 after 67 years, now digital-only. Published by Handelsblatt Media Group, NOT W&V/Ebner — wuv.de email does not cover this title.
- **Top Hotel** (DE, group thilo.paulin@forum-zeitschriften.de) — uncertain. Not a Forum Zeitschriften title — absent from publisher's own brands list; tophotel.de impressum shows freizeit-verlag.de/Holzmann Medien, a different publisher. Magazine itself is active but misattributed to this publisher
- **Norsk Fiskerinæring** (NO, group annonser@kystogfjord.no) — wrong-publisher. Separate publisher (Norsk Fiskerinaering AS, Eidsvoll, not Kyst og Fjord AS); norskfisk.no shows edition 1-2026 (Feb 2026) plus 'Siden Sist' news briefs dated June 1-3, 2026.
- **Seilas** (NO, group salg@seilmagasinet.no) — wrong-publisher. Active but published by KNS via VB Media, NOT by this publisher; digital launch Apr 2025, 4 print issues planned 2026, 4,600 circulation in VB Media kit.
- **Tidsskriftet A** (NO, group bedriftskontakt@broderskabet.no) — uncertain. Publisher keeps a live dedicated page for it, but no dated 2024-2025 issue found; Issuu profile shows no current publications.
- **Babyverden Mag** (NO, group desk@babyverden.no) — uncertain. Publisher (Sandviks AS) is alive and active, but no current signal for a title named 'Babyverden Mag' — their ad page lists only digital channels (web/app/newsletter/sponsored content) and their print product is 'Spedbarnsboken', not a magazine by this name.
- **Camping og Friluftsliv** (DK, group info@campingferie.dk) — uncertain. Not found in this publisher's portfolio — its 2026 media plan and homepage list only Campingferie.dk, Autocampernyt.dk and Campingbladet.dk; no current signal for a title by this exact name.
- **Logistik & Transport** (DK, group salg@nordiskemedier.dk) — uncertain. No DK title by this exact name found at Nordiske Medier; its current transport/logistics brands are Transportmagasinet, Lastbilmagasinet, Soefart, and SCMNews. A Danish 'Lager & Transport - Logistikmagasinet' exists but is published by Mediehuset Odsgard, not Nordiske Medier; 'Logistik & Transport' also matches a Swedish Nordiske Medier event/title. No current signal ties this exact title to this DK publisher.
- **Sastamalan Lehti** (FI, group ilmoitukset@alueviesti.fi) — uncertain. Publisher Aluelehdet Oy/Alueviesti lists no such title; its brands page shows only Alueviesti, Alueradiot (Iskelma/Radio City) and Aluepaino. No active site, recent articles, or merge/closure evidence found for this exact name.
- **Erikoislehti Riista** (FI, group antti.tikkanen@otava.fi) — wrong-publisher. riistalehti.fi serves current 2026 content; latest issue 04/2026 published 12.05.2026. BUT published by Outdoor Media Oy, not by the on-file contact's company (Otavamedia) — Riista is absent from Otavamedia's own brand roster.
- **Kollegiaalisuus** (FI, group toimitus@kollega.fi) — uncertain. No magazine by this name exists on the publisher site or in searches; 'kollegiaalisuus' is a generic Finnish word ('collegiality'). Publisher's actual brand is the online magazine Kollega.fi (live, 2025-dated articles). Likely a catalog mislabeling of the publisher name Kollega.
- **Swim** (UK, group advertising@swimming.org) — uncertain. No current signal that Swim England (swimming.org) publishes a title literally called 'Swim'. Its ad offer is website + e-newsletters + social media only; print magazine 'Swimming Times' closed in 2019. A separate 'SWIM' lifestyle magazine exists but is published by GMC Publications, a different publisher/domain.
- **Wicklow Voice** (IE, group info@wicklownews.net) — uncertain. Not mentioned anywhere on the publisher's own site (branded 'Wicklow News', founded 2010); targeted searches surface only Wicklow News/Times/People/News-Letter, never a 'Wicklow Voice'. No current live signal; publisher itself has paused updates (latest article Feb 2026).
- **Liffey Champion** (IE, group natasha.bolger@kildare-nationalist.ie) — uncertain. No website resolves (HTTP 000 on all .ie/.com variants); no 2026-dated articles found. Only third-party directory + social traces (IG 'this week's newspaper' post dating ~2024-25); no confirmed current signal.
- **Bil & Bostad** (SE, group annonssynpunkter@svd.se) — uncertain. Not an SvD title (SvD's car supplement is 'Bil & Motor'); 'Bil & Bostad' is a Vasterbottens-Kuriren supplement whose only datable issues are 2010 and 2021 - no current 2023-2026 signal found.
- **Katten** (SE, group annons@varakatter.se) — uncertain. Publisher site is 'Vara Katter' (SVERAK); 'Katten' is not its name nor any historical name (Felix->Vara Katter->Kattjournalen->Vara Katter), and no live Swedish magazine literally named 'Katten' was found.
- **MP Lehti** (FI, group mediamyynti@motouutiset.fi) — uncertain. Publisher motouutiset.fi (Motouutiset Suomi Oy) lists only ONE brand: the online magazine 'Motouutiset' - no publication named 'MP Lehti' appears on its own site or contact page. 'MP-lehti' is a generic Finnish term (MP=motorcycle, lehti=magazine); web hits point to unrelated titles (a 1985 MP-lehti, plus MP Maailma/Bike/MP1 owned by other publishers). The named title cannot be confirmed as a real current title under this publisher; its live brand is Motouutiset (record 193,000 readers, April 2026).
- **IKEA Family Live** (NO, group hsmedia@hsmedia.no) — uncertain. No current Norwegian-edition signal; 'IKEA Family Live' branded magazine effectively superseded by Life at Home content
- **Coop Medlem** (NO, group hsmedia@hsmedia.no) — uncertain. 'Coop Medlem' is Coop NO membership program/app; no clear current standalone member magazine by this name
- **NHO Magasinet** (NO, group hsmedia@hsmedia.no) — uncertain. Only evidence of NHO-magasinet from 2012; no current publication signal found
- **BAM (Bondelag)** (NO, group hsmedia@hsmedia.no) — uncertain. No clear match; Norges Bondelag's known member paper is Bondebladet, 'BAM' unconfirmed
- **VIP Magazine** (IE, group karl.byrne@dmgmedia.ie) — wrong-publisher. Live site vipmagazine.ie with 2026 content; published by VIP Publishing, not DMG Media

## Email corrections (applied; old address kept as wasEmail)

- UK: yourads@dcthomson.co.uk -> **newspapersales@dcthomson.co.uk** [https://www.dcthomson.co.uk/contact/]
- DE: onlinevermarktung@lv.de -> **mediamarketing@lv.de** [https://lv-mediasales.de/kontakt/]
- NO: bl@medierogledelse.no -> **ml@dagensperspektiv.no** [https://www.dagensperspektiv.no/annonse]
- NO: kristen.sandvold@byggfakta.no -> **kristensandvold@gmail.com** [https://vvsaktuelt.no/annonse/]
- DK: tobias@tipsbladet.dk -> **tcj@tipsbladet.dk** [https://www.tipsbladet.dk/kontakt/]
- FI: lukijailmoitukset@media.fi -> **trafiikki@kaakonviestinta.fi** [https://meks.fi/wp-content/uploads/2025/01/Kymen-Sanomat-Mediakortti-2025.pdf]
- FI: toimisto@pellervo.fi -> **sanna.makinen@saarsalo.fi** [https://maatilanpellervo.fi/yhteystiedot/]
- NO: post@kulingen.no -> **marked@kulingen.no** [https://annonseweb.kulingen.no/nb/contact]
- NO: geir@sagat.no -> **annonse@sagat.no** [https://www.sagat.no/annonser]
- NO: post@osthavet.no -> **annonser@osthavet.no** [https://osthavet.no/kontakt-oss/]
- NO: dyllan.debord@lydogbilde.no -> **post@lydogbilde.no** [https://www.lydogbilde.no/annonsere/]
- NO: kundeservice@minerva.no -> **ahl@minerva.no** [https://www.minerva.no/annonser]
- NO: annonse@utrop.no -> **ola@utrop.no** [https://www.utrop.no/kontaktinformasjon/]
- NO: david@travelnews.no -> **david@travelnewsmedia.no** [https://travelnews.no/annonser/]
- NO: phb@hsmedia.no -> **pbh@hsmedia.no** [https://www.hsmedia.no/digitalt/motor.no]
- SE: annons@kristianstadsbladet.se -> **kundcenter@gotamedia.se** [https://annonsera.kristianstadsbladet.se/]
- SE: jon.ost@svenskamedia.se -> **jon.ost@spmedia.se** [https://www.byggvarlden.se/kontakt/]
- SE: gregers@scandasia.com -> **gregers@scandmedia.com** [https://scandasia.com/contact-us/]
- DK: koege.salg@sn.dk -> **uak.salg@sn.dk** [https://www.sn.dk/kontakt-os/kontakt-ugeavis/kontakt-ugeavisen-koege/]
- DK: red@aktuelnaturvidenskab.dk -> **jd@aktuelnaturvidenskab.dk** [https://aktuelnaturvidenskab.dk/om-os]
- FI: minna.kamotskin@pelastustieto.fi -> **ilmoitukset@pelastustieto.fi** [https://pelastustieto.fi/yhteystiedot/]
- UK: opportunities@tortoisemedia.com -> **commercial@observer.co.uk** [https://www.tortoisemedia.com/contact-us]
- UK: ads@totalpolitics.com -> **harry.mason@messagespace.co.uk** [https://labourlist.org/advertise-on-labourlist-labour-party-members-adverts-sponsorship-mps-reach/]
- UK: csqueries@infopro-digital.com -> **sabina.begum@infopro-digital.com** [https://www.postonline.co.uk/static/contact-us]
- UK: jennifer@contentmediaservices.co.uk -> **jennifer.collins@contentms.co.uk** [https://www.ribaj.com/advertise-with-us/]
- DE: onlinesales@pnp.de -> **anzeigen.taa@mgbayern.de** [https://www.pnp.de/anzeigen]
- DE: kundenservice@mittelbayerische.de -> **anzeigen@mgbayern.de** [https://www.mittelbayerische.de/kontakt/anzeigen]
- SE: annons@mediakraft.se -> **annonsera@tandlakartidningen.se** [https://www.tandlakartidningen.se/kontakta-oss/]
- NO: post@tennis.no -> **admin@tennis-norge.com** [https://www.tennis-norge.com/kontakt-oss/]
- NO: post@bakeri.net -> **cicilie@vestvind.no** [https://www.bakeri.net/annonsepriser-bakerinet]
- SE: annons@pausermedia.se -> **Yuksel.u@pausermedia.se** [https://miljo-utveckling.se/annonsera/]
- NO: post@abm-media.no -> **sissel@eddapresse.no** [https://abm-media.no/kontakt-abm-media/]
- NO: post@handikapnytt.no -> **robin@hasleconsult.no** [https://www.handikapnytt.no/annonsere/]
- NO: support@gamer.no -> **annonsere@gamer.no** [https://skagerrak.tech/annonsering]
- DE: clauberg@aerzteverlag.de -> **b.wilbert@mgo-fachverlage.de** [https://mgo-fachverlage.de/mediadaten/dentalmagazin/]

## Groups quarantined (email could not be confirmed on the publisher's own site)

- UK: sales@vogueuk.co.uk — no ad email confirmable on publisher's own site — Publisher is Condé Nast Britain (condenast.co.uk), reachable. EMAIL: the on-file sales@vogueuk.co.uk is WRONG — vogueuk.co.uk is a heated towel rail / designer radiator manufacturer in the West Midlan
- UK: james.creber@markallengroup.com — no ad email confirmable on publisher's own site — Publisher is Mark Allen Group / MA Business; the title runs its own live site at manufacturingmanagement.co.uk. The title is clearly ALIVE: news dated April/May 2026, a current 2026 print issue ('Powe
- IE: advertising@businesspost.ie — no ad email confirmable on publisher's own site — Business Post (Ireland) is clearly ALIVE: businesspost.ie carries multiple articles dated June 4-6, 2026 (today), publishing daily. AD EMAIL is UNCONFIRMED: the official site (www.businesspost.ie, inc
- IE: advertising@farmersjournal.ie — no ad email confirmable on publisher's own site — Publisher site (farmersjournal.ie) loads fine. The on-file generic ad address advertising@farmersjournal.ie does NOT appear in raw HTML anywhere on the official site. The dedicated advertising-contact
- DE: media-solutions@faz.de — no ad email confirmable on publisher's own site — Publisher reachable: faz.net (HTTP 200, current articles) and the corporate publisher site frankfurterallgemeine.de are live. Both titles are alive in 2026 — F.A.Z. publishes daily on faz.net, and F.A
- NO: admin@procycling.no — no ad email confirmable on publisher's own site — procycling.no (Procycling Norge) is live and actively publishing: a WordPress site whose RSS/homepage carry articles dated 30-31 May 2026 about the 2026 Giro d'Italia and Tour de Romandie, so the titl
- NO: marked@handball.no — no ad email confirmable on publisher's own site — Publisher is Norges Håndballforbund (handball.no), the Norwegian Handball Federation. The official site loads and is clearly active — homepage carries multiple June 2026 dated news items (new men's co
- NO: advert@sagepub.co.uk — no ad email confirmable on publisher's own site — Publisher is SAGE Publishing (sagepub). Official site loads. Nordic Journal of Nursing Research is ALIVE: it is open-access since 2023, current volume is 45 (2025), and a 2025 article (DOI 10.1177/205
- NO: havard.bjerkeng@juridika.no — corrected email only found on web.archive.org (not current)
- DK: sa@huginmedia.dk — no ad email confirmable on publisher's own site — Publisher Hugin Media ApS appears defunct. Its own domain huginmedia.dk now returns a Gigahost 'This website is not in use yet' placeholder (every page 404, including the om-hugin-media-aps and annonc
- UK: media@theguardian.com — no ad email confirmable on publisher's own site — The Guardian (UK) is unambiguously alive: its homepage carries articles dated through 2026-06-06 and the full site loads. On the ad email: media@theguardian.com DOES appear in the raw HTML of the offi
- DE: vanessa.leppert@wbv.de — no ad email confirmable on publisher's own site — The on-file email vanessa.leppert@wbv.de uses the WRONG domain. wbv.de is an unrelated academic publisher ("wbv Publikation"). The actual publisher of these health magazines is Wort & Bild Verlag, who
- AT: bergauf@agentur-ds.at — no ad email confirmable on publisher's own site — ÖAV Bergauf is the member magazine of the Österreichischer Alpenverein (alpenverein.at), which loaded fine. It is clearly alive: the official site hosts a dedicated 2025 issues page (returns HTTP 200)

## Groups dropped (no titles survived)

- NO: bedriftskontakt@broderskabet.no — titles: Tidsskriftet A
- NO: desk@babyverden.no — titles: Babyverden Mag
- SE: jesper.bengtsson@arenagruppen.se — titles: Arena
- DK: info@campingferie.dk — titles: Camping og Friluftsliv
- DK: salg@nordiskemedier.dk — titles: Logistik & Transport
- FI: myynti@almamedia.fi — titles: Uusi Suomi
- FI: ilmoitukset@alueviesti.fi — titles: Sastamalan Lehti
- FI: antti.tikkanen@otava.fi — titles: Erikoislehti Riista
- FI: toimitus@kollega.fi — titles: Kollegiaalisuus
- UK: advertising@swimming.org — titles: Swim
- IE: info@wicklownews.net — titles: Wicklow Voice
- DE: kundenservice@ulmer.de — titles: BWagrar
- DE: torsten.wessel@chmielorz.de — titles: Sport+Mode
- IE: natasha.bolger@kildare-nationalist.ie — titles: Liffey Champion
- SE: annonssynpunkter@svd.se — titles: Bil & Bostad
- SE: annons@varakatter.se — titles: Katten
- IE: sales@redcoms.org — titles: Reality
- SE: info@tmf.se — titles: Trä & Möbelforum
- DK: admin@basilisk.dk — titles: Banana Split
- FI: mediamyynti@motouutiset.fi — titles: MP Lehti
- DK: hrf@hansreitzel.dk — titles: Hotel & Restaurant

Full provenance (every verdict + evidence URL): `data/outreach/outreach_online_audit_0606.json`.
Re-apply with `node scripts/apply-online-audit-0606.cjs` (idempotent).
