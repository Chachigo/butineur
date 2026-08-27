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
npm run screenshots  # captures du README, sur des données de démo (dev server requis)
```

## Conventions

- **Commentaires du code en anglais** (dépôt public, cf. `CONTRIBUTING.md`) ; ils
  disent *pourquoi*, pas *quoi*. L'interface est encore en français, la
  traduction est en cours.
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
- Nouvelle version : écrire une note de version (nouveautés + corrections) dans la release
  GitHub, avec un lien vers chaque commit.
