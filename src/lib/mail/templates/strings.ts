// Locale-keyed copy for the five auth emails. Co-located with the
// templates because they're tied to the email layout, not the UI
// translation surface. If you add a sixth email, add its strings here.

export type Locale = "en" | "no" | "sv" | "da" | "de" | "fi";

type EmailStrings = {
  magicLink: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: string;
    cta: string;
    footer: string;
  };
  passwordReset: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: string;
    cta: string;
    footer: string;
  };
  welcome: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (app: string) => string;
    cta: string;
    footer: string;
  };
  passwordChanged: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (ip: string, at: string) => string;
    footer: string;
  };
  newSigninAlert: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (ip: string, at: string) => string;
    cta: string;
    footer: string;
  };
};

const en: EmailStrings = {
  magicLink: {
    subject: (app) => `Sign in to ${app}`,
    preheader: "Your sign-in link is ready.",
    heading: "Sign in",
    body: "Click the button below to sign in. This link is valid for 15 minutes and can only be used once.",
    cta: "Sign in",
    footer: "If you didn't request this, you can safely ignore this email.",
  },
  passwordReset: {
    subject: (app) => `Reset your ${app} password`,
    preheader: "Reset your password.",
    heading: "Reset your password",
    body: "Click the button below to set a new password. This link is valid for 15 minutes and can only be used once.",
    cta: "Reset password",
    footer: "If you didn't request this, you can safely ignore this email — your password won't change.",
  },
  welcome: {
    subject: (app) => `Welcome to ${app}`,
    preheader: "Your account is ready.",
    heading: "Welcome",
    body: (app) => `Your ${app} account is ready. Browse the catalog whenever you want, and submit a brief whenever you're ready to buy.`,
    cta: "Browse the catalog",
    footer: "Need help? Just reply to this email.",
  },
  passwordChanged: {
    subject: (app) => `Your ${app} password was changed`,
    preheader: "Password updated.",
    heading: "Password changed",
    body: (ip, at) => `Your password was changed on ${at} (IP ${ip}). If this wasn't you, reply to this email immediately.`,
    footer: "For your security, we email every password change.",
  },
  newSigninAlert: {
    subject: (app) => `New sign-in to your ${app} account`,
    preheader: "A new device signed in.",
    heading: "New sign-in detected",
    body: (ip, at) => `A new sign-in to your account was detected on ${at} (IP ${ip}). If this was you, no action is needed.`,
    cta: "Reset password",
    footer: "If you don't recognise this, reset your password using the button above.",
  },
};

const no: EmailStrings = {
  magicLink: {
    subject: (app) => `Logg inn på ${app}`,
    preheader: "Innloggingslenken din er klar.",
    heading: "Logg inn",
    body: "Klikk på knappen under for å logge inn. Lenken er gyldig i 15 minutter og kan kun brukes én gang.",
    cta: "Logg inn",
    footer: "Hvis du ikke ba om dette, kan du trygt ignorere denne e-posten.",
  },
  passwordReset: {
    subject: (app) => `Tilbakestill passordet ditt på ${app}`,
    preheader: "Tilbakestill passordet ditt.",
    heading: "Tilbakestill passordet",
    body: "Klikk på knappen under for å sette et nytt passord. Lenken er gyldig i 15 minutter og kan kun brukes én gang.",
    cta: "Tilbakestill passord",
    footer: "Hvis du ikke ba om dette, kan du trygt ignorere denne e-posten — passordet ditt vil ikke endres.",
  },
  welcome: {
    subject: (app) => `Velkommen til ${app}`,
    preheader: "Kontoen din er klar.",
    heading: "Velkommen",
    body: (app) => `${app}-kontoen din er klar. Bla i katalogen når du vil, og send inn en brief når du er klar til å kjøpe.`,
    cta: "Utforsk katalogen",
    footer: "Trenger du hjelp? Bare svar på denne e-posten.",
  },
  passwordChanged: {
    subject: (app) => `Passordet ditt på ${app} er endret`,
    preheader: "Passordet er oppdatert.",
    heading: "Passordet er endret",
    body: (ip, at) => `Passordet ditt ble endret ${at} (IP ${ip}). Hvis det ikke var deg, svar på denne e-posten umiddelbart.`,
    footer: "Av sikkerhetshensyn varsler vi om alle passordendringer.",
  },
  newSigninAlert: {
    subject: (app) => `Ny innlogging på ${app}-kontoen din`,
    preheader: "En ny enhet logget inn.",
    heading: "Ny innlogging oppdaget",
    body: (ip, at) => `En ny innlogging på kontoen din ble registrert ${at} (IP ${ip}). Hvis det var deg, trenger du ikke gjøre noe.`,
    cta: "Tilbakestill passord",
    footer: "Hvis du ikke kjenner igjen dette, tilbakestill passordet ditt med knappen over.",
  },
};

const sv: EmailStrings = {
  magicLink: {
    subject: (app) => `Logga in på ${app}`,
    preheader: "Din inloggningslänk är klar.",
    heading: "Logga in",
    body: "Klicka på knappen nedan för att logga in. Länken är giltig i 15 minuter och kan endast användas en gång.",
    cta: "Logga in",
    footer: "Om du inte begärde detta kan du tryggt bortse från det här mejlet.",
  },
  passwordReset: {
    subject: (app) => `Återställ ditt lösenord på ${app}`,
    preheader: "Återställ ditt lösenord.",
    heading: "Återställ ditt lösenord",
    body: "Klicka på knappen nedan för att ange ett nytt lösenord. Länken är giltig i 15 minuter och kan endast användas en gång.",
    cta: "Återställ lösenord",
    footer: "Om du inte begärde detta kan du tryggt bortse från det här mejlet — ditt lösenord ändras inte.",
  },
  welcome: {
    subject: (app) => `Välkommen till ${app}`,
    preheader: "Ditt konto är klart.",
    heading: "Välkommen",
    body: (app) => `Ditt ${app}-konto är klart. Bläddra i katalogen när du vill, och skicka in en brief när du är redo att köpa.`,
    cta: "Utforska katalogen",
    footer: "Behöver du hjälp? Svara bara på det här mejlet.",
  },
  passwordChanged: {
    subject: (app) => `Ditt lösenord på ${app} har ändrats`,
    preheader: "Lösenordet är uppdaterat.",
    heading: "Lösenordet har ändrats",
    body: (ip, at) => `Ditt lösenord ändrades ${at} (IP ${ip}). Om det inte var du, svara på det här mejlet omedelbart.`,
    footer: "Av säkerhetsskäl meddelar vi om alla lösenordsändringar.",
  },
  newSigninAlert: {
    subject: (app) => `Ny inloggning på ditt ${app}-konto`,
    preheader: "En ny enhet loggade in.",
    heading: "Ny inloggning upptäckt",
    body: (ip, at) => `En ny inloggning på ditt konto registrerades ${at} (IP ${ip}). Om det var du behöver du inte göra något.`,
    cta: "Återställ lösenord",
    footer: "Om du inte känner igen detta, återställ ditt lösenord med knappen ovan.",
  },
};

const da: EmailStrings = {
  magicLink: {
    subject: (app) => `Log ind på ${app}`,
    preheader: "Dit login-link er klar.",
    heading: "Log ind",
    body: "Klik på knappen nedenfor for at logge ind. Linket er gyldigt i 15 minutter og kan kun bruges én gang.",
    cta: "Log ind",
    footer: "Hvis du ikke har anmodet om dette, kan du trygt ignorere denne e-mail.",
  },
  passwordReset: {
    subject: (app) => `Nulstil din adgangskode på ${app}`,
    preheader: "Nulstil din adgangskode.",
    heading: "Nulstil din adgangskode",
    body: "Klik på knappen nedenfor for at vælge en ny adgangskode. Linket er gyldigt i 15 minutter og kan kun bruges én gang.",
    cta: "Nulstil adgangskode",
    footer: "Hvis du ikke har anmodet om dette, kan du trygt ignorere denne e-mail — din adgangskode ændres ikke.",
  },
  welcome: {
    subject: (app) => `Velkommen til ${app}`,
    preheader: "Din konto er klar.",
    heading: "Velkommen",
    body: (app) => `Din ${app}-konto er klar. Gennemse kataloget når du vil, og indsend en brief, når du er klar til at købe.`,
    cta: "Udforsk kataloget",
    footer: "Brug for hjælp? Bare svar på denne e-mail.",
  },
  passwordChanged: {
    subject: (app) => `Din adgangskode på ${app} er ændret`,
    preheader: "Adgangskoden er opdateret.",
    heading: "Adgangskoden er ændret",
    body: (ip, at) => `Din adgangskode blev ændret ${at} (IP ${ip}). Hvis det ikke var dig, svar på denne e-mail med det samme.`,
    footer: "Af sikkerhedshensyn varsler vi om alle adgangskodeændringer.",
  },
  newSigninAlert: {
    subject: (app) => `Ny login på din ${app}-konto`,
    preheader: "En ny enhed loggede ind.",
    heading: "Ny login registreret",
    body: (ip, at) => `Et nyt login på din konto blev registreret ${at} (IP ${ip}). Hvis det var dig, behøver du ikke gøre noget.`,
    cta: "Nulstil adgangskode",
    footer: "Hvis du ikke genkender dette, nulstil din adgangskode med knappen ovenfor.",
  },
};

const de: EmailStrings = {
  magicLink: {
    subject: (app) => `Bei ${app} anmelden`,
    preheader: "Ihr Anmeldelink ist bereit.",
    heading: "Anmelden",
    body: "Klicken Sie auf die Schaltfläche unten, um sich anzumelden. Dieser Link ist 15 Minuten lang gültig und kann nur einmal verwendet werden.",
    cta: "Anmelden",
    footer: "Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail einfach ignorieren.",
  },
  passwordReset: {
    subject: (app) => `Setzen Sie Ihr ${app}-Passwort zurück`,
    preheader: "Passwort zurücksetzen.",
    heading: "Passwort zurücksetzen",
    body: "Klicken Sie auf die Schaltfläche unten, um ein neues Passwort festzulegen. Dieser Link ist 15 Minuten lang gültig und kann nur einmal verwendet werden.",
    cta: "Passwort zurücksetzen",
    footer: "Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail einfach ignorieren — Ihr Passwort wird nicht geändert.",
  },
  welcome: {
    subject: (app) => `Willkommen bei ${app}`,
    preheader: "Ihr Konto ist bereit.",
    heading: "Willkommen",
    body: (app) => `Ihr ${app}-Konto ist bereit. Stöbern Sie jederzeit im Katalog, und reichen Sie einen Brief ein, sobald Sie kaufen möchten.`,
    cta: "Zum Katalog",
    footer: "Brauchen Sie Hilfe? Antworten Sie einfach auf diese E-Mail.",
  },
  passwordChanged: {
    subject: (app) => `Ihr ${app}-Passwort wurde geändert`,
    preheader: "Passwort aktualisiert.",
    heading: "Passwort geändert",
    body: (ip, at) => `Ihr Passwort wurde am ${at} geändert (IP ${ip}). Falls Sie das nicht waren, antworten Sie sofort auf diese E-Mail.`,
    footer: "Aus Sicherheitsgründen informieren wir Sie über jede Passwortänderung.",
  },
  newSigninAlert: {
    subject: (app) => `Neue Anmeldung in Ihrem ${app}-Konto`,
    preheader: "Ein neues Gerät hat sich angemeldet.",
    heading: "Neue Anmeldung erkannt",
    body: (ip, at) => `Eine neue Anmeldung in Ihrem Konto wurde am ${at} festgestellt (IP ${ip}). Wenn Sie das waren, ist keine Aktion erforderlich.`,
    cta: "Passwort zurücksetzen",
    footer: "Falls Sie das nicht erkennen, setzen Sie Ihr Passwort über die Schaltfläche oben zurück.",
  },
};

const fi: EmailStrings = {
  magicLink: {
    subject: (app) => `Kirjaudu sisään palveluun ${app}`,
    preheader: "Kirjautumislinkkisi on valmis.",
    heading: "Kirjaudu sisään",
    body: "Napsauta alla olevaa painiketta kirjautuaksesi sisään. Linkki on voimassa 15 minuuttia ja sen voi käyttää vain kerran.",
    cta: "Kirjaudu sisään",
    footer: "Jos et pyytänyt tätä, voit jättää tämän viestin huomiotta.",
  },
  passwordReset: {
    subject: (app) => `Nollaa ${app}-salasanasi`,
    preheader: "Nollaa salasanasi.",
    heading: "Nollaa salasanasi",
    body: "Napsauta alla olevaa painiketta asettaaksesi uuden salasanan. Linkki on voimassa 15 minuuttia ja sen voi käyttää vain kerran.",
    cta: "Nollaa salasana",
    footer: "Jos et pyytänyt tätä, voit jättää tämän viestin huomiotta — salasanaasi ei muuteta.",
  },
  welcome: {
    subject: (app) => `Tervetuloa palveluun ${app}`,
    preheader: "Tilisi on valmis.",
    heading: "Tervetuloa",
    body: (app) => `${app}-tilisi on valmis. Selaa luetteloa milloin haluat, ja lähetä briefi kun olet valmis ostamaan.`,
    cta: "Selaa luetteloa",
    footer: "Tarvitsetko apua? Vastaa vain tähän sähköpostiin.",
  },
  passwordChanged: {
    subject: (app) => `${app}-salasanasi on vaihdettu`,
    preheader: "Salasana päivitetty.",
    heading: "Salasana vaihdettu",
    body: (ip, at) => `Salasanasi vaihdettiin ${at} (IP ${ip}). Jos se et ollut sinä, vastaa tähän sähköpostiin välittömästi.`,
    footer: "Turvallisuussyistä ilmoitamme jokaisesta salasanan vaihdosta.",
  },
  newSigninAlert: {
    subject: (app) => `Uusi kirjautuminen ${app}-tilillesi`,
    preheader: "Uusi laite kirjautui sisään.",
    heading: "Uusi kirjautuminen havaittu",
    body: (ip, at) => `Tililläsi havaittiin uusi kirjautuminen ${at} (IP ${ip}). Jos se olit sinä, mitään ei tarvitse tehdä.`,
    cta: "Nollaa salasana",
    footer: "Jos et tunnista tätä, nollaa salasanasi yllä olevalla painikkeella.",
  },
};

const TABLE: Record<Locale, EmailStrings> = { en, no, sv, da, de, fi };

export function strings(locale: string): EmailStrings {
  return TABLE[(locale as Locale)] ?? en;
}
