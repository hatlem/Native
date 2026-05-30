# Sales-House Routing — non-direct title outreach

Every title is now classified by `Title.salesChannel`:

| Channel | Titles | Route outreach to |
|---|---|---|
| `DIRECT` | 1,177 | the title's own scraped ad contact |
| `IN_HOUSE` | 1,854 | the publisher group's own ad department (below) |
| `REP` | 121 | the independent rep house (below) — true middleman |

The badge is visible per publisher on `/desk/publisher-contacts`.

**Loaded into the DB** by `scripts/load-sales-house-contacts.ts` (machine-readable
form of the tables below). As of the last run it created SalesContacts covering
**1,216 of the 1,975 non-direct titles** (23 originally-researched houses + 46
long-tail houses from the Sonnet swarm, see bottom); the remaining ~759 titles
run through smaller houses with no verified email yet and are
**left unmapped on purpose** — fill those in here, then rerun the loader.
DIRECT titles are handled separately by `scripts/approve-direct-candidates.ts`
(promotes the best scraped candidate per publisher, ≥80 confidence).

`IN_HOUSE` and `REP` titles should be routed to the sales house's advertising
inbox, **not** the per-title editorial address the scraper found. Below is the
research result — verify before bulk-sending. **Rule applied during research:
only emails actually seen on a fetched page are listed; gaps are left blank
rather than guessed.**

## In-house ad arms (the publisher group's own department)

| Sales house | ~Titles | Market | Advertising email | Conf. | Source |
|---|---|---|---|---|---|
| Amedia Salg | 87 | NO | `marked@amedia.no` | high | amediaannonse.no/om-oss/kontaktinformasjon |
| Sanoma Media Finland | 44 | FI | `digimedia@sanoma.fi` | high | media.sanoma.fi/en/contact-info |
| Bauer Media Commercial | 36 | UK | `advertising@bauermedia.co.uk` | high | bauermedia.co.uk/contact |
| Future Commercial | 69 | UK | `advertising@futurenet.com` | high | futureplc.com/contact |
| JP/Politikens Hus | 26 | DK | `annonce@jp.dk` | high | jpannonce.dk/da/contact |
| Egmont Publishing DK | 24 | DK | `annoncesalg@egmontmagasiner.dk` | high | mediasales.storyhouseegmont.dk/contacts |
| Ad Alliance | 19 | DE | `Verkaufsbuero.Hamburg@ad-alliance.de` | high | ad-alliance.de/cms/kontakt.html |
| Aller Media (SE) | 18 | SE | `erik.hamberg@aller.com` | high | aller.se/kontakt (Head of Revenue) |
| Polaris Media Salg | 32 | NO | `paal.munkvold@adresseavisen.no` | medium | midt.polarismedia.no/kontakt-oss (Annonsedirektør) |
| Otavamedia | 31 | FI | `asiakaspalvelu@otavamedia.fi` | medium | otavamedia.fi/.../yhteystiedot |
| Burda Forward | 28 | DE | `marketing@burda-forward.de` | medium | exhibitor profile (re-confirm on own domain) |
| Jysk Fynske Medier | 19 | DK | `kundeservice@jfm.dk` | medium | jfm.dk/kontakt |
| Immediate Commercial | 23 | UK | `enquiries@immediate.co.uk` | low | media.info directory (own site blocked) |

### Named sellers (second research pass) — the 8 no-inbox groups

These groups publish no generic ad inbox, so outreach routes to a named
ad-sales / branded-content person. `high` = email seen verbatim on a live page;
`medium` = named person verified on a live page, email constructed from the
group's domain pattern (pattern corroborated by a real address on that domain).
Verify `medium` before sending.

| Sales house | ~Titles | Mkt | Named contact (role) | Email | Conf. |
|---|---|---|---|---|---|
| Schibsted Partnerstudio | 36 | NO/SE | Ellen Cabrinetti Meum (Head, native studio) | `ellen.cabrinetti@schibsted.com` | high |
| Schibsted Partnerstudio | | | Caroline Birkeland (Business Dev, branded content) | `caroline.birkeland@schibsted.com` | high |
| Schibsted SMS | | | Martine Hansen (Salgsdirektør, SMS Norge) | `martine.hansen@schibsted.com` | medium |
| Aller Media (NO) | 22 | NO | Chris Tallerås Steen (Salgsdirektør) | `chris.talleras.steen@aller.com` | high |
| Aller Media (NO) | | | Asbjørn Halvorsen (Head of Content Mktg / native) | `asbjorn.halvorsen@aller.com` | high |
| Bonnier News Brands | 91 | SE | Mats Dicklén (Head of Brand Studio, native) | `mats.dicklen@bonniernews.se` | medium |
| Bonnier News Brands | | | Paul Brandenfeldt (Försäljningsdirektör) | `paul.brandenfeldt@bonniernews.se` | medium |
| Reach Commercial | 53 | UK | Mark Field (Director, Reach Studio — branded content) | `mark.field@reachplc.com` | medium |
| Reach Commercial | | | Emma Callaghan (CRO, advertising) | `emma.callaghan@reachplc.com` | medium |
| Newsquest Commercial | 43 | UK | Sean Duffy (Commercial Dir, Scotland/NI — Herald/National) | `sean.duffy@newsquest.co.uk` | medium |
| Egmont (NO) | 34 | NO | Jill Iren Molland (Commercial Director) | `jill.molland@egmont.com` | medium |
| Egmont (NO) | | | Ann-Elise Ertesvåg (press/commercial) | `ann-elise.ertesvag@egmont.com` | high |
| Bauer Advance (DE) | 24 | DE | Frank Fröhling (CSO / MD) | `frank.froehling@baueradvance.com` | medium |
| Iconic Media (IE) | 23 | IE | Garry Mernagh (Regional Sales Director) | `garry.mernagh@iconicnews.ie` | medium |

Notes:
- Schibsted's `advertising.schibsted.com` only offers a phone + "book a
  meeting" flow; the high-confidence route is **Partnerstudio** (their native
  studio, emails printed in plain text at partnerstudio.no/ansatte).
- Aller NO domain is **@aller.com** (not @aller.no); emails decoded from the
  Cloudflare obfuscation on annonse.aller.no/kontakt.
- Bonnier sellers each have an Ocast contact page (per-seller email is JS-loaded);
  pattern `first.last@bonniernews.se` anchored by a seen `johan.petersen@bonniernews.se`.
- Reach `first.last@reachplc.com` (~98% pattern); Newsquest `first.last@newsquest.co.uk` (~86%).
- Bauer DE: since Jan 2025 German print is marketed largely via **Ad Alliance** —
  Frank Fröhling's Bauer Advance remit may have narrowed; consider routing those
  titles to Ad Alliance instead.
- Iconic staff domain is `@iconicnews.ie` (RocketReach-sourced names + pattern).

## Independent rep houses (true middlemen — `REP`)

| Rep house | ~Titles | Market | Contact email | Conf. | Source |
|---|---|---|---|---|---|
| HS Media | 46 | NO | `heisan@hsmedia.no` | medium | hsmedia.no/kontaktoss |
| A2 Media | 26 | NO | `post@a2media.no` | medium | a2media.no |
| Salgsfabrikken | 26 | NO | `huser@salgsfabrikken.no` | medium | salgsfabrikken.no/kontakt-oss |
| Iconic Media Sales | 23 | IE | — | — | site refused fetch; not found |

> Research date: 2026-05-29. Re-verify medium/low entries and fill the gaps
> before the first real batch to those titles.


## Long-tail research (Sonnet swarm, 2026-05-30)

Researched 68 long-tail sales houses (≥4 titles each) under the strict
no-guessing rule. **46 high-confidence emails were MX-verified and loaded**
into the ROUTES table in `scripts/load-sales-house-contacts.ts` (coverage of
non-direct titles went 850 → 1,216). `Burda Direct` was excluded — its only
public inbox is *Vertrieb* (distribution), not advertising.

### Medium-confidence — verify before sending (NOT yet loaded)

| House | Email | Contact | Note |
|---|---|---|---|
| EMAP Commercial | frazer.stokes@emap.com | Frazer Stokes | No generic advertising inbox found. frazer.stokes@emap.com was seen verbatim on architects |
| KSF Media Mainosmyynti | annons@ksfmedia.fi | — | The email annons@ksfmedia.fi is consistently cited in Google search snippets as the advert |
| DC Thomson Media | cfrench@dctmedia.co.uk | C French | Named advertising contact seen verbatim on fairsubmissions.co.uk: "Advertising – cfrench@d |
| Berlingske Media Annonce | annoncering@berlingskemedia.dk | — | Email seen verbatim on the LeadIQ company page, reproduced from Berlingske Media's own adv |
| Mediaprint | vertrieb@mediaprint.at | — | vertrieb@mediaprint.at was seen verbatim on the presseangebot.at Mediaprint page as the co |
| DLV Anzeigen | sandra.holleber@dlv.de | Sandra Holleber | No generic advertising inbox (anzeigen@, werbung@, mediasales@) found on any live page. Sa |

(`Mediaprint → vertrieb@` is a distribution inbox — likely wrong door; verify.)

### No verified email found — need manual research (15)

`Hearst UK Commercial`, `Keskisuomalainen Oyj Mainosmyynti`, `Goldbach`, `Condé Nast UK Commercial`, `NHST Media Salg`, `MA Commercial`, `IDG Sales`, `Ippen Anzeigen`, `Incisive Commercial`, `Centaur Commercial`, `Celtic Media Advertising`, `Mail Metro Media`, `oe24 Anzeigen`, `Condé Nast Germany Advertising`, `Styria Media Sales`

These are mostly big groups that gate ad sales behind web forms / Ocast
(Hearst UK, Condé Nast UK & DE, Goldbach, Mail Metro Media, Styria, oe24,
Keskisuomalainen, NHST, Centaur, Incisive, IDG, MA Commercial, Ippen, Celtic).
