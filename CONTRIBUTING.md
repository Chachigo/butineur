# Contributing

Butineur is a personal app with opinions. Contributions are welcome, but a
surprise 500-line pull request is likely to be turned down — which makes
everybody unhappy. So:

1. **Open an issue before a pull request.** Ideas and bugs both go through
   [issues](https://github.com/Chachigo/butineur/issues); the templates ask for
   what is needed to act on them.
2. **`npm test` must pass.** Any calculation rule you touch comes with its test
   in `src/engine.test.ts`.
3. **The golden rule: the balance is never stored, it is replayed.**
   `src/engine.ts` derives everything — balance, streaks, counters, tiers — from
   the append-only event log. An event carries local facts only, never an amount
   that depends on the other events. A PR that persists a derived total is
   refused on sight, however pretty it is.
4. **Interface and comments in English.** Comments say *why*, not *what*.
5. **One PR, one subject.**

Issues and pull requests are in English. You can write in French if you prefer —
you will get an answer in French.

Butineur is [AGPL-3.0-only](LICENSE): everything you contribute is published
under the same license. There is no CLA to sign.

## Getting started

```bash
npm install
npm run dev    # browser
npm test       # the reward engine
```

`CLAUDE.md` at the root is the map of the codebase — where each thing lives, and
the house rules about rhythms, cycles and widgets. Read it before a first change,
along with `src/types.ts`, which carries the whole model with its comments.
