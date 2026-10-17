# Dude Mobile

Control your Mac with [Dude](https://github.com/JcakPhleps/dude) from your phone.
A no-download web app (add it to your home screen) signed in with your
**[Jack Account](https://github.com/JcakPhleps/jack-account)**.

## How it works

1. **Sign in** with your Jack Account (same account across all of Jack's apps).
2. On your Mac: open Dude → menu-bar menu → **Dude Mobile** → **Setup**. It shows
   a 6-digit pair code that changes every minute.
3. On your phone: type that code → **Link**.
4. Now **Tell Dude** to do things, or **Spawn a dude** — a one-off colored dude
   that does one task and poofs when it's done (Mr. Meeseeks style).

Commands flow phone → Firestore → Mac; Dude runs them through its agent loop
(see → act → verify → retry) and the result streams back live.

## Hosting

Publish to GitHub Pages at `https://jcakphleps.github.io/dude-mobile/`. It imports
the shared Jack Account SDK from `/jack-account/js/jackaccount.js`, so the
`jack-account` repo must be published to the **same origin** (also under
`jcakphleps.github.io`). If you host Dude Mobile somewhere else, vendor a copy of
`jack-account/js/jackaccount.js` + `config.js` and fix the import path.

No build step — vanilla JS ES modules + Firebase CDN. Set up the Firebase project
once per the `jack-account` README.
