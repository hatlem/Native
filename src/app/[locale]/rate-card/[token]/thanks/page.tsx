export default async function ThanksPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale } = await params;

  const copy: Record<string, { title: string; body: string }> = {
    en: {
      title: "Thanks!",
      body: "Your response is in. We'll be in touch when a relevant brief lands.",
    },
    no: {
      title: "Takk!",
      body: "Vi har mottatt svaret ditt. Vi tar kontakt når en relevant henvendelse kommer.",
    },
    sv: {
      title: "Tack!",
      body: "Vi har fått ditt svar. Vi hör av oss när en relevant förfrågan kommer.",
    },
    da: {
      title: "Tak!",
      body: "Vi har modtaget dit svar. Vi vender tilbage når en relevant henvendelse kommer.",
    },
    fi: {
      title: "Kiitos!",
      body: "Olemme saaneet vastauksesi. Otamme yhteyttä, kun olennainen kysely tulee.",
    },
    de: {
      title: "Vielen Dank!",
      body: "Ihre Antwort ist eingegangen. Wir melden uns, wenn ein passendes Brief vorliegt.",
    },
  };

  const c = copy[locale] ?? copy.en;

  return (
    <main className="p-8 max-w-prose mx-auto">
      <h1 className="text-2xl font-semibold">{c.title}</h1>
      <p className="mt-2">{c.body}</p>
    </main>
  );
}
