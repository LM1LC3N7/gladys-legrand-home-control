// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const T = {
  notConfigured: {
    en: 'Create an app on dev.netatmo.com, type its client ID and client secret here and save, then click Connect.',
    fr: 'Créez une application sur dev.netatmo.com, saisissez ici son client ID et son client secret et enregistrez, puis cliquez sur Connecter.',
  },
  notConnected: {
    en: 'Click Connect to link your Legrand Home + Control (Netatmo) account.',
    fr: 'Cliquez sur Connecter pour lier votre compte Legrand Home + Control (Netatmo).',
  },
  connecting: {
    en: 'Account linked: reading your homes…',
    fr: 'Compte lié : lecture de vos logements…',
  },
  connected: (homes, devices) => ({
    en: `Connected to Netatmo: ${plural(homes, 'home', 'homes')}, ${plural(devices, 'device', 'devices')}. Open Discovery to add them.`,
    fr: `Connecté à Netatmo : ${plural(homes, 'logement', 'logements')}, ${plural(devices, 'appareil', 'appareils')}. Ouvrez Découverte pour les ajouter.`,
  }),
  noModule: {
    en: 'Connected to Netatmo, but this account has no Legrand Home + Control or Bubendorff iDiamant gateway.',
    fr: "Connecté à Netatmo, mais ce compte n'a aucune passerelle Legrand Home + Control ni Bubendorff iDiamant.",
  },
  readOnly: {
    en: ' Read only: the authorization lacks write_magellan, click Connect again to control the devices.',
    fr: " Lecture seule : l'autorisation n'inclut pas write_magellan, cliquez à nouveau sur Connecter pour piloter les appareils.",
  },
  addBubendorff: {
    en: ' Bubendorff shutters found, but the authorization lacks write_bubendorff: click Connect again to add Bubendorff.',
    fr: " Volets Bubendorff trouvés, mais l'autorisation n'inclut pas write_bubendorff : reconnectez-vous (Connecter) pour ajouter Bubendorff.",
  },
  reconnect: {
    en: 'Netatmo refused the authorization (expired, revoked, or wrong client secret): check the app credentials, then click Connect again.',
    fr: "Netatmo a refusé l'autorisation (expirée, révoquée, ou client secret erroné) : vérifiez les identifiants de l'application, puis cliquez à nouveau sur Connecter.",
  },
  missingScope: {
    en: 'The authorization lacks the Home + Control rights (read_magellan, write_magellan): click Connect again and accept them.',
    fr: "L'autorisation n'inclut pas les droits Home + Control (read_magellan, write_magellan) : cliquez à nouveau sur Connecter et acceptez-les.",
  },
  appDeactivated: {
    en: 'Your Netatmo app is deactivated: reactivate it on dev.netatmo.com, or create a new one.',
    fr: 'Votre application Netatmo est désactivée : réactivez-la sur dev.netatmo.com, ou créez-en une nouvelle.',
  },
  throttled: (minutes) => ({
    en: `Netatmo usage limit reached: next try in ${plural(minutes, 'minute', 'minutes')}. A longer refresh interval avoids it.`,
    fr: `Limite d'usage Netatmo atteinte : nouvel essai dans ${plural(minutes, 'minute', 'minutes')}. Un intervalle de rafraîchissement plus long l'évite.`,
  }),
  unreachable: (reason) => ({
    en: `Reading Netatmo failed: ${reason}. Retrying at the next refresh.`,
    fr: `La lecture chez Netatmo a échoué : ${reason}. Nouvel essai au prochain rafraîchissement.`,
  }),
  authFailed: (reason) => ({
    en: `Linking the account failed: ${reason}. Check the client ID, the client secret and the redirect URI of your Netatmo app, then click Connect again.`,
    fr: `La liaison du compte a échoué : ${reason}. Vérifiez le client ID, le client secret et l'URI de redirection de votre application Netatmo, puis cliquez à nouveau sur Connecter.`,
  }),
  test: {
    ok: (homes, devices, skipped) => ({
      en: `Connection OK: ${plural(homes, 'home', 'homes')} with Legrand Home + Control, ${plural(devices, 'device', 'devices')} for Gladys${skipped > 0 ? `, ${plural(skipped, 'module', 'modules')} not supported yet` : ''}.`,
      fr: `Connexion OK : ${plural(homes, 'logement', 'logements')} avec Legrand Home + Control, ${plural(devices, 'appareil', 'appareils')} pour Gladys${skipped > 0 ? `, ${plural(skipped, 'module non encore pris', 'modules non encore pris')} en charge` : ''}.`,
    }),
    failed: (reason) => ({
      en: `Connection failed: ${reason}.`,
      fr: `Échec de la connexion : ${reason}.`,
    }),
  },
};

/** Appends a text to a message, in every language. */
export const join = (a, b) => ({ en: a.en + b.en, fr: a.fr + b.fr });
