# Butineur — brief

Appli perso : les tâches faites créditent un budget loisirs. React + Vite, packagée
Android par Capacitor. Le « pourquoi » est dans [README.md](README.md) — ici, la carte
et les habitudes de la maison.

## Règle d'or

**Le solde n'est jamais stocké.** `src/engine.ts:replay()` rejoue le journal
append-only et dérive tout : solde, séries, compteurs, paliers. Un événement ne porte
que des faits locaux (quelle tâche, quand, récompense figée au moment du tap), jamais
un montant qui dépend des autres événements. Toute nouveauté qui aurait envie de
persister un total dérivé est à repenser.

## Carte

| Où | Quoi |
|---|---|
| `src/types.ts` | tout le modèle, commenté — à lire en premier |
| `src/engine.ts` | pur, déterministe, sans React ni I/O. Le chemin argent. |
| `src/engine.test.ts` | `npm test`. Toute règle de calcul touchée s'y teste. |
| `src/store.ts` | état global : `useDB()`, `update()`, persistance idb-keyval débouncée, `migrate()` au chargement |
| `src/native.ts` | pont widgets/notifs : écrit dans `@capacitor/preferences`, draine les taps |
| `src/format.ts` | tout l'affichage : montants, dates, libellé de rythme |
| `src/i18n.tsx` + `src/lang/` | traduction. Chaque langue est typée sur l'anglais : une clé manquante ne compile pas |
| `src/ui/` | composants. `TaskEditor.tsx` est le gros morceau (700 l.). |
| `android/…/mobile/*.kt` | les 3 widgets + `Store.kt`, seul code natif |

Côté `ui/` : `TaskList` (liste + validation), `Shop` (boutique + dépense libre),
`History` (journal en lecture seule), `Settings`, `IconPicker` (deux banques :
emoji, et glyphes Phosphor préfixés `ph:` — voir `Icon.tsx`), plus les
utilitaires `NumberInput`, `TierEditor`, `useSelection`, `useCloseOnBack`.

## Le rythme et les cycles

Une tâche répétitive découpe le temps en **cycles**, et une validation remplit
le cycle en cours. Tout part de `cycleFor()` : `{ from, end }` — `from` ouvre la
disponibilité, `end` est l'échéance. `isAvailable()` et `dueTsFor()` en sortent
tous les deux, ils ne peuvent donc pas se contredire.

- **Le rythme se déduit des champs**, il n'est pas stocké : `rythme(repeat)`
  rend `jour` / `semaine` / `mois` / `glissant` selon `weekday`, `monthday` et
  `everyDays`. Un seul menu à l'écran, donc aucune combinaison contradictoire.
- **L'échéance appartient au rythme.** `due` ne porte plus que l'heure (`at`,
  dont seul le jour compte pour une ponctuelle) et la pénalité, optionnelle.
  Une répétitive en reçoit une d'office au chargement, sans pénalité.
- **`pendingDue` est dérivé au rejeu** et n'avance qu'à la validation, jamais
  avec le temps : c'est ce qui fait qu'une tâche faite en avance ne rapproche
  pas l'échéance suivante, et qu'un retard ne saute pas un cycle.
- **La série ne regarde ni l'échéance ni la pénalité** : seulement l'écart entre
  deux validations (`gap > everyDays + 1`). La tolérance vaut **un jour**, pas un
  cycle — sinon une hebdomadaire faite une semaine sur deux gardait sa série.
  Les deux sanctions sont indépendantes, c'est voulu.
- `everyDays` reste le rythme en jours dans tous les cas — il règle aussi les
  périodes de compteur et la tolérance de série (mensuel = 31, `ponytail:`).

## Sous-tâches

Un seul niveau : `parentId` sur `Task`. **Un bouquet arrive une fois** — un
parent ne se répète pas, donc ses sous-tâches non plus. Une sous-tâche est une
tâche à qui on retire rythme, échéance et rappel : un nom, un montant, et un
compteur si besoin (sans unité). Elle garde sa récompense, donc elle se valide
comme n'importe quelle tâche et `replay()` n'a rien appris de neuf.

- **Un parent ne se valide pas à la main** : son montant s'affiche dans un
  encadré accentué, jamais dans un bouton. Ce sont ses sous-tâches qui le paient,
  et sa propre récompense est le bonus du bouquet complet.
- **`majParent()` dans `TaskList` est la seule règle de cascade**, appelée par la
  validation, l'annulation et le +/- d'un compteur — les trois chemins ne peuvent
  pas diverger. `ponytail:` la validation du parent est écrite, pas dérivée au
  rejeu ; voir le commentaire sur place.
- **`subtaskDone()` fait autorité sur « c'est fait »** : un compteur est fait à
  son objectif, le reste, c'est `isAvailable` à l'envers. Le n/N du chevron et ce
  que la ligne propose sortent de la même fonction.
- Les sous-tâches s'éditent **dans l'éditeur du parent** (`saveTaskTree` les
  enregistre d'un bloc), et une tâche existante peut être rattachée après coup —
  sans cycle de référence, il n'y a rien à décaler.
- Le pli est un **état d'écran**, jamais persisté. Le widget liste, lui, n'a pas
  de chevron : les sous-tâches y sont à plat, en retrait sous leur parent.

## Widgets

Pas de service en arrière-plan. Le Kotlin lit le `SharedPreferences` **`CapacitorStorage`**
que `@capacitor/preferences` écrit déjà ; les taps appli fermée s'empilent dans
`pendingCounts`, l'appli les verse au journal à l'ouverture via `pendingToEvents()`
— avec l'horodatage du tap, donc sans pénalité de retard injustifiée. Toute clé
ajoutée côté web doit être lue à l'identique dans `Store.kt`.

## Commandes

```bash
npm run dev          # navigateur
npm test             # moteur
npm run android      # build + cap sync + installe sur le tel branché
npm run android:release  # APK signé, si android/keystore.properties existe
npm run screenshots  # captures du README, sur des données de démo (dev server requis)
```

## Conventions

- **Le README existe en deux langues** : [README.md](README.md) fait référence,
  [README.fr.md](README.fr.md) le suit. Toute modif de l'un se répercute dans
  l'autre dans le même commit — titres de section compris.
- **Commentaires du code en anglais** (dépôt public, cf. `CONTRIBUTING.md`) ; ils
  disent *pourquoi*, pas *quoi*.
- **Aucune chaîne d'interface dans le code** : tout passe par `tr()` de
  `src/i18n.tsx`, avec sa clé dans `src/lang/en.ts` (la référence) et
  `src/lang/fr.ts`. `aria-label` compris. La fonction s'appelle `tr` et non `t`,
  parce que `t` désigne une tâche partout ailleurs.
- Debug natif : **`Log.e`, jamais `Log.d`** (filtré sur le téléphone de Cléa).
- Suppression douce (`deletedAt`) partout : la synchro du lot 3 en dépendra.
- Les raccourcis assumés portent un commentaire `ponytail:` avec leur plafond.
- Les tâches et la checklist de tests vivent dans le **kanban Vikunja**, plus dans un
  fichier — à lire avant de répondre, la colonne `Claude` est la file d'entrée.
  [.todo/ToDo-Cléa.md](.todo/ToDo-Cléa.md) ne garde que les conventions.
- Une carte de la colonne `brainstorming` demande un **avis avant décision** : répondre
  **en commentaire sur la carte**, et ne rien coder tant qu'elle n'est pas passée en `Claude`.
- Les autres avis / réponses aux questions vont dans
  [.todo/questions-reponses.md](.todo/questions-reponses.md), pas dans le chat.
- Nouvelle version : bumper **`package.json` et `android/app/build.gradle`** (versionCode
  compris), pousser le tag `vX.Y.Z` — la CI attache l'APK signé à une release en brouillon —
  puis écrire la note de version (nouveautés + corrections) avec un lien vers chaque commit.
- **La clé de release ne change jamais** : elle vit hors du dépôt
  (`~/.android-keys/`), son chemin et son mot de passe dans
  `android/keystore.properties`, non versionné. La CI la relit depuis les secrets
  GitHub. La perdre = tous les utilisateurs doivent désinstaller pour mettre à jour.
