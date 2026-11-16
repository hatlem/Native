# Glossary

One name per thing in everything a buyer reads: the app, emails, the public
site and the API docs. Message keys, routes and database fields keep their
historical names (`catalog.shortlist.*`, `campaign.proposal*`, `RFQ_ONLY`,
`submit-rfq.ts`) — only the wording people see follows this table.

## The buying flow

**Plan → Request → Quote → Order**

| Term | What it is | en | no | sv | da | de | fi |
|---|---|---|---|---|---|---|---|
| **Plan** | The working selection of titles and placements a buyer is building, with schedule and budget. One active plan at a time. | Plan | Plan | Plan | Plan | Plan | Suunnitelma |
| **Saved list** | A named collection of titles kept for later. A saved list can be opened as a plan. | Saved list | Lagret liste | Sparad lista | Gemt liste | Gespeicherte Liste | Tallennettu lista |
| **Request** | A plan sent to the desk, with the brief. The desk answers it with a quote. | Request | Forespørsel | Förfrågan | Anmodning | Anfrage | Pyyntö |
| **Brief** | The text that travels with a request: what the campaign is about. | Brief | Brief | Brief | Brief | Brief | Brief |
| **Quote** | The desk's firm, priced offer for a request. Valid until its date; the buyer accepts or declines it. | Quote | Tilbud | Offert | Tilbud | Angebot | Tarjous |
| **Order** | An accepted quote (or a firm-priced plan booked directly). What gets produced, published and invoiced. | Order | Bestilling | Beställning | Ordre | Bestellung | Tilaus |
| **Campaign** | A buyer's undertaking as a whole — used in running text ("your campaign"), never as the name of a page or an object. | Campaign | Kampanje | Kampanj | Kampagne | Kampagne | Kampanja |

## Words we do not use with buyers

| Don't | Use | Why |
|---|---|---|
| RFQ | request | Procurement jargon. The API error code `RFQ_ONLY` stays as a code; the sentence around it says "request-only". |
| Shortlist | plan (the working selection) or saved list (the kept collection) | It named both objects, depending on the screen. |
| Proposal | request (what the buyer sends) or quote (what the desk sends back) | It was used for both directions. |
| Basket / cart | plan | Nothing is bought until a quote is accepted. |
| "Campaigns" as the name of the `/requests` page | Requests | The nav label, the page title and the heading are the same word. |

## Prices

| Term | Meaning |
|---|---|
| **Indicative** | A price band shown in the catalog. Not binding. |
| **On request** | No published price; the desk prices it in the quote. |
| **Firm** | A binding price: on a quote, or on a self-serve placement that can be booked directly. |

## Desk-side terms

The desk console may use internal shorthand (margin, cost vs. sell, win/loss).
None of it appears on buyer or publisher screens.

When adding copy, check new strings against this table in all six locales.
