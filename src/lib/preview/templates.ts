import { type Article, type PreviewInput, marketLanguage } from "./schema";

type Lang = ReturnType<typeof marketLanguage>;

// Deterministic fallback. Believable editorial filler that weaves in the brand
// and product; used when Claude is unavailable or rate-limited. The AI path is
// the primary one — this just guarantees the tool never dead-ends.
const T: Record<Lang, (brand: string, product: string) => Article> = {
  en: (b, p) => ({
    headline: `The quiet shift behind ${b}`,
    standfirst: `We spent a week with the people putting ${b} to the test. Here is what we found.`,
    byline: "By the editorial desk · 8 min read",
    body: [
      `It doesn't announce itself. ${b} arrives the way the best things do — quietly, and then all at once. ${p}.`,
      `Across the region the same story keeps surfacing: people who didn't expect to change their minds, and did.`,
      `What follows isn't a sales pitch. It's a look at how something genuinely useful finds its way into ordinary life — one unremarkable Tuesday at a time.`,
    ],
  }),
  no: (b, p) => ({
    headline: `Det stille skiftet bak ${b}`,
    standfirst: `Vi tilbrakte en uke med dem som setter ${b} på prøve. Dette fant vi.`,
    byline: "Av redaksjonen · 8 min lesetid",
    body: [
      `Det kunngjør seg ikke selv. ${b} kommer slik de beste tingene gjør — stille, og så på én gang. ${p}.`,
      `I hele regionen dukker den samme historien opp igjen og igjen: folk som ikke forventet å ombestemme seg, men gjorde det.`,
      `Dette er ingen salgstale. Det er et blikk på hvordan noe genuint nyttig finner veien inn i et helt vanlig liv — én helt vanlig tirsdag av gangen.`,
    ],
  }),
  sv: (b, p) => ({
    headline: `Det tysta skiftet bakom ${b}`,
    standfirst: `Vi tillbringade en vecka med dem som sätter ${b} på prov. Det här fann vi.`,
    byline: "Av redaktionen · 8 min läsning",
    body: [
      `Det tillkännager sig inte självt. ${b} kommer som de bästa tingen gör — tyst, och sedan på en gång. ${p}.`,
      `I hela regionen dyker samma historia upp gång på gång: människor som inte väntade sig att ändra åsikt, men gjorde det.`,
      `Det här är inget säljsnack. Det är en titt på hur något genuint användbart hittar in i ett helt vanligt liv — en helt vanlig tisdag i taget.`,
    ],
  }),
  da: (b, p) => ({
    headline: `Det stille skifte bag ${b}`,
    standfirst: `Vi tilbragte en uge med dem, der sætter ${b} på prøve. Det her fandt vi.`,
    byline: "Af redaktionen · 8 min læsning",
    body: [
      `Det bekendtgør sig ikke selv. ${b} ankommer, som de bedste ting gør — stille, og så på én gang. ${p}.`,
      `I hele regionen dukker den samme historie op igen og igen: folk, der ikke forventede at skifte mening, men gjorde det.`,
      `Det her er ingen salgstale. Det er et blik på, hvordan noget ægte nyttigt finder vej ind i et helt almindeligt liv — én helt almindelig tirsdag ad gangen.`,
    ],
  }),
  de: (b, p) => ({
    headline: `Der leise Wandel hinter ${b}`,
    standfirst: `Wir haben eine Woche mit denen verbracht, die ${b} auf die Probe stellen. Das haben wir gefunden.`,
    byline: "Von der Redaktion · 8 Min. Lesezeit",
    body: [
      `Es kündigt sich nicht an. ${b} kommt, wie die besten Dinge kommen — leise, und dann auf einmal. ${p}.`,
      `In der ganzen Region taucht dieselbe Geschichte immer wieder auf: Menschen, die nicht erwartet hatten, ihre Meinung zu ändern, und es doch taten.`,
      `Was folgt, ist keine Verkaufsmasche. Es ist ein Blick darauf, wie etwas wirklich Nützliches seinen Weg in den ganz normalen Alltag findet — an einem ganz gewöhnlichen Dienstag nach dem anderen.`,
    ],
  }),
  fi: (b, p) => ({
    headline: `Hiljainen muutos ${b}:n takana`,
    standfirst: `Vietimme viikon niiden kanssa, jotka panevat ${b}:n koetukselle. Tämän löysimme.`,
    byline: "Toimitus · 8 min lukuaika",
    body: [
      `Se ei ilmoita itsestään. ${b} saapuu kuten parhaat asiat — hiljaa, ja sitten kerralla. ${p}.`,
      `Koko alueella sama tarina nousee esiin yhä uudelleen: ihmiset, jotka eivät odottaneet muuttavansa mieltään, mutta muuttivat.`,
      `Tämä ei ole myyntipuhe. Se on katsaus siihen, miten jokin aidosti hyödyllinen löytää tiensä tavalliseen elämään — yksi aivan tavallinen tiistai kerrallaan.`,
    ],
  }),
};

export function templateArticle(input: PreviewInput): Article {
  const lang = marketLanguage(input.market);
  const make = T[lang] ?? T.en;
  return make(input.brand, input.product);
}
