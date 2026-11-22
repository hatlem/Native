# Oppfølging etter audit – oppgaver for Claude Code på Mac

Skrevet 22. november 2026 etter at audit-PR-en (#80) og Railway-IaC (#91) er
merget til `main`. Koden er ferdig og CI er grønn. Det som står igjen krever
tilgang en skyøkt ikke har: Railway, GitHub-innstillinger, produksjonsdatabasen,
DNS og e-post. Denne fila er arbeidslisten for en Claude Code-økt på Andreas'
Mac, der `railway`, `gh`, `psql`/`pg_dump` og nettleser er tilgjengelig.

Les hele fila før du starter. Ta oppgavene i rekkefølge. Kryss av her og
commit når en oppgave er ferdig, så neste økt ser hvor langt dere kom.

## Regler for denne jobben

- **Spør Andreas før alt som ikke kan angres:** endring av
  produksjonsvariabler, `railway config apply`, restore, skriving til
  produksjonsdatabasen, tvangspush og omskriving av git-historikk. Vis hva du
  skal gjøre, og vent på ja.
- **`railway config plan` før hver `apply`.** Planen skal bare vise endringen du
  mener. Inneholder den en sletting av en variabel, et volum eller et domene,
  stopp. Alle variabler må stå i `.railway/railway.ts` som `preserve()`;
  en variabel som bare finnes i dashbordet blir slettet av neste `apply`
  (se `.railway/README.md`).
- **Ingen hemmeligheter i git, chat eller logger.** Generer dem lokalt og sett
  dem rett inn i Railway.
- **Ta en manuell dump før alt som rører produksjonsdatabasen**
  (`docs/runbooks/backup-restore.md`, seksjon 1). Slett dumpen når endringen er
  verifisert; den inneholder persondata.

## 1. Sjekk at staging ikke bruker produksjonsdatabasen (først)

Staging (`staging.nativespin.com`) er definert i `.railway/railway.ts`, men
`DATABASE_URL` er `preserve()`, så det er uklart hvilken database den peker på.
`.env.example` sa tidligere at appen bare kjøres mot produksjon. Peker staging
på produksjonsbasen, vil staging-deployer kjøre migrasjoner og bakgrunnsjobber
mot ekte kundedata.

```bash
railway link   # prosjekt nativespin
railway variables --environment staging --kv | grep '^DATABASE_URL=' | sed 's/:[^:@]*@/:***@/'
railway variables --environment production --kv | grep '^DATABASE_URL=' | sed 's/:[^:@]*@/:***@/'
```

- Er vert og databasenavn like: **stopp og si fra til Andreas.** Staging må få
  sin egen Postgres-tjeneste. Anbefaling: egen Postgres i staging-miljøet,
  `pnpm prisma migrate deploy`, deretter `pnpm db:seed` med egne passord via
  `SUPERADMIN_PASSWORD` m.fl. (seed nekter standardpassord mot ikke-lokal vert).
- Er de ulike: kryss av og gå videre.

- [ ] Staging har egen database

## 2. Sett manglende produksjonsvariabler

Disse er bygget inn i koden, men står ikke i produksjonslisten i
`.railway/railway.ts`, og er derfor trolig ikke satt.

| Variabel | Hvorfor | Verdi |
|---|---|---|
| `SELLER_VAT_NUMBER` | **Faktura-PDF nektes uten den** (`src/lib/seller.ts`) | `NO <orgnr> MVA`; spør Andreas |
| `SELLER_BANK_ACCOUNT` | **Faktura-PDF nektes uten den** for NOK-fakturaer | 11 siffer; spør Andreas |
| `SELLER_IBAN`, `SELLER_BIC` | Påkrevd for fakturaer i andre valutaer enn NOK | spør Andreas |
| `CRON_SECRET` | Beskytter `/api/cron/sweeps` og `/api/health/deep` | `openssl rand -base64 32` |
| `ERROR_WEBHOOK_URL` | Uten den varsles ingen ved feil | Slack- eller annen webhook; spør Andreas hvor |
| `AUTH_URL` | Riktige lenker i e-post bak proxy | `https://nativespin.com` |

Fremgangsmåte:

1. Legg hver variabel til i `.railway/railway.ts` under produksjon som
   `NAVN: preserve()`, i alfabetisk rekkefølge.
2. Sett verdien i Railway: `railway variables --environment production --set "NAVN=verdi"`.
3. `railway config plan`: kontroller at ingenting slettes. `apply` først etter ja fra Andreas.
4. Verifiser: åpne en utstedt faktura under `/invoices/<id>` som desk-bruker.
   Siden skal ikke lenger liste manglende selgerfelt, og PDF-en skal lastes ned.
   `curl -H "Authorization: Bearer $CRON_SECRET" https://nativespin.com/api/health/deep`
   skal svare 200 med JSON.
5. Commit endringen i `railway.ts` på en gren og åpne PR.

Sjekk også: `OPENAI_API_KEY` står i produksjon, men ingen fil i `src/` eller
`scripts/` leser den (sjekket 22. november); AI går via GetPlatform-gatewayen
(`GETPLATFORM_AI_*`). Kjør `grep -rn OPENAI_API_KEY src scripts` på nytt. Er den
fortsatt ubrukt, spør Andreas om den kan fjernes og nøkkelen trekkes tilbake hos
OpenAI. En ubrukt nøkkel i produksjon er bare risiko.

- [ ] Selgervariabler satt og faktura-PDF verifisert
- [ ] `CRON_SECRET`, `ERROR_WEBHOOK_URL`, `AUTH_URL` satt
- [ ] `railway.ts` oppdatert og merget

## 3. Flytt bakgrunnsjobber til Railway cron

Sweeps og jobbkøen kjører i dag som tidtakere i webprosessen. Det fungerer, men
de dør ved hver deploy.

1. Lag en cron-tjeneste i Railway (eller GitHub Actions-cron) som hvert 10.
   minutt kaller
   `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://nativespin.com/api/cron/sweeps`.
   Sjekk metoden i `src/app/api/cron/sweeps/route.ts` før du setter den opp.
2. Når den har gått grønt i et døgn: sett `IN_PROCESS_SWEEPS=0` i produksjon
   (via `railway.ts`, samme fremgangsmåte som over). La `JOB_WORKER` stå på
   til cron har vist at den tømmer køen (`/desk/jobs`).

- [ ] Cron kaller `/api/cron/sweeps`
- [ ] `IN_PROCESS_SWEEPS=0` etter ett grønt døgn

## 4. Overvåking

Følg `docs/runbooks/monitoring.md`. Minimum:

- Ekstern oppetidssjekk mot `https://nativespin.com/api/health` hvert minutt.
- Dyp sjekk mot `/api/health/deep` med `CRON_SECRET` hvert 5. minutt.
- Varsel når dead-letter-køen ikke er tom.

Valg av tjeneste (Better Stack, UptimeRobot e.l.) er Andreas' beslutning; foreslå,
ikke opprett konto selv.

- [ ] Oppetidssjekk og dyp sjekk aktive

## 5. Backup og restore-øvelse

Følg `docs/runbooks/backup-restore.md`:

1. Seksjon 0: bekreft i Railway at daglig backup er på og hvor lenge de
   beholdes, og om point-in-time recovery finnes. Fyll inn RPO i tabellen.
2. Sett opp den nattlige dumpen utenfor Railway (GitHub Actions-cron er
   enklest). Krever en privat bøtte og en `age`-nøkkel; Andreas lager nøkkelen
   og beholder den private delen.
3. Seksjon 3: restore siste backup **til staging-databasen**, aldri over
   produksjon. Mål tiden, og skriv RTO og dato i loggen (seksjon 5).
4. Øv rollback etter `docs/runbooks/rollback.md` på staging.

- [ ] Backup bekreftet og RPO fylt inn
- [ ] Nattlig dump utenfor Railway
- [ ] Restore øvd, RTO logget
- [ ] Rollback øvd

## 6. Branch protection på `main`

CI har disse jobbene: `lint + typecheck`, `unit tests`, `integration tests`,
`build + e2e`, `security`. Krev dem før merge og blokker direkte push.
Andreas jobber alene, så krav om godkjenning fra en annen person ville låse
ham ute; bruk 0 godkjenninger med mindre han sier noe annet.

```bash
gh api -X PUT repos/hatlem/Native/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["lint + typecheck", "unit tests", "integration tests", "build + e2e", "security"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Verifiser med `gh api repos/hatlem/Native/branches/main/protection` og ved at
en testgren uten grønn CI ikke kan merges.

- [ ] Branch protection aktiv

## 7. Slå på tofaktor for ansatte

1. Andreas og alle desk-brukere registrerer tofaktor på `/account/security`
   og lagrer gjenopprettingskodene.
2. Sjekk at alle er registrert:
   `psql "$DATABASE_URL" -c "select email, role, \"mfaEnabledAt\" is not null as mfa from \"User\" where role in ('DESK','SUPERADMIN')"`
   (sjekk kolonnenavnet i `prisma/schema.prisma` først).
3. Sett `MFA_REQUIRED_FOR_STAFF=1` i produksjon (via `railway.ts`).
4. Nødutgang hvis noen mister enheten: `scripts/reset-mfa.ts <e-post> --by <operatør>`.

- [ ] Alle ansatte har tofaktor
- [ ] `MFA_REQUIRED_FOR_STAFF=1`

## 8. E-post og DNS

- Sjekk at `security@nativespin.com` mottar e-post; adressen står i
  `public/.well-known/security.txt` og `SECURITY.md`. Send en testmelding.
- Sjekk SPF, DKIM og DMARC for `nativespin.com`:
  `dig +short TXT nativespin.com`, `dig +short TXT _dmarc.nativespin.com`, og
  DKIM-postene Resend viser under *Domains*. Mangler noe: vis Andreas hvilke
  poster som må legges inn hos DNS-leverandøren.

- [ ] `security@` virker
- [ ] SPF, DKIM, DMARC på plass

## 9. Underleverandører og juridiske påstander

`src/lib/subprocessors.ts` viser behandlingssted som «to be confirmed».
Sikkerhetssiden lover også ting koden ikke kan bekrefte. Finn svarene i
leverandørenes dokumentasjon og Andreas' avtaler, og rett tekst og data:

| Påstand | Hvor | Sjekk mot |
|---|---|---|
| Behandlingssted per leverandør | `src/lib/subprocessors.ts` | Railway-region (`europe-west4` i `railway.ts` = Nederland), Resend, Cloudflare R2, GetPlatform/AI-leverandør, Google, GetCookies, Fiken |
| «All data i EU (Stockholm)» | `src/messages/*.json`, navnerom `security` | `railway.ts` sier `europe-west4` (Nederland), ikke Stockholm; rett teksten |
| Kryptering i ro | `security` | Railways dokumentasjon |
| SOC 2 Type I sent i 2026 | `security` | Spør Andreas; fjern om det ikke er planlagt |
| Varsling innen 48 timer | `security` | Spør Andreas |
| Ingen trening på kundedata | `privacy` | AI-leverandørens vilkår |

Alle endringer i `src/messages/*.json` må gjøres på alle seks språk
(`en`, `no`, `sv`, `da`, `de`, `fi`); `locale-parity.test.ts` feiler ellers.
Databehandleravtalene må Andreas signere selv.

- [ ] Behandlingssteder fylt inn
- [ ] Påstander på sikkerhetssiden rettet eller bekreftet
- [ ] Databehandleravtaler signert (Andreas)

## 10. MVA og Fiken

MVA følger nå kjøpers land: norsk kjøper 25 %, utenlandsk næringskunde 0 % med
omvendt avgiftsplikt (`src/lib/vat.ts`). Andreas' regnskapsfører må bekrefte
reglene før første utenlandske faktura.

Fiken-integrasjonen mapper omvendt avgiftsplikt til `EXEMPT_IMPORT_EXPORT`, og
den koden er ikke verifisert. Med et Fiken-sandkassefirma og
`FIKEN_API_TOKEN`/`FIKEN_COMPANY_SLUG` satt lokalt: utsted én norsk og én
utenlandsk testfaktura og sjekk MVA-koden Fiken registrerer. Rett
`src/lib/fiken.ts` om koden er feil, og fjern merknaden om at mappingen er
ubekreftet.

- [ ] Regnskapsfører har bekreftet MVA-reglene
- [ ] Fiken-mapping verifisert mot sandkasse

## 11. Kodeoppgaver som venter på en beslutning

Spør Andreas før du gjør disse.

- **Katalogen for innloggede er 346 KB HTML** fordi den viser 60 titler per side
  (`PAGE_SIZE = 60` i `src/app/[locale]/catalog/filters.ts`). Anbefaling: 24 per
  side med «vis flere». Kjør e2e og lasttest etterpå (`e2e/README.md`,
  `docs/testing/load-test.md`).
- **Kontaktlistene ligger fortsatt i git-historikken** (`data/outreach/*`,
  `outreach_send_batch_0609.json`, med navngitte e-postadresser). Fjerning krever
  `git filter-repo` og tvangspush til `main`, og alle kloner må hentes på nytt.
  Gjør det bare hvis Andreas sier ja, og ta en speilkopi (`git clone --mirror`)
  først.
- **SSO/SAML** finnes ikke. Sikkerhetssiden sier nå at det ikke er tilgjengelig.
  Bygg det bare hvis en kunde krever det.

## 12. Bestilles utenfor koden

- Ekstern penetrasjonstest. Auditen fant én kritisk tilgangsfeil; en uavhengig
  test bør bekrefte at det ikke finnes flere.
- Statusside for kunder (kan kobles til oppetidssjekken i oppgave 4).
