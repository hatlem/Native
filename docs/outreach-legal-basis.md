# Outreach to publisher contacts — legal basis (DRAFT)

> **Status: DRAFT — not reviewed.** This is a skeleton for the owner (and counsel) to
> complete. Nothing here is legal advice, and the sections marked _TODO_ are open.
> Until it is completed and dated, treat the outreach programme as not yet documented.

## 1. What we do

NativeSpin emails advertising / sales contacts at publishers and sales houses to ask for
native-advertising rate cards and prices (`src/lib/outreach`, `src/lib/pricing/requests.ts`).
Contacts are collected from publishers' own public "advertise with us" pages and from
replies to earlier emails (`docs/how-outreach-works.md`).

## 2. Personal data involved

| Data | Source | Where stored |
|---|---|---|
| Work email address (role-based or named) | Publisher's public site, replies | `SalesContact`, `ContactCandidate`, `RateCardRequest.recipientEmail` |
| Name, role (when published) | Same | `SalesContact`, `RateCardRequest` |
| Send / open / response timestamps | Our system | `RateCardRequest`, `PriceRequest`, `AuditLog` |
| Opt-out / bounce | Recipient, mail provider | `OutreachSuppression` |

_TODO: confirm no other fields are collected (phone numbers in scripts/data files?)._

## 3. Legal basis (GDPR Art. 6)

Proposed basis: **legitimate interest, Art. 6(1)(f)** — B2B contact with the person whose
published job is to sell the publication's advertising, about exactly that.

Legitimate-interest assessment — _TODO: complete each row and sign off._

| Test | Assessment |
|---|---|
| Purpose — is the interest legitimate? | _TODO_ (building an accurate price catalogue; bringing advertisers to the publisher) |
| Necessity — is email to this contact needed? | _TODO_ (no public price list; the contact is the published channel) |
| Balancing — would the contact expect it? impact? | _TODO_ (published sales contact; low intrusion; max 3 emails; opt-out in each) |
| Safeguards | Opt-out in every email, suppression list, daily cap, 3-step maximum, retention below |

## 4. Marketing-law rules per market

Unsolicited email is also governed by national marketing law, which differs for
named individuals vs. role addresses and for B2B vs. B2C.

| Market | Rule to check | Conclusion |
|---|---|---|
| Norway (markedsføringsloven § 15) | _TODO_ | _TODO_ |
| Sweden (marknadsföringslagen § 19) | _TODO_ | _TODO_ |
| Denmark (markedsføringsloven § 10) | _TODO_ | _TODO_ |
| Finland | _TODO_ | _TODO_ |
| Germany (UWG § 7) | _TODO — notably strict for unsolicited B2B email_ | _TODO_ |
| UK / IE / NL / BE / AT / CH | _TODO_ | _TODO_ |

## 5. Information to the data subject (GDPR Art. 14)

Contacts did not give us their data themselves, so they must be told who we are, why we
hold it, the source, and their rights — at the latest in the first email.

- _TODO: add an Art. 14 notice (or a link to one) to the first outreach email._
- _TODO: add a "publisher contacts" section to the privacy policy
  (`privacy` namespace in `src/messages/*.json`)._

## 6. Rights and opt-out — what the system does

- Every outreach email has an opt-out link and `List-Unsubscribe` headers.
- Opt-out, hard bounce and complaint put the address on `OutreachSuppression`; both
  send paths check it before every send.
- Erasure / access requests: _TODO — name the mailbox and the person who handles them._

## 7. Retention

- _TODO: decide how long non-responding contacts and candidates are kept._
- Suppression entries are kept indefinitely (needed to honour the opt-out).
- Contact lists must not be committed to the repository (`data/outreach/` currently
  holds some — _TODO: move to private storage and purge from git history_).

## 8. Sign-off

| | Name | Date |
|---|---|---|
| Completed by | _TODO_ | _TODO_ |
| Reviewed by (counsel / DPO) | _TODO_ | _TODO_ |
