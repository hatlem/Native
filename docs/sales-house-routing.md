# Sales-House Routing — non-direct title outreach

Every title is now classified by `Title.salesChannel`:

| Channel | Titles | Route outreach to |
|---|---|---|
| `DIRECT` | 1,177 | the title's own scraped ad contact |
| `IN_HOUSE` | 1,854 | the publisher group's own ad department (below) |
| `REP` | 121 | the independent rep house (below) — true middleman |

The badge is visible per publisher on `/desk/publisher-contacts`.

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

### Gaps — no email published; route is a web form / named sellers

These big groups don't expose a generic ad inbox; ad sales go through Ocast
forms or named individual sellers. Needs a decision (use form, or find a named
seller) before sending:

| Sales house | ~Titles | Market | Notes |
|---|---|---|---|
| Bonnier News Brands | 91 | SE | DN, Expressen. Ocast contact forms + named sellers; no inbox. |
| Schibsted Marketing Services | 36 | NO/SE | Aftenposten, Aftonbladet. annonseweb pages blocked; `sales@schibsted.no` seen only in snippets (unverified). |
| Reach Commercial | 53 | UK | Daily Express, Mirror. Contact form only; `solutions@reachplc.com` unverified. |
| Newsquest Commercial | 43 | UK | Site refused fetch; only `first.last@newsquest.co.uk` pattern (unverified). |
| Egmont Publishing (NO) | 34 | NO | Now Story House Egmont; reachable contact page had no email. |
| Aller Media (NO) | 22 | NO | annonse.aller.no lists ~80 individual `first.last@aller.no`, no generic inbox. |
| Bauer Advertising KG (DE) | 24 | DE | Now BAUER ADVANCE; JS-rendered, `onlinevermarktung@baueradvance.com` unverified. |

## Independent rep houses (true middlemen — `REP`)

| Rep house | ~Titles | Market | Contact email | Conf. | Source |
|---|---|---|---|---|---|
| HS Media | 46 | NO | `heisan@hsmedia.no` | medium | hsmedia.no/kontaktoss |
| A2 Media | 26 | NO | `post@a2media.no` | medium | a2media.no |
| Salgsfabrikken | 26 | NO | `huser@salgsfabrikken.no` | medium | salgsfabrikken.no/kontakt-oss |
| Iconic Media Sales | 23 | IE | — | — | site refused fetch; not found |

> Research date: 2026-05-29. Re-verify medium/low entries and fill the gaps
> before the first real batch to those titles.
