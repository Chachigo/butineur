# Installer Butineur

Butineur n'est pas sur le Play Store. Il se distribue en APK, depuis la
[page des versions](https://github.com/Chachigo/butineur/releases) de ce dépôt.
Android 7.0 ou plus récent.

Deux chemins. Le premier tient l'appli à jour tout seul — à préférer, sauf
raison contraire.

## Obtainium — recommandé

[Obtainium](https://github.com/ImranR98/Obtainium) surveille les versions d'une
appli et installe les mises à jour. Une fois réglé, il n'y a plus rien à faire.

1. Installer Obtainium lui-même, depuis
   [sa page de versions](https://github.com/ImranR98/Obtainium/releases) ou
   depuis [F-Droid](https://f-droid.org/packages/dev.imranr.obtainium.fdroid/).
2. Sur le téléphone, ouvrir
   **[ce lien](https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522app.butineur.mobile%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252FChachigo%252Fbutineur%2522%252C%2522author%2522%253A%2522Chachigo%2522%252C%2522name%2522%253A%2522Butineur%2522%252C%2522additionalSettings%2522%253A%2522%257B%255C%2522includePrereleases%255C%2522%253Atrue%257D%2522%257D)**.
   Obtainium s'ouvre sur un formulaire déjà rempli.
3. Toucher **Ajouter**, puis **Installer**.

Le lien porte le réglage qu'on oublie : **inclure les pré-versions**. Butineur
est encore en bêta, donc chaque version est publiée comme une pré-version — sans
cette case, Obtainium regarde le dépôt et ne trouve rien à installer.

À la main, si tu préfères : Obtainium → **Ajouter une appli** → coller
`https://github.com/Chachigo/butineur` → activer **Inclure les pré-versions** →
**Ajouter**.

## L'APK, tout seul

Prendre le `butineur-x.y.z.apk` le plus récent sur la
[page des versions](https://github.com/Chachigo/butineur/releases) et l'ouvrir.
Android demande l'autorisation d'installer depuis cette source — elle
se donne appli par appli, et c'est elle qui remplace le magasin.

Mettre à jour, c'est télécharger l'APK plus récent et l'ouvrir pareil. Les
tâches et l'historique restent : une mise à jour ne touche pas aux données.

## Le compiler soi-même

`npm run android:apk` en fabrique un, sans téléphone branché. Les prérequis sont
dans [Développement](../README.fr.md#développement).

## Bon à savoir

- **Play Protect** peut prévenir que le développeur est inconnu. C'est ce qu'il
  dit de tout ce qui s'installe hors du magasin.
- L'APK publié est signé avec une **clé de développement** ; la vraie signature
  de release reste à faire. Si une version arrivait un jour signée d'une autre
  clé, Android refuserait la mise à jour — il faudrait sauvegarder ses données
  (Réglages → Sauvegarde), désinstaller, réinstaller, restaurer.
- Obtainium interroge l'API GitHub sans jeton, donc avec une limite par adresse
  IP. Si la vérification des mises à jour échoue, ajouter un jeton GitHub dans
  les réglages d'Obtainium.
