# Contributing to Relay Outpost

Thanks for your interest in improving Relay Outpost! This is an open-source project built for
the Nostr community — bug fixes, features, docs, NIP implementations, translations, and
accessibility work are all welcome.

## Code of Conduct

By participating you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please report
unacceptable behavior to **info@megistus.xyz**.

## Getting set up

You'll need **Node.js 20+**, a **PostgreSQL** database, and a Nostr signer (a NIP-07 browser
extension such as Alby or nos2x, or a NIP-46 remote signer).

```bash
git clone https://github.com/megistusXYZ/relay-outpost-xyz.git
cd relay-outpost-xyz
npm install
cp .env.example .env          # then set DATABASE_URL (only required var)
npm run db:push               # apply the schema
npm run dev                   # http://localhost:5000
```

See the [README "Getting Started"](README.md#getting-started) section for full details,
environment variables, and Docker self-hosting.

## Before you open a PR

Run the same checks CI runs:

```bash
npm test          # vitest — must stay green
npm run build     # client + server build — must pass
npm run check     # tsc type-check (informational; see note below)
```

- **Tests and build must pass.** PRs that break either won't be merged until fixed.
- **Type-check (`npm run check`):** the project currently carries ~137 pre-existing type
  errors that are being burned down over time. Don't *add* new ones — if your change
  introduces type errors, please resolve them. (CI runs `tsc` non-blocking for now.)
- Match the surrounding code style — naming, formatting, and patterns of the files you touch.

## Pull request flow

1. Fork the repo and create a feature branch: `git checkout -b feature/your-feature`.
2. Make focused commits with clear messages.
3. Push and open a PR against `main`, filling in the PR template.
4. Link any related issue and describe how you tested the change.

Keep PRs scoped to one logical change where possible — it makes review faster.

## Security and keys

- **Never handle a raw private key (`nsec`) in the UI or log it.** All signing goes through
  NIP-07/NIP-46 signers or the existing key-storage layer.
- Found a vulnerability? **Do not open a public issue** — follow [SECURITY.md](SECURITY.md).

## Where help is especially appreciated

- **NIP implementations** — there are always more NIPs to support
- **Mobile UX** — touch interactions, responsiveness, mobile-specific flows
- **Relay operator tools** — expanding the Relay Ops Center
- **Accessibility** — making the app usable for everyone
- **Translations** — localizing the interface
- **Testing** — coverage for core flows
- **Documentation** — guides, inline help, the in-app knowledge base

## Reporting bugs and requesting features

Use the GitHub issue templates (Bug report / Feature request). Good bug reports include steps
to reproduce, what you expected, what happened, and your browser/OS and signer.
