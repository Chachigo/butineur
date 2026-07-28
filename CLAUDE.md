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
| `src/store.ts` | état global : `useDB()`, `update()`, persistance idb-keyval débouncée |
| `src/native.ts` | pont widgets/notifs : écrit dans `@capacitor/preferences`, draine les taps |
| `src/ui/` | composants. `TaskEditor.tsx` est le gros morceau (600 l.). |
| `android/…/mobile/*.kt` | les 3 widgets + `Store.kt`, seul code natif |

## Widgets

Pas de service en arrière-plan. Le Kotlin lit le `SharedPreferences` **`CapacitorStorage`**
que `@capacitor/preferences` écrit déjà ; les taps appli fermée s'empilent dans
`pendingCounts`, l'appli les verse au journal à l'ouverture via `pendingToEvents()`
— avec l'horodatage du tap, donc sans pénalité de retard injustifiée. Toute clé
ajoutée côté web doit être lue à l'identique dans `Store.kt`.

## Commandes

```bash
npm run dev      # navigateur
npm test         # moteur
npm run android  # build + cap sync + installe sur le tel branché
```

## Conventions

- Interface et commentaires en **français**. Les commentaires disent *pourquoi*, pas *quoi*.
- Debug natif : **`Log.e`, jamais `Log.d`** (filtré sur le téléphone de Cléa).
- Suppression douce (`deletedAt`) partout : la synchro du lot 3 en dépendra.
- Les raccourcis assumés portent un commentaire `ponytail:` avec leur plafond.
- Checklist de tests : [.todo/ToDo-Cléa.md](.todo/ToDo-Cléa.md) — à lire avant de répondre,
  les cases cochées disent où elle en est ; retirer ce qui est fait.
- Les avis / réponses aux questions vont dans [.todo/questions-reponses.md](.todo/questions-reponses.md),
  pas dans le chat.
