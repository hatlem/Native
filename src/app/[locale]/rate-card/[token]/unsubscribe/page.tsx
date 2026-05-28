import { unsubscribeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  await unsubscribeAction(token);

  const copy: Record<string, { title: string; body: string }> = {
    en: {
      title: "Unsubscribed",
      body: "You will not receive further outreach from NativeSpin. Reach out at any time if that changes.",
    },
    no: {
      title: "Avregistrert",
      body: "Du vil ikke motta flere e-poster fra NativeSpin. Ta gjerne kontakt om det endrer seg.",
    },
    sv: {
      title: "Avregistrerad",
      body: "Du kommer inte att få fler mejl från NativeSpin. Hör gärna av dig om det ändras.",
    },
    da: {
      title: "Afmeldt",
      body: "Du modtager ikke flere mails fra NativeSpin. Sig til hvis det ændrer sig.",
    },
    fi: {
      title: "Peruutettu",
      body: "Et saa enää viestejä NativeSpiniltä. Otathan yhteyttä, jos tilanne muuttuu.",
    },
    de: {
      title: "Abgemeldet",
      body: "Sie erhalten keine weiteren E-Mails von NativeSpin. Melden Sie sich gern, falls sich das ändert.",
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
