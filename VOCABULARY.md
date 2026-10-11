# Vocabulary

One word per thing, in the words a newcomer already has. This is the list the app, the Help
page, the tours, the changelog and the release notes are written to. `client/src/vocabulary.test.ts`
reads every user-visible string in the client and fails on the retired words; `client/src/help-plain-words.test.ts`
holds Help & Guides to the same bar. (Owner, 2026-10-10, after the first-use review: a newcomer met
eight names for one secret and a mission-control metaphor on every screen.)

## The words

| Thing | Say | Never |
|---|---|---|
| The encrypted group you own | **community** (it holds group chats, with **rooms**) | outpost, Concord, private chat, space (for a group), channel |
| Where a new account starts | **your space** | private mode (that's the screen-share shield) |
| The one switch that opens the rest | **the wider network** | public Nostr, global feed, Nostr mode |
| The secret that is the account | **your key**; saved as a **key file**; the step is **Save your key**, then **Check it works** | secret key, private key, nsec, recovery code, backup, backup file, encrypted backup, seed |
| The lock on this browser's copy | **password for this browser** | passphrase, unlock key, password (bare, as the way back in) |
| One-tap unlock | **Touch ID / Face ID** (whatever the device calls it) | passkey (in sentences) |
| The main places | **Chats · Activity · Discover · Account** | Messages, DMs, Alerts, Notifications, Search (as the tab), You, Profile (as the tab) |
| One conversation | **private message** | DM, direct message |
| Posting | **post**, **New post** | note, broadcast, transmit, compose, create (as the verb for a post) |
| Refresh | **Pull to refresh** | signal |
| Strangers and safety | **Trust & safety** (sentence case): **Careful · Balanced · See everything** | Shield Matrix, Web of Trust (except the essay that explains it), WoT, trust score, Open/Strict |
| Pictures from strangers | **blurred until you tap** | NSFW |
| Money | **zaps** = optional **tips in bitcoin**; **wallet** | sats as the only word |
| The servers | **relay** (first mention in Help: "the servers that store and pass along posts") | server (for a relay), node |
| Running one | **Run a relay / Your relays**; the operator screens are the **console** | Relay Control, Relay Ops, station |
| Calls | **calls**, **Encrypted calls (beta)**; **Leave** a call | hangout, voice space, hang up |
| People | **follow**, **your people**, **Following / Followers**, **Invite a friend** | crew, orbit, circle (except the profile's "Circle" of mutuals), social graph |
| The hub | **menu** (the logo opens it) | launcher, cockpit, dock |
| Tours | **quick tour**, **Step 1 of 3**, **Replay a tour** | mission, briefing, orientation, stops |

## Kept on purpose

- The wordmark **RELAY OUTPOST** and the tagline **Beyond the Algorithm** (the default page title). Brand, not a control.
- The site title "One outpost for everything you say."
- **Nostr** by name, once per screen at most, where the open network has to be named.
- **Web of Trust** in the essay that explains it, and the nostr.com / brainstorm links in Help.

## Rules

- A name is the same on the control, in its toast, in Settings, in Help, in the tour and in the release note.
- A control says what happens ("Save key file", then "Key file saved"), never what it is made of.
- Explain a word the first time it appears on a screen; after that, just use it.
- Casing: sentence case for everything but proper names. "Trust & safety", not "Trust & Safety".
- The changelog is history: past entries keep their words.
