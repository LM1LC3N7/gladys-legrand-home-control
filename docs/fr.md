# Legrand Home + Control

Pilotez depuis Gladys les modules **Céliane with Netatmo** et **dooxie with
Netatmo** de votre passerelle Legrand **Home + Control** : éclairages et
variateurs, prises, contacteurs, volets roulants et compteurs d'énergie.
L'intégration passe par le cloud Netatmo (le service derrière l'application
Home + Control) avec l'API officielle Netatmo Connect, en votre nom.
Intégration non officielle, sans lien avec Legrand ni Netatmo.

> **Version de développement (0.1).** Développée d'après la documentation
> Netatmo et des réponses enregistrées, pas encore testée sur une vraie
> installation. Vos retours sont les bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

| Module                                                             | Dans Gladys                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| Prise, prise mobile, sortie de câble (NLP, NLPM, NLC)              | un interrupteur : marche/arrêt et puissance (W)      |
| Télérupteur, contacteur, contact sec (NLPT, NLPO, NLPD)            | un interrupteur (une lampe s'il commande une lampe)  |
| Interrupteur, micromodule, double interrupteur (NLL, NLM, NLIS)    | une lampe : marche/arrêt et puissance (une par voie) |
| Variateur (NLF, NLFN, NLFE)                                        | une lampe : marche/arrêt, luminosité et puissance    |
| Interrupteur de volet (NLV, NLLV), volet Zigbee (Z3V)              | un volet : ouvrir, fermer, stop (et position)        |
| Compteur modulaire, délesteur, compteur triphasé (NLPC, NLPS, NLY) | puissance consommée (par phase pour le NLY)          |
| Commande sans fil (NLT, NLD)                                       | niveau de batterie                                   |

La position d'un volet est proposée pour les modules qui acceptent toutes les
positions (NLLV) ; les autres s'ouvrent, se ferment et s'arrêtent. Le badge de
chaque appareil indique si le module répond.

Pas encore : les sorties de câble en mode fil pilote (radiateurs : leur
puissance seulement), la VMC (NLLF), la porte de garage (NLJ), les lignes de
l'écocompteur (NLE), les appuis sur les commandes sans fil, l'historique
d'énergie. Ils sont prévus.

## Installation

Il vous faut une **application Netatmo** à vous (gratuite, cinq minutes) :
elle donne à l'intégration le droit d'utiliser l'API avec votre compte.

1. Allez sur [dev.netatmo.com](https://dev.netatmo.com/apps/createanapp) et
   connectez-vous avec le compte de l'application **Home + Control**.
2. **Créez une application** : nom et description libres (ex. « Gladys »),
   votre nom et votre e-mail comme contact protection des données.
3. Dans la configuration de l'intégration dans Gladys, copiez l'**URI de
   redirection** que Gladys affiche pour le bouton **Connecter**, et collez-la
   dans le champ **Redirect URI** de l'application Netatmo. Enregistrez
   l'application.
4. Copiez le **client ID** et le **client secret** de l'application dans la
   configuration Gladys, et **enregistrez**.
5. Cliquez sur **Connecter** : Netatmo vous demande de vous identifier et
   d'accepter les droits Home + Control (`read_magellan`, `write_magellan`).
   Vous revenez dans Gladys, connecté.
6. Ouvrez l'onglet **Découverte** : vos modules y sont, ajoutez ceux que vous
   voulez.

**Tester la connexion** indique combien de logements et d'appareils ont été
trouvés.

## Options

| Option                         | Défaut | Rôle                                                               |
| ------------------------------ | ------ | ------------------------------------------------------------------ |
| Intervalle de rafraîchissement | 60 s   | fréquence de lecture des états (une minute minimum, une heure max) |

Une commande part tout de suite et l'état est relu quelques secondes après.
Netatmo limite les requêtes (500 par heure et par utilisateur) : l'intégration
les espace, envoie ensemble les commandes d'un même instant et fait une pause
quand Netatmo le demande. Avec plusieurs logements ou beaucoup de commandes,
un intervalle plus long est plus sûr.

## Dépannage

- **« Netatmo a refusé l'autorisation »** : l'autorisation a expiré ou a été
  révoquée (depuis le compte Netatmo), ou le client secret est erroné.
  Vérifiez le client ID et le client secret, enregistrez, puis cliquez à
  nouveau sur **Connecter**.
- **La page de connexion affiche une erreur** : l'URI de redirection de
  l'application Netatmo n'est pas exactement celle que Gladys affiche
  (recopiez-la, sans espace).
- **« Lecture seule »** : les droits Home + Control n'ont pas tous été
  acceptés : cliquez à nouveau sur **Connecter** et acceptez-les.
- **« Limite d'usage atteinte »** : Netatmo a demandé de ralentir ;
  l'intégration réessaie seule. Augmentez l'intervalle si cela se répète.
- **Un module manque** : les logs listent les modules que l'intégration ne sait
  pas encore afficher ; **Tester la connexion** les compte.
- **Un appareil est « injoignable »** : le module ou la passerelle ne répond
  plus à Netatmo (coupure de courant, Wi-Fi de la passerelle).

## Confidentialité

L'intégration ne parle qu'à `api.netatmo.com`, avec votre propre application
Netatmo. Le client secret et les jetons sont conservés par Gladys et
n'apparaissent jamais dans les logs. Rien ne passe par Gladys Plus.
