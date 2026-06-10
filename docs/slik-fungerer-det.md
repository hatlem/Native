# Slik fungerer det – kort forklart

Vi bygger en katalog over medier (aviser, magasiner, nettsteder) i 9 markeder
(NO, SE, DK, FI, DE, AT, CH, UK, IE) og henter inn priser på annonsørinnhold
(native / sponset innhold) fra dem. To deler: **samle inn publikasjoner** og
**sende e-post for å hente priser**.

---

## 1. Samle inn publikasjoner

Vi startet med en stor liste (ca. 1 900 utgivere / 3 150 titler) fra et
regneark. Problemet: lista var laget av AI, hadde **ingen e-poster**, og
inneholdt feil – titler som ikke finnes, titler som er lagt ned eller
omdøpt. Derfor stoler vi ikke på lista før hver enkelt tittel er **sjekket**.

Grunnregelen: **en feil tittel eller en gjettet e-post er verre enn ingen** –
da lyver katalogen, og vi ødelegger avsender-ryktet vårt. Heller "usikker"
enn "falsk", heller "deaktiver" enn "slett".

Hvordan vi sjekker hver tittel:
1. Vi går inn på mediets egen nettside og finner ut om publikasjonen
   fortsatt finnes (ikke nedlagt, slått sammen eller omdøpt).
2. Vi henter annonse-e-posten **fra deres egen nettside** – aldri gjettet.
   (Gjettede adresser bouncer; det har vi testet.)
3. Hver tittel får en status: **bekreftet live**, **nedlagt**, **omdøpt**
   eller **usikker** – med kilde (lenke) og dato.

Bare titler som er **bekreftet live OG har en bekreftet e-post** er klare til
utsending. Alt annet settes på vent.

Status nå: **2 524 bekreftet live**, 418 nedlagte, 215 usikre. Ingen
usjekkede titler igjen.

---

## 2. Sende e-post (hente inn priser)

E-postene sendes **personlig fra Andreas @ Admirate** (via Outlook), ikke fra
et system – det gir høyest svarprosent. Ca. **30 e-poster per dag**.

- Vi har én liste med alle mottakerne, gruppert per e-postadresse (et
  salgshus som selger 8 titler får én e-post som nevner alle 8).
- Malen spør kort om prisliste / mediekit for native og annonsørinnhold,
  tilpasset språk per marked (norsk, svensk, dansk, finsk, tysk, engelsk).
- **Hver utsending logges** i systemet, så vi alltid vet hvem vi har
  kontaktet og slipper å sende dobbelt.

---

## 3. Når noen svarer

For hvert svar:
1. Laster ned mediekit/prisliste (PDF) og lagrer det.
2. Logger svaret i systemet.
3. Legger inn prisene de oppgir.
4. Oppdaterer info om mediet (tilbyr de native? lesertall? osv.).

Hvis et svar avslører en feil (tittel nedlagt / feil navn), rydder vi det
med en gang.

---

## Kort oppsummert

> Vi sjekker hver eneste publikasjon mot deres egen nettside (er den ekte og
> aktiv?), henter den ekte annonse-e-posten, og sender en personlig
> pris-forespørsel fra Admirate – ca. 30 om dagen. Alt logges, og prisene
> som kommer inn legges strukturert inn i katalogen. Vi gjetter aldri – en
> feil i katalogen er verre enn et hull.
