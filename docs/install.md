# Installing Butineur

Butineur is not on the Play Store. It is distributed as an APK, from the
[releases page](https://github.com/Chachigo/butineur/releases) of this repo.
Android 7.0 or newer.

Two ways in. The first one keeps the app updated by itself — pick it unless you
have a reason not to.

## Obtainium — recommended

[Obtainium](https://github.com/ImranR98/Obtainium) watches an app's releases and
installs the updates. One setup, then nothing to do.

1. Install Obtainium itself, from
   [its releases page](https://github.com/ImranR98/Obtainium/releases) or from
   [F-Droid](https://f-droid.org/packages/dev.imranr.obtainium.fdroid/).
2. On your phone, open
   **[this link](https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522app.butineur.mobile%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252FChachigo%252Fbutineur%2522%252C%2522author%2522%253A%2522Chachigo%2522%252C%2522name%2522%253A%2522Butineur%2522%257D)**.
   Obtainium opens on a filled-in form.
3. Tap **Add**, then **Install**.

By hand, if you prefer: Obtainium → **Add App** → paste
`https://github.com/Chachigo/butineur` → **Add**. Stable releases only; turn on
**Include prereleases** if you want the betas too.

## The APK, on its own

Take the newest `butineur-x.y.z.apk` from the
[releases page](https://github.com/Chachigo/butineur/releases) and open it.
Android asks whether it may install apps from this source — that permission
is per-app, and it is what replaces the store.

Updating means downloading the newer APK and opening it the same way. Your tasks
and your history are kept: an update never touches the data.

## Building it yourself

`npm run android:apk` produces one, no phone needed. See
[Development](../README.md#development) for the prerequisites.

## Good to know

- **Play Protect** may warn that the developer is unknown. That is what it says
  about anything installed outside the store.
- Every APK from 1.0.0 on is signed with the project's **release key**, whose
  SHA-1 fingerprint is `AB:C3:E5:2C:C7:C9:65:F9:CB:90:42:AB:B7:67:D3:0F:E4:F3:B1:0D`. Android refuses an update signed with another key,
  so this one will not change. The betas up to 0.6.0-beta were signed with a
  development key: coming from one of those, save your data
  (Settings → Backup), uninstall, install 1.0.0, restore.
- A **"conflict" failure** while installing means another copy of Butineur is
  still on the phone, signed with a different key. It does not have to be in the
  profile you are looking at: Android keeps one signature per package name for
  the whole device, so a clone left in a work profile (Island, Shelter, Private
  space) blocks the install from everywhere. Remove that one too.
- Obtainium queries the GitHub API anonymously, which is rate-limited by IP. If
  update checks start failing, add a GitHub token in Obtainium's settings.
