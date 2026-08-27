# Security Policy

We take the security of Relay Outpost and its users seriously. Because this is a Nostr client
that handles cryptographic identities and private messages, responsible disclosure matters.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately to **info@megistus.xyz**. If you prefer, you may also use
GitHub's [private vulnerability reporting](https://github.com/megistusXYZ/relay-outpost-xyz/security/advisories/new).

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept welcome).
- Affected version / commit and environment.

**Never include private keys (`nsec`), seed phrases, passwords, or other secrets** in a report.
If a reproduction would require one, describe the steps instead and we'll coordinate.

## What to expect

- We aim to acknowledge reports within **72 hours**.
- We'll work with you on a fix and coordinate a disclosure timeline.
- With your permission, we're happy to credit you once a fix ships.

## Scope

In scope: the application code in this repository (client, server, shared) and its default
configuration. Out of scope: vulnerabilities in third-party relays, browser signer extensions,
external services (Lightning wallets, Podcast Index, etc.), and self-host deployments that
deviate from the documented setup.

## Supported versions

This project is pre-1.x in practice; security fixes target the latest `main`. Please run a
recent build before reporting.
