/* The simulator's site copy beyond Persian and English: German, Arabic, Turkish, French and Spanish, written
   for each language (not word-for-word from the English), keyed by the site language. A kind's items, prices,
   icons and form fields come from the English kind (./sim.ts) in the same order; this file supplies the words,
   the city, the currency and the typography. Any other language falls back to English. */
import "server-only";

export type IntlCopy = "de" | "ar" | "tr" | "fr" | "es";
export const INTL: IntlCopy[] = ["de", "ar", "tr", "fr", "es"];

export type Ui = {
  mainNav: string; mobileNav: string; cart: string; menu: string; skip: string; why: (b: string) => string; reviews: string; rating: string;
  address: string; contactHours: string; rights: string; choose: string; cartEmpty: string; phonePattern: string; phonePlaceholder: string;
  fill: string; phoneBad: string; cartNone: string; added: string; remove: string; total: string; saveFail: string; preview: string;
  serverError: string; required: string; phoneServer: string; sending: string;
};
/** the sections an edit can add (FAQ, gallery, map, newsletter, pricing) and the floating call button */
export type SectionCopy = {
  faq: string; qa: [string, string][]; gallery: string; sample: string; map: string; mapText: string; mapButton: string;
  newsletter: string; newsletterSub: string; subscribed: string; email: string; subscribe: string;
  pricing: string; plans: [string, string][]; choose: string; call: string;
};
type Pairs = [string, string][];
export type KindText = {
  brand: string; title: string; hero: string; sub: string; stats: Pairs; itemsTitle: string; itemsSub: string; itemCta: string;
  items: Pairs; features: Pairs; formTitle: string; formSub: string; submit: string; success: string; testimonials: Pairs; nav: string[];
  hours?: string; address?: string; tickets?: string[];
};
/** the café variant of the restaurant: what differs from it */
type CafeText = Pick<KindText, "brand" | "title" | "hero" | "sub" | "itemsTitle" | "itemsSub" | "items" | "testimonials" | "hours">;
export type Pack = {
  locale: string; quote: [string, string]; money: { pre: string; post: string; rate: number; step: number };
  minutes: (n: number) => string; common: { address: string; phone: string; hours: string };
  ui: Ui; fields: Record<string, string>; sections: SectionCopy;
  kinds: Record<"salon" | "shop" | "restaurant" | "event" | "business", KindText>; cafe: CafeText;
};

const PHONE = "\\+?[0-9 ]{7,20}";

const de: Pack = {
  locale: "de-DE", quote: ["„", "“"], money: { pre: "", post: " €", rate: 1, step: 1 }, minutes: (n) => n + " Min.",
  common: { address: "Kastanienallee 12, 10435 Berlin", phone: "+49 30 1234 5678", hours: "Montag bis Samstag, 10 bis 20 Uhr" },
  ui: {
    mainNav: "Hauptmenü", mobileNav: "Mobiles Menü", cart: "Warenkorb", menu: "Menü", skip: "Zum Inhalt springen", why: (b) => "Warum " + b + "?", reviews: "Das sagen unsere Kunden", rating: "Bewertung",
    address: "Adresse", contactHours: "Kontakt und Öffnungszeiten", rights: "Alle Rechte vorbehalten.", choose: "Bitte wählen…", cartEmpty: "Ihr Warenkorb ist leer; wählen Sie etwas aus unseren Produkten.",
    phonePattern: PHONE, phonePlaceholder: "+49 30 12345678", fill: "Bitte füllen Sie „%s“ aus.", phoneBad: "Bitte geben Sie eine gültige Telefonnummer ein (z. B. +49 30 12345678).", cartNone: "Ihr Warenkorb ist leer.",
    added: "✓ Hinzugefügt", remove: "Entfernen", total: "Summe: ", saveFail: "Das hat leider nicht geklappt; bitte versuchen Sie es erneut.", preview: "Vorschau: %s (Nach der Veröffentlichung wird die Eingabe in der Datenbank gespeichert.)",
    serverError: "Serverfehler; bitte versuchen Sie es gleich noch einmal.", required: "Bitte füllen Sie alle Pflichtfelder aus.", phoneServer: "Die Telefonnummer ist ungültig.", sending: "Wird gesendet…",
  },
  fields: { name: "Vor- und Nachname", phone: "Telefonnummer", email: "E-Mail", service: "Leistung", date: "Datum", time: "Uhrzeit", note: "Anmerkungen (optional)", address: "Lieferadresse", guests: "Personen", ticket: "Ticket", message: "Ihre Nachricht" },
  sections: {
    faq: "Häufige Fragen", qa: [["Wie kann ich meinen Termin ändern?", "Rufen Sie uns einfach bis 24 Stunden vorher an."], ["Wie kann ich bezahlen?", "Mit Karte vor Ort oder online."], ["Gibt es Parkplätze?", "Ja, ein öffentliches Parkhaus ist nur 50 Meter entfernt."]],
    gallery: "Unsere Arbeiten", sample: "Beispiel", map: "So finden Sie uns", mapText: "Mit der Karte direkt bis vor unsere Tür.", mapButton: "Karte öffnen",
    newsletter: "Angebote zuerst erfahren", newsletterSub: "Eine E-Mail im Monat, kein Spam.", subscribed: "Sie sind angemeldet ✓", email: "E-Mail", subscribe: "Abonnieren",
    pricing: "Pakete", plans: [["Basis", "Für den Einstieg"], ["Plus", "Am beliebtesten"], ["Komplett", "Alles inklusive"]], choose: "Auswählen", call: "Jetzt anrufen",
  },
  kinds: {
    salon: {
      brand: "Salon Rosé", title: "Salon Rosé | Termine online buchen", hero: "Schönes Haar, genau dann, wenn es Ihnen passt",
      sub: "Buchen Sie Ihren Termin in weniger als einer Minute online. Erfahrene Stylistinnen, ein gepflegter Salon und klare Preise.",
      stats: [["12+", "Jahre Erfahrung"], ["8.500+", "zufriedene Kundinnen"], ["4,9", "Durchschnittsbewertung"]], itemsTitle: "Leistungen und Preise", itemsSub: "Alle Preise sind Endpreise, ohne Überraschungen an der Kasse.", itemCta: "Jetzt buchen",
      items: [["Schnitt und Föhnen", "Beratung zur Gesichtsform, moderner Schnitt und perfektes Styling"], ["Farbe und Strähnchen", "Italienische Farben mit kostenlosem Verträglichkeitstest"], ["Keratinbehandlung", "Glatt und glänzend für bis zu sechs Monate"], ["Make-up für Anlässe", "Langanhaltendes Make-up mit hautfreundlichen Produkten"], ["Gel-Maniküre", "Sterile Werkzeuge, langlebiges Finish und dezentes Nail-Art"], ["Augenbrauen in Form", "Zupfen und Färben passend zu Ihrem Gesicht"]],
      features: [["Echte Markenprodukte", "Nur geprüfte Marken mit klarer Haltbarkeit"], ["Hygiene ohne Kompromisse", "Sterile Einmalwerkzeuge für jede Kundin"], ["Pünktlich", "Dank Online-Buchung ohne Wartezeit"]],
      formTitle: "Termin buchen", formSub: "Wählen Sie Leistung und Uhrzeit; wir rufen Sie zur Bestätigung an.", submit: "Termin buchen", success: "Ihr Termin ist gebucht! Wir rufen Sie in Kürze zur Bestätigung an.",
      testimonials: [["Lena Fischer", "Die Farbe ist genau so geworden, wie ich sie wollte, und die Online-Buchung ging in Sekunden."], ["Sophie Wagner", "Ruhig, sauber und herzlich. Auch für die Hochzeit meiner Schwester waren wir hier."], ["Anna Becker", "Wunderschöne Gelnägel, und es ging pünktlich los."]],
      nav: ["Leistungen", "Warum wir", "Buchen", "Bewertungen", "Kontakt"],
    },
    shop: {
      brand: "Nila Mode", title: "Nila Mode | Online-Shop", hero: "Alltagsmode, die sich gut anfühlt", sub: "Bequeme, sorgfältig verarbeitete Kleidung zu fairen Preisen, schneller Versand und 7 Tage Rückgaberecht.",
      stats: [["2 Tage", "Lieferzeit"], ["7 Tage", "kostenlose Rückgabe"], ["12.000+", "Bestellungen"]], itemsTitle: "Bestseller", itemsSub: "Nur solange der Vorrat reicht: in den Warenkorb legen und bestellen.", itemCta: "In den Warenkorb",
      items: [["Sommerkleid aus Leinen", "Atmungsaktives Leinen, Größen XS bis XL"], ["Klassisches Baumwoll-T-Shirt", "100 % Baumwolle in sechs Farben"], ["Gerade geschnittene Jeans", "Weicher Stretch-Denim"], ["Herbstjacke aus Wolle", "Warmer Wollmix mit Satinfutter"], ["Weiße Leder-Sneaker", "Obermaterial aus Leder, gepolsterte Sohle"], ["Bedrucktes Baumwolltuch", "Leicht und weich, für jede Jahreszeit"]],
      features: [["Kostenloser Versand", "Ab 100 € Bestellwert"], ["Einfache Rückgabe", "Innerhalb von sieben Tagen, ohne Rückfragen"], ["Sicher bezahlen", "Geprüfter Zahlungsanbieter oder Zahlung bei Lieferung"]],
      formTitle: "Bestellung aufgeben", formSub: "Geben Sie die Lieferdaten ein; wir rufen vor dem Versand an.", submit: "Jetzt bestellen", success: "Bestellung eingegangen! Wir melden uns zur Abstimmung der Lieferung.",
      testimonials: [["Julia Schmidt", "Der Stoff ist noch schöner als auf den Fotos, und nach zwei Tagen war alles da."], ["Jonas Weber", "Ich hatte die falsche Größe bestellt; der Umtausch war ganz einfach."], ["Marie Hoffmann", "Faire Preise und eine schöne Verpackung."]],
      nav: ["Produkte", "Warum Nila", "Warenkorb", "Bewertungen", "Kontakt"],
    },
    restaurant: {
      brand: "Sofreh Küche", title: "Sofreh Küche | Tisch reservieren", hours: "Täglich von 12 bis 23 Uhr", hero: "Persische Hausmannskost, jeden Tag frisch",
      sub: "Traditionelle Rezepte, morgens frisch eingekaufte Zutaten und ein warmer Raum für Abende mit der Familie. Reservieren Sie Ihren Tisch online.",
      stats: [["25+", "Gerichte"], ["18 Jahre", "in der Stadt"], ["4,8", "Gästebewertung"]], itemsTitle: "Heute auf der Karte", itemsSub: "Alle Gerichte serviert mit feinstem Basmatireis.", itemCta: "Tisch reservieren",
      items: [["Kabab Koobideh", "Zwei Spieße mit Safranreis und gegrillter Tomate"], ["Safran-Hähnchenspieß", "Hähnchenbrust in Safran und Zitrone"], ["Ghormeh Sabzi", "Langsam geschmorte Kräuter mit Kidneybohnen und Rind"], ["Zereshk Polo", "Hähnchen mit Berberitzenreis und Pistazien"], ["Mirza Ghasemi", "Rauchige Auberginen-Vorspeise aus Gilan"], ["Faloodeh", "Rosenwasser-Sorbet mit frischer Limette"]],
      features: [["Täglich frisch", "Zutaten vom Morgenmarkt"], ["Erfahrener Koch", "Rezepte aus der Familienküche"], ["Parkplätze", "Kostenlos für unsere Gäste"]],
      formTitle: "Tisch reservieren", formSub: "Wählen Sie Personenzahl und Uhrzeit.", submit: "Reservieren", success: "Ihr Tisch ist reserviert. Wir freuen uns auf Sie!",
      testimonials: [["Daniel Braun", "Das beste Koobideh, das ich außerhalb Teherans gegessen habe."], ["Hannah Klein", "Wir haben für den Geburtstag meiner Mutter reserviert; der Service war wunderbar."], ["Lukas Wolf", "Das Ghormeh Sabzi schmeckt wie zu Hause."]],
      nav: ["Speisekarte", "Warum wir", "Reservieren", "Bewertungen", "Kontakt"],
    },
    event: {
      brand: "Tech-Gipfel Berlin", title: "Tech-Gipfel Berlin 2026 | Anmeldung", hours: "Donnerstag, 10. Dezember 2026, 9 bis 17 Uhr", address: "Messe Berlin, Halle 7, Messedamm 22, 14055 Berlin",
      hero: "Ein Tag, sechs Sessions, jede Menge neue Ideen", sub: "Das jährliche Treffen der Tech-Szene, von KI bis Cloud-Infrastruktur. Die Plätze sind begrenzt; melden Sie sich jetzt an.",
      stats: [["800", "Teilnehmende"], ["12", "Speaker"], ["6", "Sessions"]], itemsTitle: "Programm", itemsSub: "Donnerstag, 10. Dezember 2026 · Messe Berlin", itemCta: "Anmelden",
      items: [["Keynote: KI in der Praxis", "Dr. Sarah Sharif, Forscherin für maschinelles Lernen"], ["Cloud-Infrastruktur für Start-ups", "Kaveh Noori, Cloud-Architekt"], ["Einen Online-Shop wachsen lassen", "Nilufar Ahmadi, Produktverantwortliche"], ["Nutzerdaten schützen", "Dr. Omid Rahimi, Sicherheitsingenieur"], ["Podium: Von der Idee zum Produkt", "Drei Gründerinnen und Gründer über das, was funktioniert hat"], ["Networking und Erfrischungen", "Speaker und Teilnehmende kennenlernen"]],
      features: [["Teilnahmezertifikat", "Für alle Teilnehmenden"], ["Mittagessen inklusive", "Dazu Kaffeepausen"], ["Aufzeichnungen", "Ein Jahr Zugriff nach dem Event"]],
      formTitle: "Zum Gipfel anmelden", formSub: "Ihr Ticket und alle Details kommen per E-Mail.", submit: "Anmelden", success: "Sie sind angemeldet! Ihr Ticket ist unterwegs in Ihr Postfach.",
      tickets: ["Standard — 90 €", "Studierende — 45 €", "VIP — 250 €"],
      testimonials: [["Felix Richter", "Letztes Jahr habe ich dort zwei großartige Teammitglieder kennengelernt."], ["Laura Neumann", "Praxisnahe Sessions, und alles lief pünktlich."], ["Tim Schulz", "Das beste Tech-Event meines Jahres."]],
      nav: ["Programm", "Vorteile", "Anmeldung", "Bewertungen", "Veranstaltungsort"],
    },
    business: {
      brand: "Atelier Nord", title: "Atelier Nord | Über uns und Kontakt", hero: "Einfach, professionell und für Sie da",
      sub: "Alles, was Ihre Kundschaft wissen muss, auf einer Seite: Leistungen, Ihre Stärken und der Weg zu Ihnen. Schreiben Sie uns, wir melden uns zurück.",
      stats: [["10+", "Jahre"], ["300+", "Projekte"], ["24/7", "Support"]], itemsTitle: "Was wir tun", itemsSub: "Der passende Ansatz für Ihre Anforderungen", itemCta: "Beratung anfragen",
      items: [["Kostenlose Beratung", "Erst zuhören, dann den besten Weg vorschlagen"], ["Maßgeschneidertes Design", "Passend zu Ihren Zielen und Ihrem Budget"], ["Schnelle Umsetzung", "Schritt für Schritt, mit regelmäßigen Updates"], ["Betreuung", "Wir bleiben auch nach dem Start an Ihrer Seite"], ["Auswertungen", "Ergebnisse in klaren Zahlen"], ["Faire Verträge", "Keine versteckten Kosten"]],
      features: [["Qualitätsgarantie", "Bis Sie zufrieden sind"], ["Schnelle Antworten", "Innerhalb einer Geschäftsstunde"], ["Zahlung in Etappen", "Je nach Projektfortschritt"]],
      formTitle: "Kontakt aufnehmen", formSub: "Hinterlassen Sie eine Nachricht; wir antworten innerhalb eines Werktags.", submit: "Nachricht senden", success: "Danke! Wir melden uns in Kürze.",
      testimonials: [["Clara Meyer", "Professionell und präzise: genau das, was wir gebraucht haben."], ["Paul Schröder", "Schnelle Antworten und ein fairer Preis."], ["Emilia Koch", "Die Zusammenarbeit war eine echte Freude."]],
      nav: ["Leistungen", "Warum wir", "Kontakt", "Bewertungen", "Adresse"],
    },
  },
  cafe: {
    brand: "Café Eckstück", title: "Café Eckstück | Tisch reservieren", hours: "Täglich von 8 bis 22 Uhr", hero: "Guter Kaffee, entspannte Morgen",
    sub: "Spezialitätenkaffee, hausgemachtes Gebäck und eine ruhige Ecke zum Arbeiten oder Treffen. Reservieren Sie Ihren Tisch online.", itemsTitle: "Auf der Karte", itemsSub: "Hafer- und Mandelmilch ohne Aufpreis.",
    items: [["Flat White", "Doppelter Ristretto mit samtigem Milchschaum"], ["Buttercroissant", "Jeden Morgen bei uns gebacken"], ["Käsekuchen des Tages", "Fragen Sie nach dem heutigen Topping"], ["Eiskaffee Latte", "Kalte Milch, Espresso und Eis"], ["Halloumi-Sandwich", "Gegrillter Halloumi, Tomate und Basilikum"], ["Safrantee", "Schwarztee mit einem Hauch Safran"]],
    testimonials: [["Daniel Braun", "Der beste Flat White im ganzen Viertel."], ["Hannah Klein", "Wir haben für den Geburtstag meiner Mutter reserviert; der Service war wunderbar."], ["Lukas Wolf", "Morgens schön ruhig, perfekt zum Arbeiten."]],
  },
};

const fr: Pack = {
  locale: "fr-FR", quote: ["« ", " »"], money: { pre: "", post: " €", rate: 1, step: 1 }, minutes: (n) => n + " min",
  common: { address: "12 rue des Martyrs, 75009 Paris", phone: "+33 1 23 45 67 89", hours: "Du lundi au samedi, de 10 h à 20 h" },
  ui: {
    mainNav: "Menu principal", mobileNav: "Menu mobile", cart: "Panier", menu: "Menu", skip: "Aller au contenu", why: (b) => "Pourquoi " + b + " ?", reviews: "Ce que disent nos clients", rating: "Note",
    address: "Adresse", contactHours: "Contact et horaires", rights: "Tous droits réservés.", choose: "Choisissez…", cartEmpty: "Votre panier est vide ; choisissez parmi nos produits.",
    phonePattern: PHONE, phonePlaceholder: "+33 1 23 45 67 89", fill: "Veuillez remplir « %s ».", phoneBad: "Veuillez saisir un numéro de téléphone valide (par ex. +33 1 23 45 67 89).", cartNone: "Votre panier est vide.",
    added: "✓ Ajouté", remove: "Retirer", total: "Total : ", saveFail: "L’envoi n’a pas abouti ; veuillez réessayer.", preview: "Aperçu : %s (une fois le site publié, les données sont enregistrées dans la base.)",
    serverError: "Erreur du serveur ; réessayez dans un instant.", required: "Veuillez remplir tous les champs obligatoires.", phoneServer: "Le numéro de téléphone n’est pas valide.", sending: "Envoi en cours…",
  },
  fields: { name: "Nom et prénom", phone: "Téléphone", email: "E-mail", service: "Prestation", date: "Date", time: "Heure", note: "Remarques (facultatif)", address: "Adresse de livraison", guests: "Nombre de personnes", ticket: "Billet", message: "Votre message" },
  sections: {
    faq: "Questions fréquentes", qa: [["Comment modifier mon rendez-vous ?", "Appelez-nous simplement jusqu’à 24 heures avant."], ["Comment payer ?", "Par carte sur place ou en ligne."], ["Y a-t-il un parking ?", "Oui, un parking public se trouve à 50 mètres."]],
    gallery: "Nos réalisations", sample: "Exemple", map: "Nous trouver", mapText: "L’itinéraire jusqu’à notre porte.", mapButton: "Ouvrir la carte",
    newsletter: "Soyez les premiers informés de nos offres", newsletterSub: "Un e-mail par mois, sans spam.", subscribed: "Inscription confirmée ✓", email: "E-mail", subscribe: "S’abonner",
    pricing: "Formules", plans: [["Essentiel", "Pour bien démarrer"], ["Plus", "La plus choisie"], ["Complète", "Tout compris"]], choose: "Choisir", call: "Appelez-nous",
  },
  kinds: {
    salon: {
      brand: "Salon Rose", title: "Salon Rose | Réservation en ligne", hero: "De beaux cheveux, au moment qui vous convient",
      sub: "Réservez votre rendez-vous en ligne en moins d’une minute. Des coiffeuses expérimentées, un salon impeccable et des prix clairs.",
      stats: [["12+", "ans d’expérience"], ["8 500+", "clientes ravies"], ["4,9", "note moyenne"]], itemsTitle: "Prestations et tarifs", itemsSub: "Prix tout compris, sans surprise au moment de payer.", itemCta: "Réserver",
      items: [["Coupe et brushing", "Conseil morphologie, coupe actuelle et finition soignée"], ["Couleur et mèches", "Couleurs italiennes avec test de tolérance offert"], ["Lissage à la kératine", "Lisse et brillant jusqu’à six mois"], ["Maquillage événement", "Tenue longue durée, produits hypoallergéniques"], ["Manucure gel", "Outils stérilisés, tenue durable et nail art discret"], ["Restructuration des sourcils", "Épilation et teinture adaptées à votre visage"]],
      features: [["Produits authentiques", "Uniquement des marques reconnues, aux dates de péremption claires"], ["Hygiène irréprochable", "Outils stériles et à usage unique pour chaque cliente"], ["À l’heure", "Grâce à la réservation en ligne, sans attente"]],
      formTitle: "Prendre rendez-vous", formSub: "Choisissez une prestation et un horaire ; nous vous appelons pour confirmer.", submit: "Réserver", success: "C’est réservé ! Nous vous appelons très vite pour confirmer.",
      testimonials: [["Camille Martin", "La couleur est exactement celle que j’espérais, et la réservation en ligne a pris quelques secondes."], ["Léa Bernard", "Calme, propre et chaleureux. Nous l’avons aussi choisi pour le mariage de ma sœur."], ["Chloé Dubois", "De superbes ongles en gel, et tout a commencé à l’heure."]],
      nav: ["Prestations", "Pourquoi nous", "Réserver", "Avis", "Contact"],
    },
    shop: {
      brand: "Nila Mode", title: "Nila Mode | Boutique en ligne", hero: "Le style du quotidien, tout en confort", sub: "Des vêtements confortables et bien finis à prix justes, une livraison rapide et des retours sous sept jours.",
      stats: [["2 jours", "de livraison"], ["7 jours", "retours gratuits"], ["12 000+", "commandes"]], itemsTitle: "Meilleures ventes", itemsSub: "Stock limité : ajoutez au panier et passez commande.", itemCta: "Ajouter au panier",
      items: [["Robe d’été en lin", "Lin respirant, du XS au XL"], ["T-shirt classique en coton", "100 % coton, six coloris"], ["Jean coupe droite", "Denim stretch tout doux"], ["Veste d’automne en laine", "Laine mélangée chaude, doublure satin"], ["Baskets en cuir blanc", "Tige en cuir, semelle amortissante"], ["Foulard en coton imprimé", "Léger et doux, pour toutes les saisons"]],
      features: [["Livraison offerte", "Dès 100 € d’achat"], ["Retours faciles", "Sous sept jours, sans justification"], ["Paiement sécurisé", "Plateforme de paiement fiable ou paiement à la livraison"]],
      formTitle: "Passer commande", formSub: "Indiquez vos coordonnées de livraison ; nous vous appelons avant l’envoi.", submit: "Commander", success: "Commande enregistrée ! Nous vous appelons pour organiser la livraison.",
      testimonials: [["Manon Petit", "Le tissu est encore plus beau qu’en photo, et tout est arrivé en deux jours."], ["Hugo Laurent", "J’avais commandé la mauvaise taille : l’échange a été un jeu d’enfant."], ["Inès Moreau", "Des prix honnêtes et un joli emballage."]],
      nav: ["Produits", "Pourquoi Nila", "Panier", "Avis", "Contact"],
    },
    restaurant: {
      brand: "Sofreh Cuisine", title: "Sofreh Cuisine | Réserver une table", hours: "Tous les jours, de 12 h à 23 h", hero: "La cuisine persane maison, fraîche chaque jour",
      sub: "Des recettes traditionnelles, des produits achetés chaque matin et une salle chaleureuse pour les dîners en famille. Réservez votre table en ligne.",
      stats: [["25+", "plats"], ["18 ans", "dans le quartier"], ["4,8", "note des clients"]], itemsTitle: "La carte du jour", itemsSub: "Tous les plats sont servis avec un riz basmati de qualité.", itemCta: "Réserver une table",
      items: [["Kabab koobideh", "Deux brochettes, riz au safran et tomate grillée"], ["Brochette de poulet au safran", "Blanc de poulet mariné au safran et au citron"], ["Ghormeh sabzi", "Herbes mijotées, haricots rouges et bœuf"], ["Zereshk polo", "Poulet, riz aux baies d’épine-vinette et pistaches"], ["Mirza ghasemi", "Entrée d’aubergines fumées du Gilan"], ["Faloodeh", "Sorbet à l’eau de rose et citron vert frais"]],
      features: [["Frais chaque jour", "Produits du marché du matin"], ["Chef expérimenté", "Des recettes transmises en famille"], ["Parking", "Gratuit pour nos clients"]],
      formTitle: "Réserver une table", formSub: "Choisissez le nombre de personnes et l’horaire.", submit: "Réserver", success: "Votre table est réservée. À très bientôt !",
      testimonials: [["Thomas Roux", "Le meilleur koobideh que j’aie mangé hors de Téhéran."], ["Sarah Fournier", "Nous avons réservé pour l’anniversaire de ma mère : un service merveilleux."], ["Louis Girard", "Le ghormeh sabzi a le goût de la cuisine de famille."]],
      nav: ["Carte", "Pourquoi nous", "Réserver", "Avis", "Contact"],
    },
    event: {
      brand: "Sommet Tech Paris", title: "Sommet Tech Paris 2026 | Inscription", hours: "Jeudi 10 décembre 2026, de 9 h à 17 h", address: "Paris Expo Porte de Versailles, Hall 7, 75015 Paris",
      hero: "Une journée, six sessions, plein d’idées neuves", sub: "Le rendez-vous annuel de celles et ceux qui construisent, de l’IA à l’infrastructure cloud. Places limitées : inscrivez-vous dès maintenant.",
      stats: [["800", "participants"], ["12", "intervenants"], ["6", "sessions"]], itemsTitle: "Programme", itemsSub: "Jeudi 10 décembre 2026 · Paris Expo Porte de Versailles", itemCta: "S’inscrire",
      items: [["Keynote d’ouverture : l’IA en pratique", "Dr Sarah Sharif, chercheuse en apprentissage automatique"], ["L’infrastructure cloud pour les start-up", "Kaveh Noori, architecte cloud"], ["Faire grandir une boutique en ligne", "Nilufar Ahmadi, responsable produit"], ["Protéger les données des utilisateurs", "Dr Omid Rahimi, ingénieur sécurité"], ["Table ronde : de l’idée au produit", "Trois fondateurs racontent ce qui a marché"], ["Networking et rafraîchissements", "Rencontrez intervenants et participants"]],
      features: [["Attestation", "Pour chaque participant"], ["Déjeuner inclus", "Ainsi que les pauses café"], ["Replays", "Un an d’accès après l’événement"]],
      formTitle: "S’inscrire au sommet", formSub: "Votre billet et les détails arrivent par e-mail.", submit: "S’inscrire", success: "Vous êtes inscrit ! Votre billet arrive dans votre boîte mail.",
      tickets: ["Standard — 90 €", "Étudiant — 45 €", "VIP — 250 €"],
      testimonials: [["Antoine Lefèvre", "L’an dernier, j’y ai rencontré deux super coéquipiers."], ["Julie Mercier", "Des sessions concrètes, et tout était à l’heure."], ["Nicolas Blanc", "Le meilleur événement tech de mon année."]],
      nav: ["Programme", "Avantages", "Inscription", "Avis", "Lieu"],
    },
    business: {
      brand: "Atelier Lumière", title: "Atelier Lumière | À propos et contact", hero: "Simple, professionnel, à votre écoute",
      sub: "Tout ce que vos clients doivent savoir sur une seule page : vos services, vos atouts et comment vous joindre. Laissez-nous un message, nous vous répondons rapidement.",
      stats: [["10+", "ans"], ["300+", "projets"], ["24/7", "assistance"]], itemsTitle: "Ce que nous faisons", itemsSub: "L’approche adaptée à vos besoins", itemCta: "Demander conseil",
      items: [["Conseil gratuit", "Nous écoutons d’abord, puis proposons la meilleure voie"], ["Conception sur mesure", "Adaptée à vos objectifs et à votre budget"], ["Réalisation rapide", "Étape par étape, avec des points réguliers"], ["Accompagnement", "Nous restons à vos côtés après le lancement"], ["Suivi des résultats", "Des résultats mesurés en chiffres"], ["Contrats clairs", "Aucun coût caché"]],
      features: [["Qualité garantie", "Jusqu’à votre entière satisfaction"], ["Réponses rapides", "En moins d’une heure ouvrée"], ["Paiement échelonné", "Au fil de l’avancement"]],
      formTitle: "Nous contacter", formSub: "Laissez un message ; nous répondons sous un jour ouvré.", submit: "Envoyer le message", success: "Merci ! Nous revenons vers vous très vite.",
      testimonials: [["Élise Garnier", "Professionnels et précis : exactement ce qu’il nous fallait."], ["Mathieu Faure", "Des réponses rapides et un prix juste."], ["Zoé Chevalier", "Une collaboration vraiment agréable."]],
      nav: ["Services", "Pourquoi nous", "Contact", "Avis", "Adresse"],
    },
  },
  cafe: {
    brand: "Café du Coin", title: "Café du Coin | Réserver une table", hours: "Tous les jours, de 8 h à 22 h", hero: "Du bon café, des matins sans hâte",
    sub: "Café de spécialité, viennoiseries maison et un coin tranquille pour travailler ou se retrouver. Réservez votre table en ligne.", itemsTitle: "À la carte", itemsSub: "Lait d’avoine ou d’amande sans supplément.",
    items: [["Flat white", "Double ristretto et lait soyeux"], ["Croissant au beurre", "Cuit sur place chaque matin"], ["Cheesecake du jour", "Demandez-nous la garniture du jour"], ["Latte glacé", "Lait froid, espresso et glaçons"], ["Sandwich halloumi", "Halloumi grillé, tomate et basilic"], ["Thé au safran", "Thé noir relevé d’une touche de safran"]],
    testimonials: [["Thomas Roux", "Le meilleur flat white du quartier, sans hésiter."], ["Sarah Fournier", "Nous avons réservé pour l’anniversaire de ma mère : un service merveilleux."], ["Louis Girard", "Calme le matin, parfait pour travailler."]],
  },
};

const es: Pack = {
  locale: "es-ES", quote: ["«", "»"], money: { pre: "", post: " €", rate: 1, step: 1 }, minutes: (n) => n + " min",
  common: { address: "Calle de Fuencarral 124, 28004 Madrid", phone: "+34 912 345 678", hours: "De lunes a sábado, de 10:00 a 20:00" },
  ui: {
    mainNav: "Menú principal", mobileNav: "Menú móvil", cart: "Carrito", menu: "Menú", skip: "Saltar al contenido", why: (b) => "¿Por qué " + b + "?", reviews: "Lo que dicen nuestros clientes", rating: "Valoración",
    address: "Dirección", contactHours: "Contacto y horario", rights: "Todos los derechos reservados.", choose: "Elige…", cartEmpty: "Tu carrito está vacío; elige algo de nuestros productos.",
    phonePattern: PHONE, phonePlaceholder: "+34 612 345 678", fill: "Rellena «%s», por favor.", phoneBad: "Introduce un número de teléfono válido (por ejemplo, +34 612 345 678).", cartNone: "Tu carrito está vacío.",
    added: "✓ Añadido", remove: "Quitar", total: "Total: ", saveFail: "No se pudo enviar; inténtalo de nuevo.", preview: "Vista previa: %s (una vez publicado, se guarda en la base de datos.)",
    serverError: "Error del servidor; inténtalo de nuevo en un momento.", required: "Rellena todos los campos obligatorios.", phoneServer: "El número de teléfono no es válido.", sending: "Enviando…",
  },
  fields: { name: "Nombre y apellidos", phone: "Teléfono", email: "Correo electrónico", service: "Servicio", date: "Fecha", time: "Hora", note: "Notas (opcional)", address: "Dirección de entrega", guests: "Personas", ticket: "Entrada", message: "Tu mensaje" },
  sections: {
    faq: "Preguntas frecuentes", qa: [["¿Cómo cambio mi cita?", "Llámanos hasta 24 horas antes."], ["¿Cómo puedo pagar?", "Con tarjeta en el local o online."], ["¿Hay aparcamiento?", "Sí, hay un parking público a 50 metros."]],
    gallery: "Nuestros trabajos", sample: "Muestra", map: "Cómo llegar", mapText: "Indicaciones directas hasta nuestra puerta.", mapButton: "Abrir el mapa",
    newsletter: "Entérate antes que nadie de nuestras ofertas", newsletterSub: "Un correo al mes, sin spam.", subscribed: "¡Suscripción confirmada! ✓", email: "Correo electrónico", subscribe: "Suscribirme",
    pricing: "Planes", plans: [["Básico", "Para empezar"], ["Plus", "El más elegido"], ["Completo", "Todo incluido"]], choose: "Elegir", call: "Llámanos",
  },
  kinds: {
    salon: {
      brand: "Salón Rosa", title: "Salón Rosa | Reserva online", hero: "Un pelo precioso, cuando a ti te viene bien",
      sub: "Reserva tu cita online en menos de un minuto. Estilistas con experiencia, un salón impecable y precios claros.",
      stats: [["12+", "años de experiencia"], ["8.500+", "clientas felices"], ["4,9", "valoración media"]], itemsTitle: "Servicios y precios", itemsSub: "Precios finales, sin sorpresas al pagar.", itemCta: "Reservar",
      items: [["Corte y peinado", "Asesoría según tu rostro, corte actual y acabado perfecto"], ["Color y mechas", "Tintes italianos con prueba de alergia gratuita"], ["Alisado de queratina", "Liso y brillante hasta seis meses"], ["Maquillaje para eventos", "Larga duración con productos hipoalergénicos"], ["Manicura en gel", "Herramientas esterilizadas, acabado duradero y nail art sencillo"], ["Diseño de cejas", "Depilación y tinte a la medida de tu rostro"]],
      features: [["Productos originales", "Solo marcas de confianza con caducidad clara"], ["Higiene impecable", "Herramientas estériles y de un solo uso para cada clienta"], ["Puntualidad", "Con la reserva online, sin esperas"]],
      formTitle: "Reserva tu cita", formSub: "Elige servicio y hora; te llamamos para confirmar.", submit: "Reservar ahora", success: "¡Cita reservada! Te llamaremos enseguida para confirmarla.",
      testimonials: [["Lucía García", "El color quedó justo como quería, y reservar online fue cuestión de segundos."], ["Marta López", "Tranquilo, limpio y con un trato cercano. También lo elegimos para la boda de mi hermana."], ["Paula Martín", "Unas uñas de gel preciosas, y empezaron a la hora."]],
      nav: ["Servicios", "Por qué nosotros", "Reservar", "Opiniones", "Contacto"],
    },
    shop: {
      brand: "Nila Moda", title: "Nila Moda | Tienda online", hero: "Estilo para el día a día, con una calidad que se nota", sub: "Ropa cómoda y bien confeccionada a precios justos, envío rápido y devoluciones en siete días.",
      stats: [["2 días", "de envío"], ["7 días", "devolución gratuita"], ["12.000+", "pedidos"]], itemsTitle: "Lo más vendido", itemsSub: "Existencias limitadas: añádelo al carrito y haz tu pedido.", itemCta: "Añadir al carrito",
      items: [["Vestido de lino de verano", "Lino transpirable, tallas XS a XL"], ["Camiseta clásica de algodón", "100 % algodón en seis colores"], ["Vaqueros rectos", "Denim elástico y suave"], ["Chaqueta de lana de otoño", "Mezcla de lana cálida con forro de satén"], ["Zapatillas de piel blancas", "Piel por fuera, suela acolchada"], ["Pañuelo de algodón estampado", "Ligero y suave, para todo el año"]],
      features: [["Envío gratis", "En pedidos de más de 100 €"], ["Devoluciones fáciles", "En siete días, sin preguntas"], ["Pago seguro", "Pasarela de confianza o pago contra reembolso"]],
      formTitle: "Haz tu pedido", formSub: "Indica los datos de entrega; te llamamos antes del envío.", submit: "Hacer pedido", success: "¡Pedido recibido! Te llamaremos para coordinar la entrega.",
      testimonials: [["Carmen Ruiz", "La tela es aún mejor que en las fotos y llegó en dos días."], ["Javier Moreno", "Pedí la talla equivocada y el cambio fue facilísimo."], ["Elena Torres", "Precios justos y un embalaje precioso."]],
      nav: ["Productos", "Por qué Nila", "Carrito", "Opiniones", "Contacto"],
    },
    restaurant: {
      brand: "Cocina Sofreh", title: "Cocina Sofreh | Reserva tu mesa", hours: "Todos los días, de 12:00 a 23:00", hero: "Cocina persa casera, fresca cada día",
      sub: "Recetas tradicionales, ingredientes comprados cada mañana y un comedor acogedor para cenas en familia. Reserva tu mesa online.",
      stats: [["25+", "platos"], ["18 años", "en la ciudad"], ["4,8", "valoración"]], itemsTitle: "El menú de hoy", itemsSub: "Todos los platos se sirven con arroz basmati de primera.", itemCta: "Reservar mesa",
      items: [["Kabab koobideh", "Dos brochetas con arroz al azafrán y tomate a la parrilla"], ["Brocheta de pollo al azafrán", "Pechuga marinada en azafrán y limón"], ["Ghormeh sabzi", "Guiso lento de hierbas, alubias rojas y ternera"], ["Zereshk polo", "Pollo con arroz de agracejo y pistachos"], ["Mirza ghasemi", "Entrante de berenjena ahumada de Guilán"], ["Faloodeh", "Sorbete de agua de rosas con lima fresca"]],
      features: [["Fresco cada día", "Ingredientes del mercado de la mañana"], ["Chef con experiencia", "Recetas heredadas en casa"], ["Aparcamiento", "Gratis para nuestros clientes"]],
      formTitle: "Reserva tu mesa", formSub: "Elige el número de personas y la hora.", submit: "Reservar", success: "Tu mesa está reservada. ¡Te esperamos!",
      testimonials: [["Daniel Romero", "El mejor koobideh que he probado fuera de Teherán."], ["Ana Navarro", "Reservamos para el cumpleaños de mi madre y el servicio fue maravilloso."], ["Pablo Díaz", "El ghormeh sabzi sabe a comida casera."]],
      nav: ["Menú", "Por qué nosotros", "Reservar", "Opiniones", "Contacto"],
    },
    event: {
      brand: "Cumbre Tech Madrid", title: "Cumbre Tech Madrid 2026 | Inscripción", hours: "Jueves, 10 de diciembre de 2026, de 9:00 a 17:00", address: "IFEMA Madrid, Pabellón 7, Av. del Partenón 5, 28042 Madrid",
      hero: "Un día, seis sesiones y muchas ideas nuevas", sub: "El encuentro anual de quienes construyen tecnología, de la IA a la infraestructura cloud. Plazas limitadas: inscríbete ya.",
      stats: [["800", "asistentes"], ["12", "ponentes"], ["6", "sesiones"]], itemsTitle: "Programa", itemsSub: "Jueves, 10 de diciembre de 2026 · IFEMA Madrid", itemCta: "Inscribirme",
      items: [["Conferencia inaugural: la IA en la práctica", "Dra. Sarah Sharif, investigadora en aprendizaje automático"], ["Infraestructura cloud para startups", "Kaveh Noori, arquitecto cloud"], ["Hacer crecer una tienda online", "Nilufar Ahmadi, responsable de producto"], ["Proteger los datos de los usuarios", "Dr. Omid Rahimi, ingeniero de seguridad"], ["Mesa redonda: de la idea al producto", "Tres fundadores cuentan lo que les funcionó"], ["Networking y refrigerio", "Conoce a ponentes y asistentes"]],
      features: [["Certificado", "Para cada asistente"], ["Comida incluida", "Y pausas para el café"], ["Grabaciones", "Un año de acceso tras el evento"]],
      formTitle: "Inscríbete en la cumbre", formSub: "Recibirás tu entrada y los detalles por correo.", submit: "Inscribirme", success: "¡Ya estás inscrito! Tu entrada va camino de tu correo.",
      tickets: ["General — 90 €", "Estudiante — 45 €", "VIP — 250 €"],
      testimonials: [["Sergio Gil", "El año pasado conocí allí a dos compañeros de equipo estupendos."], ["Laura Castro", "Sesiones prácticas, y todo empezó a su hora."], ["Diego Ortiz", "El mejor evento tecnológico de mi año."]],
      nav: ["Programa", "Ventajas", "Inscripción", "Opiniones", "Lugar"],
    },
    business: {
      brand: "Estudio Sol", title: "Estudio Sol | Quiénes somos y contacto", hero: "Sencillo, profesional y a tu lado",
      sub: "Todo lo que tus clientes necesitan en una sola página: servicios, por qué elegirte y cómo contactarte. Déjanos un mensaje y te responderemos.",
      stats: [["10+", "años"], ["300+", "proyectos"], ["24/7", "soporte"]], itemsTitle: "Qué hacemos", itemsSub: "El enfoque adecuado para lo que necesitas", itemCta: "Pedir asesoría",
      items: [["Asesoría gratuita", "Primero escuchamos y luego proponemos el mejor camino"], ["Diseño a medida", "Ajustado a tus objetivos y presupuesto"], ["Entrega rápida", "Paso a paso, con avances periódicos"], ["Acompañamiento", "Seguimos contigo después del lanzamiento"], ["Informes", "Resultados medidos con datos"], ["Contratos claros", "Sin costes ocultos"]],
      features: [["Calidad garantizada", "Hasta que quedes satisfecho"], ["Respuesta rápida", "En menos de una hora laborable"], ["Pago por etapas", "Según avanza el trabajo"]],
      formTitle: "Contáctanos", formSub: "Déjanos un mensaje; respondemos en un día laborable.", submit: "Enviar mensaje", success: "¡Gracias! Te contactaremos pronto.",
      testimonials: [["Sofía Vargas", "Profesionales y precisos: justo lo que necesitábamos."], ["Andrés Molina", "Respuestas rápidas y un precio justo."], ["Valeria Ramos", "Una colaboración de verdad agradable."]],
      nav: ["Servicios", "Por qué nosotros", "Contacto", "Opiniones", "Dirección"],
    },
  },
  cafe: {
    brand: "Café La Esquina", title: "Café La Esquina | Reserva tu mesa", hours: "Todos los días, de 8:00 a 22:00", hero: "Buen café, mañanas sin prisa",
    sub: "Café de especialidad, bollería horneada aquí mismo y un rincón tranquilo para trabajar o quedar. Reserva tu mesa online.", itemsTitle: "En la carta", itemsSub: "Bebida de avena o almendra sin coste extra.",
    items: [["Flat white", "Doble ristretto con leche sedosa"], ["Cruasán de mantequilla", "Horneado aquí cada mañana"], ["Tarta de queso del día", "Pregúntanos por el topping de hoy"], ["Latte con hielo", "Leche fría, espresso y hielo"], ["Sándwich de halloumi", "Halloumi a la plancha, tomate y albahaca"], ["Té con azafrán", "Té negro con un toque de azafrán"]],
    testimonials: [["Daniel Romero", "El mejor flat white del barrio, sin duda."], ["Ana Navarro", "Reservamos para el cumpleaños de mi madre y el servicio fue maravilloso."], ["Pablo Díaz", "Tranquilo por las mañanas, perfecto para trabajar."]],
  },
};

const tr: Pack = {
  locale: "tr-TR", quote: ["“", "”"], money: { pre: "", post: " ₺", rate: 35, step: 10 }, minutes: (n) => n + " dk",
  common: { address: "Bağdat Caddesi No: 124, Kadıköy, İstanbul", phone: "+90 216 123 45 67", hours: "Pazartesi–Cumartesi, 10:00–20:00" },
  ui: {
    mainNav: "Ana menü", mobileNav: "Mobil menü", cart: "Sepet", menu: "Menü", skip: "İçeriğe geç", why: (b) => "Neden " + b + "?", reviews: "Müşterilerimiz ne diyor", rating: "Puan",
    address: "Adres", contactHours: "İletişim ve çalışma saatleri", rights: "Tüm hakları saklıdır.", choose: "Seçin…", cartEmpty: "Sepetiniz boş; ürünlerimizden seçim yapın.",
    phonePattern: PHONE, phonePlaceholder: "+90 532 123 45 67", fill: "Lütfen “%s” alanını doldurun.", phoneBad: "Lütfen geçerli bir telefon numarası girin (ör. +90 532 123 45 67).", cartNone: "Sepetiniz boş.",
    added: "✓ Eklendi", remove: "Kaldır", total: "Toplam: ", saveFail: "Gönderilemedi; lütfen tekrar deneyin.", preview: "Önizleme: %s (Yayınlandıktan sonra veritabanına kaydedilir.)",
    serverError: "Sunucu hatası; lütfen biraz sonra tekrar deneyin.", required: "Lütfen tüm zorunlu alanları doldurun.", phoneServer: "Telefon numarası geçerli değil.", sending: "Gönderiliyor…",
  },
  fields: { name: "Ad soyad", phone: "Telefon numarası", email: "E-posta", service: "Hizmet", date: "Tarih", time: "Saat", note: "Not (isteğe bağlı)", address: "Teslimat adresi", guests: "Kişi sayısı", ticket: "Bilet", message: "Mesajınız" },
  sections: {
    faq: "Sık sorulan sorular", qa: [["Randevumu nasıl değiştirebilirim?", "24 saat öncesine kadar bizi aramanız yeterli."], ["Nasıl ödeme yapabilirim?", "Yerinde kartla ya da online."], ["Otopark var mı?", "Evet, 50 metre ileride halka açık bir otopark var."]],
    gallery: "Çalışmalarımız", sample: "Örnek", map: "Yol tarifi", mapText: "Kapımıza kadar yol tarifi alın.", mapButton: "Haritayı aç",
    newsletter: "Fırsatlardan ilk siz haberdar olun", newsletterSub: "Ayda bir e-posta, spam yok.", subscribed: "Aboneliğiniz alındı ✓", email: "E-posta", subscribe: "Abone ol",
    pricing: "Paketler", plans: [["Temel", "Başlangıç için"], ["Plus", "En çok tercih edilen"], ["Tam", "Her şey dahil"]], choose: "Seç", call: "Hemen arayın",
  },
  kinds: {
    salon: {
      brand: "Gül Kuaför", title: "Gül Kuaför | Online randevu", hero: "Güzel saçlar, size uygun saatte",
      sub: "Randevunuzu bir dakikadan kısa sürede online alın. Deneyimli kuaförler, tertemiz bir salon ve şeffaf fiyatlar.",
      stats: [["12+", "yıllık deneyim"], ["8.500+", "mutlu müşteri"], ["4,9", "ortalama puan"]], itemsTitle: "Hizmetler ve fiyatlar", itemsSub: "Fiyatlara her şey dahil; kasada sürpriz yok.", itemCta: "Randevu al",
      items: [["Kesim ve fön", "Yüz şeklinize göre danışmanlık, modern kesim ve özenli fön"], ["Boya ve röfle", "Ücretsiz alerji testiyle İtalyan boyalar"], ["Keratin bakımı", "Altı aya kadar düz ve parlak saçlar"], ["Özel gün makyajı", "Antialerjik ürünlerle uzun süre kalıcı makyaj"], ["Kalıcı oje", "Steril aletler, dayanıklı sonuç ve sade tırnak süsleme"], ["Kaş tasarımı", "Yüzünüze uygun şekillendirme ve boyama"]],
      features: [["Orijinal ürünler", "Yalnızca güvenilir markalar, son kullanma tarihi belli"], ["Kusursuz hijyen", "Her müşteri için steril ve tek kullanımlık aletler"], ["Tam zamanında", "Online randevuyla beklemek yok"]],
      formTitle: "Randevu alın", formSub: "Hizmeti ve saati seçin; onay için sizi arayalım.", submit: "Randevu al", success: "Randevunuz alındı! Onay için kısa süre içinde sizi arayacağız.",
      testimonials: [["Elif Yılmaz", "Saç rengim tam istediğim gibi oldu, online randevu da saniyeler sürdü."], ["Zeynep Kaya", "Sakin, temiz ve güler yüzlü. Kız kardeşimin düğünü için de burayı seçtik."], ["Ayşe Demir", "Kalıcı ojem harika oldu ve tam saatinde başladılar."]],
      nav: ["Hizmetler", "Neden biz", "Randevu", "Yorumlar", "İletişim"],
    },
    shop: {
      brand: "Nila Giyim", title: "Nila Giyim | Online mağaza", hero: "Her gün giymek isteyeceğiniz parçalar", sub: "Uygun fiyatlı, rahat ve özenle dikilmiş kıyafetler; hızlı kargo ve yedi gün içinde iade.",
      stats: [["2 gün", "kargo"], ["7 gün", "ücretsiz iade"], ["12.000+", "sipariş"]], itemsTitle: "Çok satanlar", itemsSub: "Stoklar sınırlı: sepete ekleyin ve siparişinizi verin.", itemCta: "Sepete ekle",
      items: [["Keten yazlık elbise", "Nefes alan keten, XS–XL beden"], ["Klasik pamuklu tişört", "%100 pamuk, altı renk"], ["Düz paça kot pantolon", "Yumuşak, esnek denim"], ["Yün sonbahar ceketi", "Saten astarlı sıcak yün karışımı"], ["Beyaz deri spor ayakkabı", "Deri saya, yumuşak taban"], ["Desenli pamuklu şal", "Hafif ve yumuşak, dört mevsim"]],
      features: [["Ücretsiz kargo", "3.500 ₺ üzeri siparişlerde"], ["Kolay iade", "Yedi gün içinde, soru sormadan"], ["Güvenli ödeme", "Güvenilir ödeme altyapısı veya kapıda ödeme"]],
      formTitle: "Sipariş verin", formSub: "Teslimat bilgilerini girin; kargodan önce sizi arıyoruz.", submit: "Siparişi tamamla", success: "Siparişiniz alındı! Teslimatı planlamak için sizi arayacağız.",
      testimonials: [["Merve Şahin", "Kumaşı fotoğraflardakinden bile güzel, iki günde elimdeydi."], ["Emre Çelik", "Yanlış beden almıştım, değişim çok kolay oldu."], ["Selin Arslan", "Fiyatlar makul, paketleme çok şık."]],
      nav: ["Ürünler", "Neden Nila", "Sepet", "Yorumlar", "İletişim"],
    },
    restaurant: {
      brand: "Sofreh Mutfak", title: "Sofreh Mutfak | Masa ayırtın", hours: "Her gün 12:00–23:00", hero: "Ev usulü İran mutfağı, her gün taze",
      sub: "Geleneksel tarifler, her sabah taze alınan malzemeler ve aile sofraları için sıcak bir salon. Masanızı online ayırtın.",
      stats: [["25+", "yemek"], ["18 yıl", "bu şehirde"], ["4,8", "misafir puanı"]], itemsTitle: "Bugünün menüsü", itemsSub: "Tüm yemekler birinci sınıf basmati pirinciyle servis edilir.", itemCta: "Masa ayırt",
      items: [["Koobideh kebap", "Safranlı pilav ve közlenmiş domatesle iki şiş"], ["Safranlı tavuk şiş", "Safran ve limonla marine edilmiş tavuk göğsü"], ["Ghormeh sabzi", "Ağır ateşte otlar, barbunya ve dana eti"], ["Zereshk polo", "Kadıntuzluğu meyveli pilav, tavuk ve fıstık"], ["Mirza ghasemi", "Gilan usulü közlenmiş patlıcan mezesi"], ["Faloodeh", "Taze limonlu gül suyu şerbeti"]],
      features: [["Her gün taze", "Sabah pazarından malzemeler"], ["Deneyimli şef", "Aileden gelen tarifler"], ["Otopark", "Misafirlerimize ücretsiz"]],
      formTitle: "Masa ayırtın", formSub: "Kişi sayısını ve saati seçin.", submit: "Rezervasyon yap", success: "Masanız ayrıldı. Sizi bekliyoruz!",
      testimonials: [["Burak Aydın", "Tahran dışında yediğim en iyi koobideh."], ["Esra Koç", "Annemin doğum günü için rezervasyon yaptık; hizmet harikaydı."], ["Can Öztürk", "Ghormeh sabzi tam ev yemeği tadında."]],
      nav: ["Menü", "Neden biz", "Rezervasyon", "Yorumlar", "İletişim"],
    },
    event: {
      brand: "İstanbul Teknoloji Zirvesi", title: "İstanbul Teknoloji Zirvesi 2026 | Kayıt", hours: "10 Aralık 2026 Perşembe, 09:00–17:00", address: "Haliç Kongre Merkezi, Sütlüce, Beyoğlu, İstanbul",
      hero: "Bir gün, altı oturum, bir sürü yeni fikir", sub: "Yapay zekâdan bulut altyapısına, üretenlerin yıllık buluşması. Kontenjan sınırlı; hemen kaydolun.",
      stats: [["800", "katılımcı"], ["12", "konuşmacı"], ["6", "oturum"]], itemsTitle: "Program", itemsSub: "10 Aralık 2026 Perşembe · Haliç Kongre Merkezi", itemCta: "Kaydol",
      items: [["Açılış konuşması: Uygulamada yapay zekâ", "Dr. Sarah Sharif, makine öğrenmesi araştırmacısı"], ["Girişimler için bulut altyapısı", "Kaveh Noori, bulut mimarı"], ["Online mağazayı büyütmek", "Nilufar Ahmadi, ürün yöneticisi"], ["Kullanıcı verilerini korumak", "Dr. Omid Rahimi, güvenlik mühendisi"], ["Panel: Fikirden ürüne", "Üç kurucu neyin işe yaradığını anlatıyor"], ["Tanışma ve ikram", "Konuşmacılar ve katılımcılarla tanışın"]],
      features: [["Katılım belgesi", "Tüm katılımcılara"], ["Öğle yemeği dahil", "Kahve molalarıyla birlikte"], ["Kayıtlar", "Etkinlikten sonra bir yıl erişim"]],
      formTitle: "Zirveye kaydolun", formSub: "Biletiniz ve tüm ayrıntılar e-postayla gelir.", submit: "Kaydol", success: "Kaydınız tamam! Biletiniz e-posta kutunuza geliyor.",
      tickets: ["Standart — 3.150 ₺", "Öğrenci — 1.575 ₺", "VIP — 8.750 ₺"],
      testimonials: [["Mert Kurt", "Geçen yıl orada iki harika takım arkadaşı buldum."], ["Deniz Polat", "Uygulamaya dönük oturumlar, her şey tam zamanında."], ["Kerem Doğan", "Yılın en iyi teknoloji etkinliği."]],
      nav: ["Program", "Avantajlar", "Kayıt", "Yorumlar", "Mekân"],
    },
    business: {
      brand: "Atölye Mavi", title: "Atölye Mavi | Hakkımızda ve iletişim", hero: "Sade, profesyonel ve yanınızda",
      sub: "Müşterilerinizin bilmesi gereken her şey tek sayfada: hizmetler, neden siz ve size nasıl ulaşılır. Mesaj bırakın, size dönelim.",
      stats: [["10+", "yıl"], ["300+", "proje"], ["7/24", "destek"]], itemsTitle: "Neler yapıyoruz", itemsSub: "İhtiyacınıza uygun yaklaşım", itemCta: "Danışmanlık iste",
      items: [["Ücretsiz danışmanlık", "Önce dinliyor, sonra en iyi yolu öneriyoruz"], ["Size özel tasarım", "Hedeflerinize ve bütçenize göre"], ["Hızlı teslim", "Adım adım, düzenli bilgilendirmeyle"], ["Destek", "Yayından sonra da yanınızdayız"], ["Raporlama", "Sonuçlar rakamlarla"], ["Şeffaf sözleşme", "Gizli maliyet yok"]],
      features: [["Kalite garantisi", "Memnun kalana kadar"], ["Hızlı yanıt", "Bir iş saati içinde"], ["Aşamalı ödeme", "İşin ilerleyişine göre"]],
      formTitle: "Bize ulaşın", formSub: "Mesajınızı bırakın; bir iş günü içinde yanıtlıyoruz.", submit: "Mesaj gönder", success: "Teşekkürler! En kısa sürede size döneceğiz.",
      testimonials: [["Ece Yıldız", "Profesyonel ve titiz; tam ihtiyacımız olan buydu."], ["Onur Aksoy", "Hızlı yanıtlar ve makul bir fiyat."], ["Gizem Erdem", "Gerçekten keyifli bir iş birliğiydi."]],
      nav: ["Hizmetler", "Neden biz", "İletişim", "Yorumlar", "Adres"],
    },
  },
  cafe: {
    brand: "Köşe Kahve", title: "Köşe Kahve | Masa ayırtın", hours: "Her gün 08:00–22:00", hero: "İyi kahve, acelesiz sabahlar",
    sub: "Nitelikli kahve, burada pişen hamur işleri ve çalışmak ya da buluşmak için sakin bir köşe. Masanızı online ayırtın.", itemsTitle: "Menüde", itemsSub: "Yulaf ve badem sütü ek ücretsiz.",
    items: [["Flat white", "Kadifemsi sütle çift ristretto"], ["Tereyağlı kruvasan", "Her sabah burada pişiyor"], ["Günün cheesecake’i", "Bugünün sosunu bize sorun"], ["Buzlu latte", "Soğuk süt, espresso ve buz"], ["Hellimli sandviç", "Izgara hellim, domates ve fesleğen"], ["Safranlı çay", "Bir tutam safranla siyah çay"]],
    testimonials: [["Burak Aydın", "Mahallenin en iyi flat white’ı, tartışmasız."], ["Esra Koç", "Annemin doğum günü için rezervasyon yaptık; hizmet harikaydı."], ["Can Öztürk", "Sabahları sakin, çalışmak için ideal."]],
  },
};

const ar: Pack = {
  locale: "ar-u-nu-latn", quote: ["«", "»"], money: { pre: "", post: " دولار", rate: 1, step: 1 }, minutes: (n) => n + " دقيقة",
  common: { address: "شارع الشيخ زايد، برج الريم، دبي", phone: "+971 4 123 4567", hours: "من السبت إلى الخميس، 10 صباحًا حتى 8 مساءً" },
  ui: {
    mainNav: "القائمة الرئيسية", mobileNav: "قائمة الجوال", cart: "سلة التسوق", menu: "القائمة", skip: "انتقل إلى المحتوى", why: (b) => "لماذا " + b + "؟", reviews: "ماذا يقول عملاؤنا", rating: "التقييم",
    address: "العنوان", contactHours: "التواصل وساعات العمل", rights: "جميع الحقوق محفوظة.", choose: "اختر…", cartEmpty: "سلة التسوق فارغة؛ اختر من منتجاتنا.",
    phonePattern: PHONE, phonePlaceholder: "+971 50 123 4567", fill: "يرجى تعبئة «%s».", phoneBad: "يرجى إدخال رقم هاتف صحيح (مثل 4567 123 50 971+).", cartNone: "سلة التسوق فارغة.",
    added: "✓ تمت الإضافة", remove: "إزالة", total: "المجموع: ", saveFail: "تعذّر الإرسال؛ يرجى المحاولة مرة أخرى.", preview: "معاينة: %s (بعد النشر تُحفظ البيانات في قاعدة البيانات.)",
    serverError: "خطأ في الخادم؛ حاول مرة أخرى بعد قليل.", required: "يرجى تعبئة جميع الحقول المطلوبة.", phoneServer: "رقم الهاتف غير صحيح.", sending: "جارٍ الإرسال…",
  },
  fields: { name: "الاسم الكامل", phone: "رقم الجوال", email: "البريد الإلكتروني", service: "الخدمة", date: "التاريخ", time: "الوقت", note: "ملاحظات (اختياري)", address: "عنوان التوصيل", guests: "عدد الأشخاص", ticket: "التذكرة", message: "رسالتك" },
  sections: {
    faq: "الأسئلة الشائعة", qa: [["كيف أغيّر موعدي؟", "اتصل بنا قبل الموعد بـ24 ساعة على الأقل."], ["كيف يمكنني الدفع؟", "بالبطاقة في المكان أو أونلاين."], ["هل يوجد موقف سيارات؟", "نعم، يوجد موقف عام على بعد 50 مترًا."]],
    gallery: "أعمالنا", sample: "نموذج", map: "كيف تصل إلينا", mapText: "احصل على الاتجاهات حتى بابنا.", mapButton: "افتح الخريطة",
    newsletter: "كن أول من يعرف بالعروض", newsletterSub: "رسالة واحدة شهريًا، بلا إزعاج.", subscribed: "تم اشتراكك ✓", email: "البريد الإلكتروني", subscribe: "اشترك",
    pricing: "الباقات", plans: [["الأساسية", "بداية مناسبة"], ["بلس", "الأكثر طلبًا"], ["الكاملة", "كل شيء مشمول"]], choose: "اختر", call: "اتصل بنا",
  },
  kinds: {
    salon: {
      brand: "صالون الوردة", title: "صالون الوردة | احجزي موعدك أونلاين", hero: "شعر جميل، في الوقت الذي يناسبك",
      sub: "احجزي موعدك أونلاين في أقل من دقيقة. مصففات خبيرات، وصالون نظيف تمامًا، وأسعار واضحة.",
      stats: [["12+", "سنة خبرة"], ["8,500+", "عميلة سعيدة"], ["4.9", "متوسط التقييم"]], itemsTitle: "الخدمات والأسعار", itemsSub: "الأسعار نهائية، بلا مفاجآت عند الدفع.", itemCta: "احجزي الآن",
      items: [["قص وتصفيف", "استشارة حسب شكل الوجه، وقصة عصرية، وتصفيف أنيق"], ["صبغة وهايلايت", "صبغات إيطالية مع اختبار حساسية مجاني"], ["علاج الكيراتين", "شعر ناعم ولامع حتى ستة أشهر"], ["مكياج المناسبات", "مكياج يدوم طويلًا بمنتجات مضادة للحساسية"], ["مناكير جل", "أدوات معقمة، ولمسة نهائية تدوم، ورسم أظافر بسيط"], ["تشكيل الحواجب", "تشكيل وصبغ يناسبان ملامح وجهك"]],
      features: [["منتجات أصلية", "علامات موثوقة فقط بتواريخ صلاحية واضحة"], ["نظافة تامة", "أدوات معقمة وللاستخدام مرة واحدة لكل عميلة"], ["في الموعد", "مع الحجز الأونلاين، بلا انتظار"]],
      formTitle: "احجزي موعدك", formSub: "اختاري الخدمة والوقت، وسنتصل بك للتأكيد.", submit: "احجزي الآن", success: "تم حجز موعدك! سنتصل بك قريبًا للتأكيد.",
      testimonials: [["مريم الحسن", "جاء اللون تمامًا كما أردت، والحجز أونلاين استغرق ثواني."], ["سارة العلي", "مكان هادئ ونظيف وطاقم لطيف. اخترناه أيضًا لزفاف أختي."], ["نور خالد", "أظافر جل رائعة، وبدأوا في الموعد تمامًا."]],
      nav: ["الخدمات", "لماذا نحن", "الحجز", "الآراء", "تواصل معنا"],
    },
    shop: {
      brand: "أزياء نيلا", title: "أزياء نيلا | متجر إلكتروني", hero: "أناقة يومية تشعر بجودتها", sub: "ملابس مريحة ومتقنة الصنع بأسعار عادلة، مع شحن سريع وإرجاع خلال سبعة أيام.",
      stats: [["يومان", "للتوصيل"], ["7 أيام", "إرجاع مجاني"], ["12,000+", "طلب"]], itemsTitle: "الأكثر مبيعًا", itemsSub: "الكمية محدودة: أضف إلى السلة وأتمم طلبك.", itemCta: "أضف إلى السلة",
      items: [["فستان صيفي من الكتان", "كتان يسمح بمرور الهواء، مقاسات XS إلى XL"], ["تيشيرت قطني كلاسيكي", "قطن 100% بستة ألوان"], ["جينز بقصة مستقيمة", "دنيم مرن وناعم"], ["جاكيت صوف للخريف", "مزيج صوف دافئ مع بطانة ساتان"], ["حذاء رياضي جلد أبيض", "جزء علوي من الجلد ونعل مريح"], ["وشاح قطني مطبوع", "خفيف وناعم لكل الفصول"]],
      features: [["شحن مجاني", "للطلبات فوق 100 دولار"], ["إرجاع سهل", "خلال سبعة أيام بلا أسئلة"], ["دفع آمن", "بوابة دفع موثوقة أو الدفع عند الاستلام"]],
      formTitle: "أتمم طلبك", formSub: "أدخل بيانات التوصيل، وسنتصل بك قبل الشحن.", submit: "تأكيد الطلب", success: "تم استلام طلبك! سنتصل بك لترتيب التوصيل.",
      testimonials: [["ليلى أحمد", "القماش أجمل من الصور، ووصل الطلب خلال يومين."], ["عمر يوسف", "طلبت مقاسًا خاطئًا وكان الاستبدال سهلًا جدًا."], ["هدى سالم", "أسعار عادلة وتغليف أنيق."]],
      nav: ["المنتجات", "لماذا نيلا", "السلة", "الآراء", "تواصل معنا"],
    },
    restaurant: {
      brand: "مطبخ سفره", title: "مطبخ سفره | احجز طاولتك", hours: "يوميًا من 12 ظهرًا حتى 11 مساءً", hero: "مطبخ فارسي منزلي، طازج كل يوم",
      sub: "وصفات تقليدية، ومكونات نشتريها طازجة كل صباح، وأجواء دافئة لعشاء العائلة. احجز طاولتك أونلاين.",
      stats: [["25+", "طبقًا"], ["18 عامًا", "في المدينة"], ["4.8", "تقييم الضيوف"]], itemsTitle: "قائمة اليوم", itemsSub: "تُقدَّم جميع الأطباق مع أرز بسمتي فاخر.", itemCta: "احجز طاولة",
      items: [["كباب كوبيده", "سيخان مع أرز بالزعفران وطماطم مشوية"], ["شيش طاووق بالزعفران", "صدر دجاج متبل بالزعفران والليمون"], ["قورمه سبزي", "أعشاب مطهوة ببطء مع الفاصوليا الحمراء ولحم البقر"], ["زرشك بولو", "دجاج مع أرز بالزرشك والفستق"], ["ميرزا قاسمي", "مقبلات باذنجان مدخن على طريقة جيلان"], ["فالوده", "شربات بماء الورد مع ليمون طازج"]],
      features: [["طازج يوميًا", "مكونات من سوق الصباح"], ["طاهٍ خبير", "وصفات متوارثة في البيت"], ["مواقف سيارات", "مجانية لضيوفنا"]],
      formTitle: "احجز طاولتك", formSub: "اختر عدد الأشخاص والوقت.", submit: "احجز", success: "تم حجز طاولتك. بانتظارك!",
      testimonials: [["خالد منصور", "أفضل كباب كوبيده تذوقته خارج طهران."], ["رنا حداد", "حجزنا لعيد ميلاد والدتي وكانت الخدمة رائعة."], ["يوسف عيسى", "قورمه سبزي بطعم أكل البيت تمامًا."]],
      nav: ["القائمة", "لماذا نحن", "الحجز", "الآراء", "تواصل معنا"],
    },
    event: {
      brand: "قمة دبي للتقنية", title: "قمة دبي للتقنية 2026 | التسجيل", hours: "الخميس 10 ديسمبر 2026، من 9 صباحًا حتى 5 مساءً", address: "مركز دبي التجاري العالمي، القاعة 7، دبي",
      hero: "يوم واحد، ست جلسات، وأفكار جديدة كثيرة", sub: "الملتقى السنوي لصنّاع التقنية، من الذكاء الاصطناعي إلى البنية السحابية. المقاعد محدودة، سجّل الآن.",
      stats: [["800", "مشارك"], ["12", "متحدثًا"], ["6", "جلسات"]], itemsTitle: "البرنامج", itemsSub: "الخميس 10 ديسمبر 2026 · مركز دبي التجاري العالمي", itemCta: "سجّل",
      items: [["الكلمة الافتتاحية: الذكاء الاصطناعي في التطبيق", "د. سارة شريف، باحثة في تعلم الآلة"], ["البنية السحابية للشركات الناشئة", "كاوه نوري، مهندس حلول سحابية"], ["تنمية المتجر الإلكتروني", "نيلوفر أحمدي، مديرة منتج"], ["حماية بيانات المستخدمين", "د. أميد رحيمي، مهندس أمن معلومات"], ["حلقة نقاش: من الفكرة إلى المنتج", "ثلاثة مؤسسين يتحدثون عما نجح معهم"], ["تعارف وضيافة", "تعرّف على المتحدثين والمشاركين"]],
      features: [["شهادة حضور", "لكل المشاركين"], ["الغداء مشمول", "مع استراحات القهوة"], ["تسجيلات الجلسات", "وصول لمدة عام بعد الفعالية"]],
      formTitle: "سجّل في القمة", formSub: "تصلك التذكرة والتفاصيل عبر البريد الإلكتروني.", submit: "سجّل الآن", success: "تم تسجيلك! تذكرتك في طريقها إلى بريدك.",
      tickets: ["عادية — 90 دولارًا", "طلاب — 45 دولارًا", "كبار الشخصيات — 250 دولارًا"],
      testimonials: [["فيصل العتيبي", "تعرّفت هناك العام الماضي على زميلين رائعين لفريقي."], ["دانة الكعبي", "جلسات عملية وكل شيء في موعده."], ["طارق الزعبي", "أفضل فعالية تقنية حضرتها هذا العام."]],
      nav: ["البرنامج", "المزايا", "التسجيل", "الآراء", "المكان"],
    },
    business: {
      brand: "استوديو النخبة", title: "استوديو النخبة | من نحن وتواصل معنا", hero: "بسيط، احترافي، وإلى جانبك",
      sub: "كل ما يحتاج عملاؤك إلى معرفته في صفحة واحدة: الخدمات، ولماذا أنت، وكيف يصلون إليك. اترك رسالة وسنعاود الاتصال بك.",
      stats: [["10+", "سنوات"], ["300+", "مشروع"], ["24/7", "دعم"]], itemsTitle: "ماذا نقدّم", itemsSub: "النهج المناسب لاحتياجاتك", itemCta: "اطلب استشارة",
      items: [["استشارة مجانية", "نستمع أولًا ثم نقترح أفضل طريق"], ["تصميم مخصص", "يناسب أهدافك وميزانيتك"], ["تنفيذ سريع", "خطوة بخطوة مع تحديثات منتظمة"], ["دعم مستمر", "نبقى معك بعد الإطلاق"], ["تقارير", "نتائج مقاسة بالأرقام"], ["عقود واضحة", "بلا تكاليف خفية"]],
      features: [["ضمان الجودة", "حتى رضاك التام"], ["رد سريع", "خلال ساعة عمل واحدة"], ["دفع على مراحل", "حسب تقدم العمل"]],
      formTitle: "تواصل معنا", formSub: "اترك رسالتك، ونرد خلال يوم عمل واحد.", submit: "أرسل الرسالة", success: "شكرًا لك! سنتواصل معك قريبًا.",
      testimonials: [["لينا عبدالله", "احترافية ودقة؛ هذا بالضبط ما كنا نحتاجه."], ["سامي حداد", "ردود سريعة وسعر عادل."], ["جود مراد", "تجربة تعاون رائعة حقًا."]],
      nav: ["الخدمات", "لماذا نحن", "تواصل", "الآراء", "العنوان"],
    },
  },
  cafe: {
    brand: "مقهى الزاوية", title: "مقهى الزاوية | احجز طاولتك", hours: "يوميًا من 8 صباحًا حتى 10 مساءً", hero: "قهوة طيبة وصباحات هادئة",
    sub: "قهوة مختصة، ومخبوزات نخبزها هنا، وركن هادئ للعمل أو اللقاء. احجز طاولتك أونلاين.", itemsTitle: "من القائمة", itemsSub: "حليب الشوفان أو اللوز دون تكلفة إضافية.",
    items: [["فلات وايت", "ريستريتو مزدوج مع حليب ناعم"], ["كرواسون بالزبدة", "نخبزه هنا كل صباح"], ["تشيز كيك اليوم", "اسألنا عن إضافة اليوم"], ["لاتيه مثلج", "حليب بارد وإسبريسو وثلج"], ["ساندويتش حلوم", "حلوم مشوي مع طماطم وريحان"], ["شاي بالزعفران", "شاي أسود بلمسة من الزعفران"]],
    testimonials: [["خالد منصور", "أفضل فلات وايت في الحي بلا منازع."], ["رنا حداد", "حجزنا لعيد ميلاد والدتي وكانت الخدمة رائعة."], ["يوسف عيسى", "هادئ في الصباح ومثالي للعمل."]],
  },
};

export const PACKS: Record<IntlCopy, Pack> = { de, ar, tr, fr, es };

/** the English sections (Persian ones are written inline in ./sim.ts) */
export const EN_SECTIONS: SectionCopy = {
  faq: "Frequently asked questions", qa: [["How do I change my time?", "Just call us up to 24 hours before."], ["How can I pay?", "By card on site or online."], ["Is there parking?", "Yes, a public car park is 50 meters away."]],
  gallery: "Our work", sample: "Sample", map: "Find us", mapText: "Get directions straight to our door.", mapButton: "Open the map",
  newsletter: "Hear about offers first", newsletterSub: "One email a month, no spam.", subscribed: "You are subscribed ✓", email: "Email", subscribe: "Subscribe",
  pricing: "Packages", plans: [["Basic", "A good start"], ["Plus", "Most popular"], ["Complete", "Everything included"]], choose: "Choose", call: "Call us",
};
export const FA_SECTIONS: SectionCopy = {
  faq: "سؤالات متداول", qa: [["چطور زمان را تغییر دهم؟", "کافی است تا ۲۴ ساعت قبل با شماره ما تماس بگیرید."], ["پرداخت چگونه است؟", "پرداخت در محل با کارت یا به‌صورت آنلاین."], ["پارکینگ دارید؟", "بله، پارکینگ عمومی در ۵۰ متری ما قرار دارد."]],
  gallery: "نمونه‌کارها", sample: "نمونه‌کار", map: "مسیریابی", mapText: "با نشان و بلد مستقیم به ما برسید.", mapButton: "مسیریابی با نشان",
  newsletter: "از تخفیف‌ها باخبر شوید", newsletterSub: "ماهی یک ایمیل، بدون مزاحمت.", subscribed: "عضویت شما ثبت شد ✓", email: "ایمیل", subscribe: "عضویت",
  pricing: "بسته‌ها", plans: [["پایه", "مناسب شروع"], ["ویژه", "پرطرفدارترین"], ["کامل", "همه خدمات"]], choose: "انتخاب", call: "تماس فوری",
};
