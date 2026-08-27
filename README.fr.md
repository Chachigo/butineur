# Butineur

Gamifier ses tâches pour se constituer un **budget loisirs**.

L'idée : chaque tâche accomplie rapporte une somme que tu as définie toi-même.
Ce n'est pas de l'argent réel — c'est une enveloppe de dépense que tu t'autorises
ensuite pour tes loisirs. Faire le ménage finance une soirée ciné.

*[Read in English](README.md)*

<p align="center">
  <img src="docs/demo/01-taches.png" width="240" alt="Liste des tâches">
  <img src="docs/demo/04-editeur-serie.png" width="240" alt="Éditeur : simulation du bonus de série">
  <img src="docs/demo/07-stats.png" width="240" alt="Statistiques et graphe de régularité">
</p>

<p align="center">
  <img src="docs/demo/02-fiche.png" width="240" alt="Fiche d'une tâche">
  <img src="docs/demo/05-boutique.png" width="240" alt="Boutique">
  <img src="docs/demo/06-historique.png" width="240" alt="Historique">
</p>

<p align="center"><em>Captures prises sur des données de démo — <code>npm run screenshots</code>.</em></p>

## Ce que ça fait

- **Récompenses libres** — tu fixes le montant de chaque tâche.
- **Tâches répétitives** — une fois tous les X jours.
- **Tâches à compteur** — « boire 8 verres d'eau par jour », avec paliers de récompense.
- **Dates limites** — pénalité au choix : aucune, montant fixe, pourcentage, ou
  dégressive par jour de retard. Une tâche en retard rapporte moins, jamais rien de négatif.
- **Bonus de série** — paliers (« 7 jours d'affilée = +20 ») et multiplicateur plafonné,
  cumulables. L'éditeur simule le résultat avant que tu valides.
- **Boutique** — tes loisirs avec leur prix, achetables en un tap, plus un montant libre.
- **Widgets d'écran d'accueil** — le solde, un compteur paramétrable, et la liste des
  tâches validables sans ouvrir l'appli.
- **Petites animations** à chaque gain et à chaque dépense, coupées si le système
  demande des animations réduites.
- **Français et anglais**, selon le téléphone ou forcé dans les réglages.

## Comment c'est fait

Un seul codebase web (React + Vite) qui sert à la fois d'appli Android — via
Capacitor — et de site consultable au navigateur. Le seul code natif est celui
des widgets, en Kotlin, parce qu'Android ne sait pas afficher du web sur l'écran
d'accueil.

**Le solde n'est jamais stocké.** Il est recalculé en rejouant un journal
d'événements append-only (`src/engine.ts`). Deux conséquences :

- deux appareils qui ont les mêmes événements affichent forcément le même solde,
  sans une ligne de résolution de conflit ;
- un widget est simplement un troisième appareil qui ne sait qu'ajouter des faits.
  Taper « +1 » appli fermée empile un fait, que l'appli verse au journal à sa
  prochaine ouverture — avec l'horodatage du tap, donc sans pénalité de retard
  injustifiée.

Aucun service en arrière-plan : les widgets lisent le fichier `SharedPreferences`
que `@capacitor/preferences` écrit déjà.

## Développement

```bash
npm install
npm run dev          # navigateur
npm run test         # le moteur de récompenses (chemin argent)
npm run android      # build + installe sur le téléphone branché
npm run android:apk  # APK seul, sans appareil
npm run screenshots  # captures du README, sur des données de démo
```

`npm run screenshots` a besoin du serveur de dev (`npm run dev`) et de
`chromium-browser`. Il écrit un jeu de tâches fictives dans une session
jetable — jamais tes vraies données.

Prérequis Android : un JDK 21 et le SDK Android. `android/local.properties` et le
`JAVA_HOME` du script pointent vers une machine précise — à adapter.

## État

Fonctionnel sur Android. Le serveur self-host optionnel (accès PC au navigateur et
synchronisation téléphone ↔ PC) est conçu mais pas encore écrit : le journal
d'événements est fait pour ça.

L'interface parle français et anglais. Elle suit la langue du téléphone au
premier lancement, et un sélecteur dans les réglages force l'une ou l'autre.
Ajouter une langue = un fichier dans `src/lang/` et une ligne — chaque langue est
typée sur l'anglais, donc une clé manquante fait échouer la compilation.

## Contribuer

Les bugs et les idées passent par les
[issues](https://github.com/Chachigo/butineur/issues) — voir
[CONTRIBUTING.md](CONTRIBUTING.md). Butineur est une appli personnelle avec des
partis pris : ouvre une issue avant d'écrire une pull request. Les gabarits sont
en anglais, mais tu peux écrire en français, on te répondra en français.

## Licence

[AGPL-3.0-only](LICENSE). Le matériel tiers embarqué est listé dans [NOTICE](NOTICE).

## Crédits

L'abeille de l'icône vient de [Noto Emoji](https://github.com/googlefonts/noto-emoji)
(Google, Apache 2.0), convertie en `VectorDrawable` par `scripts/svg-to-vector.mjs`.
Les icônes de tâches viennent de [Phosphor](https://phosphoricons.com/) (MIT).
