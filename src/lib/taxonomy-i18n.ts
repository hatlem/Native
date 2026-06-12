// Maps common English taxonomy values (imported as free-text from the
// research CSV — Title.type, frequency, b2bB2c, format, geoScope, …)
// to localized equivalents per supported locale. Used by the catalog
// title-detail page so a /de or /fi buyer doesn't see English chip
// labels next to a German/Finnish page.
//
// The data is free-text, so we match on lower-cased word-boundary form
// and fall through to the raw value (the publisher- or research-team-
// supplied original) when we have no translation. The fall-through is
// deliberate: it's better to show the publisher's exact English term
// than to silently drop a label.

import type { AppLocale } from "@/i18n/routing";

type TaxonomyMap = Record<string, Partial<Record<AppLocale, string>>>;

// Lower-cased English source value → per-locale translation.
const TAXONOMY: TaxonomyMap = {
  // Publication cycle
  daily: { no: "Daglig", sv: "Dagligen", da: "Dagligt", de: "Täglich", fi: "Päivittäin" },
  "daily (mon-fri)": { no: "Daglig (man-fre)", sv: "Dagligen (mån-fre)", da: "Dagligt (man-fre)", de: "Täglich (Mo-Fr)", fi: "Päivittäin (ma-pe)" },
  weekly: { no: "Ukentlig", sv: "Veckovis", da: "Ugentligt", de: "Wöchentlich", fi: "Viikoittain" },
  "bi-weekly": { no: "Annenhver uke", sv: "Varannan vecka", da: "Hver anden uge", de: "Zweiwöchentlich", fi: "Joka toinen viikko" },
  monthly: { no: "Månedlig", sv: "Månatlig", da: "Månedligt", de: "Monatlich", fi: "Kuukausittain" },
  quarterly: { no: "Kvartalsvis", sv: "Kvartalsvis", da: "Kvartalsvis", de: "Vierteljährlich", fi: "Neljännesvuosittain" },
  // Type
  "magazine": { no: "Magasin", sv: "Magasin", da: "Magasin", de: "Magazin", fi: "Aikakauslehti" },
  "newspaper": { no: "Avis", sv: "Tidning", da: "Avis", de: "Zeitung", fi: "Sanomalehti" },
  "digital": { no: "Digital", sv: "Digital", da: "Digital", de: "Digital", fi: "Digitaalinen" },
  "print + digital": { no: "Trykk + digital", sv: "Tryck + digital", da: "Tryk + digital", de: "Print + Digital", fi: "Painettu + digitaalinen" },
  // Geo scope
  national: { no: "Nasjonal", sv: "Nationell", da: "National", de: "National", fi: "Kansallinen" },
  regional: { no: "Regional", sv: "Regional", da: "Regional", de: "Regional", fi: "Alueellinen" },
  local: { no: "Lokal", sv: "Lokal", da: "Lokal", de: "Lokal", fi: "Paikallinen" },
  international: { no: "Internasjonal", sv: "Internationell", da: "International", de: "International", fi: "Kansainvälinen" },
  // Format
  "print only": { no: "Kun trykk", sv: "Endast tryck", da: "Kun tryk", de: "Nur Print", fi: "Vain painettu" },
  "digital only": { no: "Kun digital", sv: "Endast digital", da: "Kun digital", de: "Nur digital", fi: "Vain digitaalinen" },
  // Audience B2B / B2C
  b2b: { no: "B2B", sv: "B2B", da: "B2B", de: "B2B", fi: "B2B" }, // kept as-is per locale
  b2c: { no: "B2C", sv: "B2C", da: "B2C", de: "B2C", fi: "B2C" },
};

// Vertical/audience translations: only translate the common buckets the
// CSV uses. Everything else (publisher-specific terms, single-title
// niches) falls through.
const VERTICAL: TaxonomyMap = {
  "business & finance": { no: "Næringsliv og finans", sv: "Näringsliv och finans", da: "Erhverv og finans", de: "Wirtschaft & Finanzen", fi: "Liiketoiminta ja talous" },
  "business decision-makers": { no: "Næringslivs-beslutningstagere", sv: "Affärsbeslutsfattare", da: "Forretningsbeslutningstagere", de: "Geschäftsentscheider", fi: "Liiketoimintapäätökset" },
  "lifestyle": { no: "Livsstil", sv: "Livsstil", da: "Livsstil", de: "Lifestyle", fi: "Lifestyle" },
  "technology": { no: "Teknologi", sv: "Teknik", da: "Teknologi", de: "Technologie", fi: "Teknologia" },
  "health": { no: "Helse", sv: "Hälsa", da: "Sundhed", de: "Gesundheit", fi: "Terveys" },
  "sports": { no: "Sport", sv: "Sport", da: "Sport", de: "Sport", fi: "Urheilu" },
  "culture": { no: "Kultur", sv: "Kultur", da: "Kultur", de: "Kultur", fi: "Kulttuuri" },
  "news": { no: "Nyheter", sv: "Nyheter", da: "Nyheder", de: "Nachrichten", fi: "Uutiset" },
  // Verticals (Title.vertical)
  "news (regional)": { no: "Nyheter (regional)", sv: "Nyheter (regional)", da: "Nyheder (regional)", de: "Nachrichten (regional)", fi: "Uutiset (alueellinen)" },
  "news (local)": { no: "Nyheter (lokal)", sv: "Nyheter (lokal)", da: "Nyheder (lokal)", de: "Nachrichten (lokal)", fi: "Uutiset (paikallinen)" },
  "politics & current affairs": { no: "Politikk og samfunn", sv: "Politik och samhälle", da: "Politik og samfund", de: "Politik & Zeitgeschehen", fi: "Politiikka ja yhteiskunta" },
  "b2b – healthcare": { no: "B2B – helse", sv: "B2B – hälso- och sjukvård", da: "B2B – sundhed", de: "B2B – Gesundheitswesen", fi: "B2B – terveydenhuolto" },
  "b2b – construction & property": { no: "B2B – bygg og eiendom", sv: "B2B – bygg och fastighet", da: "B2B – byggeri og ejendom", de: "B2B – Bau & Immobilien", fi: "B2B – rakentaminen ja kiinteistöt" },
  "b2b – agriculture": { no: "B2B – landbruk", sv: "B2B – lantbruk", da: "B2B – landbrug", de: "B2B – Landwirtschaft", fi: "B2B – maatalous" },
  "b2b – education": { no: "B2B – utdanning", sv: "B2B – utbildning", da: "B2B – uddannelse", de: "B2B – Bildung", fi: "B2B – koulutus" },
  "b2b – marketing & media": { no: "B2B – markedsføring og medier", sv: "B2B – marknadsföring och medier", da: "B2B – markedsføring og medier", de: "B2B – Marketing & Medien", fi: "B2B – markkinointi ja media" },
  "home & interior": { no: "Bolig og interiør", sv: "Hem och inredning", da: "Bolig og indretning", de: "Wohnen & Einrichten", fi: "Koti ja sisustus" },
  "health & fitness": { no: "Helse og trening", sv: "Hälsa och träning", da: "Sundhed og træning", de: "Gesundheit & Fitness", fi: "Terveys ja kuntoilu" },
  "women's lifestyle": { no: "Kvinner og livsstil", sv: "Livsstil för kvinnor", da: "Livsstil til kvinder", de: "Frauen & Lifestyle", fi: "Naisten lifestyle" },
  "auto & motor": { no: "Bil og motor", sv: "Bil och motor", da: "Bil og motor", de: "Auto & Motor", fi: "Autot ja moottorit" },
  "science": { no: "Vitenskap", sv: "Vetenskap", da: "Videnskab", de: "Wissenschaft", fi: "Tiede" },
  "food & drink": { no: "Mat og drikke", sv: "Mat och dryck", da: "Mad og drikke", de: "Essen & Trinken", fi: "Ruoka ja juoma" },
  "religious (christian)": { no: "Religiøs (kristen)", sv: "Religiös (kristen)", da: "Religiøs (kristen)", de: "Religiös (christlich)", fi: "Uskonnollinen (kristillinen)" },
  // Audiences (Title.audience)
  "general consumer": { no: "Bredt publikum", sv: "Bred publik", da: "Bredt publikum", de: "Breites Publikum", fi: "Suuri yleisö" },
  "regional consumer": { no: "Regionalt publikum", sv: "Regional publik", da: "Regionalt publikum", de: "Regionales Publikum", fi: "Alueellinen yleisö" },
  "mass market consumer": { no: "Massemarked", sv: "Massmarknad", da: "Massemarked", de: "Massenmarkt", fi: "Massamarkkinat" },
  "healthcare professionals": { no: "Helsepersonell", sv: "Vårdpersonal", da: "Sundhedspersonale", de: "Medizinisches Fachpersonal", fi: "Terveydenhuollon ammattilaiset" },
  "farmers": { no: "Bønder", sv: "Lantbrukare", da: "Landmænd", de: "Landwirte", fi: "Maanviljelijät" },
  "construction & property pros": { no: "Fagfolk i bygg og eiendom", sv: "Proffs inom bygg och fastighet", da: "Fagfolk i byggeri og ejendom", de: "Bau- und Immobilienprofis", fi: "Rakennus- ja kiinteistöalan ammattilaiset" },
  "teachers & educators": { no: "Lærere og pedagoger", sv: "Lärare och pedagoger", da: "Lærere og pædagoger", de: "Lehrkräfte & Pädagogen", fi: "Opettajat ja kasvattajat" },
  "marketing & media pros": { no: "Fagfolk i markedsføring og medier", sv: "Proffs inom marknadsföring och medier", da: "Fagfolk i markedsføring og medier", de: "Marketing- & Medienprofis", fi: "Markkinoinnin ja median ammattilaiset" },
  "children (3-12)": { no: "Barn (3-12)", sv: "Barn (3-12)", da: "Børn (3-12)", de: "Kinder (3-12)", fi: "Lapset (3-12)" },
};

// Category translations (Title.category). The 20260612080000 migration
// collapsed language duplicates ("Lokal"/"Paikallinen", "Helse", import
// slugs like "general-news") into one canonical English value per
// concept; this map carries every canonical value the migration produces
// plus the frequent already-English ones. Composite long-tail values
// ("Bygg/VVS", "Landbruk riks") deliberately fall through untranslated.
const CATEGORY: TaxonomyMap = {
  // Geo / news tiers
  local: { no: "Lokal", sv: "Lokal", da: "Lokal", de: "Lokal", fi: "Paikallinen" },
  regional: { no: "Regional", sv: "Regional", da: "Regional", de: "Regional", fi: "Alueellinen" },
  national: { no: "Riksdekkende", sv: "Rikstäckande", da: "Landsdækkende", de: "Überregional", fi: "Valtakunnallinen" },
  international: { no: "Internasjonal", sv: "Internationell", da: "International", de: "International", fi: "Kansainvälinen" },
  "regional (swedish-language)": { no: "Regional (svenskspråklig)", sv: "Regional (svenskspråkig)", da: "Regional (svensksproget)", de: "Regional (schwedischsprachig)", fi: "Alueellinen (ruotsinkielinen)" },
  "local (swedish-language)": { no: "Lokal (svenskspråklig)", sv: "Lokal (svenskspråkig)", da: "Lokal (svensksproget)", de: "Lokal (schwedischsprachig)", fi: "Paikallinen (ruotsinkielinen)" },
  "regional (free)": { no: "Regional (gratisavis)", sv: "Regional (gratistidning)", da: "Regional (gratisavis)", de: "Regional (Gratiszeitung)", fi: "Alueellinen (ilmaisjakelu)" },
  "general news": { no: "Allmenne nyheter", sv: "Allmänna nyheter", da: "Almene nyheder", de: "Allgemeine Nachrichten", fi: "Yleisuutiset" },
  "current affairs": { no: "Aktualitet", sv: "Aktuellt", da: "Aktualitet", de: "Zeitgeschehen", fi: "Ajankohtaista" },
  "national quality": { no: "Riksdekkende kvalitetsavis", sv: "Rikstäckande kvalitetstidning", da: "Landsdækkende kvalitetsavis", de: "Überregionale Qualitätszeitung", fi: "Valtakunnallinen laatulehti" },
  "national tabloid": { no: "Riksdekkende tabloid", sv: "Rikstäckande kvällstidning", da: "Landsdækkende tabloid", de: "Überregionales Boulevardblatt", fi: "Valtakunnallinen iltapäivälehti" },
  "national mid-market": { no: "Riksdekkende (mid-market)", sv: "Rikstäckande (mid-market)", da: "Landsdækkende (mid-market)", de: "Überregional (Mid-Market)", fi: "Valtakunnallinen (mid-market)" },
  // Topics
  health: { no: "Helse", sv: "Hälsa", da: "Sundhed", de: "Gesundheit", fi: "Terveys" },
  law: { no: "Juss", sv: "Juridik", da: "Jura", de: "Recht", fi: "Oikeus" },
  food: { no: "Mat", sv: "Mat", da: "Mad", de: "Essen & Trinken", fi: "Ruoka" },
  auto: { no: "Bil", sv: "Bil", da: "Bil", de: "Auto", fi: "Autot" },
  agriculture: { no: "Landbruk", sv: "Lantbruk", da: "Landbrug", de: "Landwirtschaft", fi: "Maatalous" },
  "home & interior": { no: "Bolig og interiør", sv: "Hem och inredning", da: "Bolig og indretning", de: "Wohnen & Einrichten", fi: "Koti ja sisustus" },
  music: { no: "Musikk", sv: "Musik", da: "Musik", de: "Musik", fi: "Musiikki" },
  literature: { no: "Litteratur", sv: "Litteratur", da: "Litteratur", de: "Literatur", fi: "Kirjallisuus" },
  history: { no: "Historie", sv: "Historia", da: "Historie", de: "Geschichte", fi: "Historia" },
  science: { no: "Vitenskap", sv: "Vetenskap", da: "Videnskab", de: "Wissenschaft", fi: "Tiede" },
  politics: { no: "Politikk", sv: "Politik", da: "Politik", de: "Politik", fi: "Politiikka" },
  "trade union": { no: "Fagforening", sv: "Fackförbund", da: "Fagforening", de: "Gewerkschaft", fi: "Ammattiliitto" },
  christian: { no: "Kristen", sv: "Kristen", da: "Kristen", de: "Christlich", fi: "Kristillinen" },
  religion: { no: "Religion", sv: "Religion", da: "Religion", de: "Religion", fi: "Uskonto" },
  "student newspaper": { no: "Studentavis", sv: "Studenttidning", da: "Studenteravis", de: "Studentenzeitung", fi: "Ylioppilaslehti" },
  "student magazine": { no: "Studentmagasin", sv: "Studentmagasin", da: "Studentermagasin", de: "Studentenmagazin", fi: "Opiskelijalehti" },
  "student press": { no: "Studentpresse", sv: "Studentpress", da: "Studenterpresse", de: "Studentenpresse", fi: "Opiskelijamedia" },
  construction: { no: "Bygg", sv: "Bygg", da: "Byggeri", de: "Bauwesen", fi: "Rakentaminen" },
  "civil engineering": { no: "Anlegg", sv: "Anläggning", da: "Anlæg", de: "Tiefbau", fi: "Infrarakentaminen" },
  medicine: { no: "Medisin", sv: "Medicin", da: "Medicin", de: "Medizin", fi: "Lääketiede" },
  family: { no: "Familie", sv: "Familj", da: "Familie", de: "Familie", fi: "Perhe" },
  energy: { no: "Energi", sv: "Energi", da: "Energi", de: "Energie", fi: "Energia" },
  defence: { no: "Forsvar", sv: "Försvar", da: "Forsvar", de: "Verteidigung", fi: "Maanpuolustus" },
  travel: { no: "Reise", sv: "Resor", da: "Rejser", de: "Reisen", fi: "Matkailu" },
  maritime: { no: "Maritim", sv: "Maritim", da: "Maritim", de: "Maritim", fi: "Merenkulku" },
  equestrian: { no: "Hestesport", sv: "Hästsport", da: "Hestesport", de: "Pferdesport", fi: "Hevosurheilu" },
  technology: { no: "Teknologi", sv: "Teknik", da: "Teknologi", de: "Technologie", fi: "Teknologia" },
  boating: { no: "Båtliv", sv: "Båtliv", da: "Bådliv", de: "Bootssport", fi: "Veneily" },
  animals: { no: "Dyr", sv: "Djur", da: "Dyr", de: "Tiere", fi: "Eläimet" },
  management: { no: "Ledelse", sv: "Ledarskap", da: "Ledelse", de: "Management", fi: "Johtaminen" },
  children: { no: "Barn", sv: "Barn", da: "Børn", de: "Kinder", fi: "Lapset" },
  school: { no: "Skole", sv: "Skola", da: "Skole", de: "Schule", fi: "Koulu" },
  education: { no: "Utdanning", sv: "Utbildning", da: "Uddannelse", de: "Bildung", fi: "Koulutus" },
  pedagogy: { no: "Pedagogikk", sv: "Pedagogik", da: "Pædagogik", de: "Pädagogik", fi: "Pedagogiikka" },
  celebrity: { no: "Kjendis", sv: "Kändisar", da: "Kendte", de: "Promis", fi: "Julkkikset" },
  comics: { no: "Tegneserier", sv: "Serier", da: "Tegneserier", de: "Comics", fi: "Sarjakuvat" },
  research: { no: "Forskning", sv: "Forskning", da: "Forskning", de: "Forschung", fi: "Tutkimus" },
  "women's lifestyle": { no: "Kvinner og livsstil", sv: "Livsstil för kvinnor", da: "Livsstil til kvinder", de: "Frauen & Lifestyle", fi: "Naisten lifestyle" },
  "women's mass market": { no: "Dameblad", sv: "Damtidning", da: "Dameugeblad", de: "Frauenzeitschrift", fi: "Naistenlehti" },
  garden: { no: "Hage", sv: "Trädgård", da: "Have", de: "Garten", fi: "Puutarha" },
  "local history": { no: "Lokalhistorie", sv: "Lokalhistoria", da: "Lokalhistorie", de: "Lokalgeschichte", fi: "Paikallishistoria" },
  business: { no: "Næringsliv", sv: "Näringsliv", da: "Erhverv", de: "Wirtschaft", fi: "Liiketoiminta" },
  sport: { no: "Sport", sv: "Sport", da: "Sport", de: "Sport", fi: "Urheilu" },
  photography: { no: "Foto", sv: "Foto", da: "Foto", de: "Fotografie", fi: "Valokuvaus" },
  "tv & film": { no: "TV og film", sv: "TV och film", da: "TV og film", de: "TV & Film", fi: "TV ja elokuvat" },
  "tv listings": { no: "TV-guide", sv: "TV-guide", da: "TV-guide", de: "TV-Programm", fi: "TV-opas" },
  dogs: { no: "Hund", sv: "Hundar", da: "Hunde", de: "Hunde", fi: "Koirat" },
  architecture: { no: "Arkitektur", sv: "Arkitektur", da: "Arkitektur", de: "Architektur", fi: "Arkkitehtuuri" },
  entertainment: { no: "Underholdning", sv: "Underhållning", da: "Underholdning", de: "Unterhaltung", fi: "Viihde" },
  art: { no: "Kunst", sv: "Konst", da: "Kunst", de: "Kunst", fi: "Taide" },
  hospitality: { no: "Hotell og restaurant", sv: "Hotell och restaurang", da: "Hotel og restauration", de: "Hotellerie & Gastronomie", fi: "Hotelli- ja ravintola-ala" },
  "street magazine": { no: "Gatemagasin", sv: "Gatutidning", da: "Gademagasin", de: "Straßenmagazin", fi: "Katulehti" },
  "outdoor life": { no: "Friluftsliv", sv: "Friluftsliv", da: "Friluftsliv", de: "Outdoor", fi: "Ulkoilu" },
  police: { no: "Politi", sv: "Polis", da: "Politi", de: "Polizei", fi: "Poliisi" },
  fashion: { no: "Mote", sv: "Mode", da: "Mode", de: "Mode", fi: "Muoti" },
  football: { no: "Fotball", sv: "Fotboll", da: "Fodbold", de: "Fußball", fi: "Jalkapallo" },
  academics: { no: "Akademikere", sv: "Akademiker", da: "Akademikere", de: "Akademiker", fi: "Akateemiset" },
  economy: { no: "Økonomi", sv: "Ekonomi", da: "Økonomi", de: "Wirtschaft", fi: "Talous" },
  lifestyle: { no: "Livsstil", sv: "Livsstil", da: "Livsstil", de: "Lifestyle", fi: "Lifestyle" },
  "country lifestyle": { no: "Landliv", sv: "Lantliv", da: "Landliv", de: "Landleben", fi: "Maaseutuelämä" },
  industry: { no: "Industri", sv: "Industri", da: "Industri", de: "Industrie", fi: "Teollisuus" },
  "hvac & plumbing": { no: "VVS", sv: "VVS", da: "VVS", de: "Sanitär & Heizung", fi: "LVI" },
  fisheries: { no: "Fiskeri", sv: "Fiskeri", da: "Fiskeri", de: "Fischerei", fi: "Kalatalous" },
  philosophy: { no: "Filosofi", sv: "Filosofi", da: "Filosofi", de: "Philosophie", fi: "Filosofia" },
  culture: { no: "Kultur", sv: "Kultur", da: "Kultur", de: "Kultur", fi: "Kulttuuri" },
  dentistry: { no: "Tannhelse", sv: "Tandvård", da: "Tandpleje", de: "Zahnmedizin", fi: "Hammaslääketiede" },
  cycling: { no: "Sykling", sv: "Cykling", da: "Cykling", de: "Radsport", fi: "Pyöräily" },
  nature: { no: "Natur", sv: "Natur", da: "Natur", de: "Natur", fi: "Luonto" },
  finance: { no: "Finans", sv: "Finans", da: "Finans", de: "Finanzen", fi: "Rahoitus" },
  marketing: { no: "Markedsføring", sv: "Marknadsföring", da: "Markedsføring", de: "Marketing", fi: "Markkinointi" },
  pharmacy: { no: "Farmasi", sv: "Farmaci", da: "Farmaci", de: "Pharmazie", fi: "Farmasia" },
  nursing: { no: "Sykepleie", sv: "Omvårdnad", da: "Sygepleje", de: "Pflege", fi: "Hoitotyö" },
  film: { no: "Film", sv: "Film", da: "Film", de: "Film", fi: "Elokuva" },
  hunting: { no: "Jakt", sv: "Jakt", da: "Jagt", de: "Jagd", fi: "Metsästys" },
  shooting: { no: "Skyting", sv: "Skytte", da: "Skydning", de: "Schießsport", fi: "Ammunta" },
  fishing: { no: "Fiske", sv: "Fiske", da: "Lystfiskeri", de: "Angeln", fi: "Kalastus" },
  forestry: { no: "Skogbruk", sv: "Skogsbruk", da: "Skovbrug", de: "Forstwirtschaft", fi: "Metsätalous" },
  insurance: { no: "Forsikring", sv: "Försäkring", da: "Forsikring", de: "Versicherung", fi: "Vakuutus" },
  retail: { no: "Detaljhandel", sv: "Detaljhandel", da: "Detailhandel", de: "Einzelhandel", fi: "Vähittäiskauppa" },
  journalism: { no: "Journalistikk", sv: "Journalistik", da: "Journalistik", de: "Journalismus", fi: "Journalismi" },
  psychology: { no: "Psykologi", sv: "Psykologi", da: "Psykologi", de: "Psychologie", fi: "Psykologia" },
  environment: { no: "Miljø", sv: "Miljö", da: "Miljø", de: "Umwelt", fi: "Ympäristö" },
  wine: { no: "Vin", sv: "Vin", da: "Vin", de: "Wein", fi: "Viini" },
  parenting: { no: "Foreldre og barn", sv: "Föräldraskap", da: "Forældre og børn", de: "Eltern & Kind", fi: "Vanhemmuus" },
  youth: { no: "Ungdom", sv: "Ungdom", da: "Unge", de: "Jugend", fi: "Nuoret" },
  motorcycle: { no: "Motorsykkel", sv: "Motorcykel", da: "Motorcykel", de: "Motorrad", fi: "Moottoripyörät" },
  "classic cars": { no: "Veteranbil", sv: "Veteranbilar", da: "Veteranbiler", de: "Oldtimer", fi: "Klassikkoautot" },
  transport: { no: "Transport", sv: "Transport", da: "Transport", de: "Transport", fi: "Kuljetus" },
  it: { no: "IT", sv: "IT", da: "IT", de: "IT", fi: "IT" },
  hr: { no: "HR", sv: "HR", da: "HR", de: "HR", fi: "HR" },
  golf: { no: "Golf", sv: "Golf", da: "Golf", de: "Golf", fi: "Golf" },
  design: { no: "Design", sv: "Design", da: "Design", de: "Design", fi: "Muotoilu" },
};

function lookup(map: TaxonomyMap, value: string, locale: AppLocale): string {
  if (locale === "en") return value;
  const entry = map[value.trim().toLowerCase()];
  return entry?.[locale] ?? value;
}

export function localizeTaxonomy(value: string, locale: AppLocale): string {
  return lookup(TAXONOMY, value, locale);
}

export function localizeVertical(value: string, locale: AppLocale): string {
  return lookup(VERTICAL, value, locale);
}

export function localizeCategory(value: string, locale: AppLocale): string {
  return lookup(CATEGORY, value, locale);
}
