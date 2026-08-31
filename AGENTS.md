# Repository instructions

This is a pre-release local-first novel-writing harness.

- Keep the manuscript as continuous prose. Do not add chat bubbles, avatar turns, group chat, or message timelines.
- A Book is the isolation boundary. Never inject characters, world rules, canon, summaries, or manuscript text from another Book.
- Author and character modes share one persistence, context-plan, provider, and apply pipeline. Character mode only narrows authority and viewpoint.
- Prompt visualization shows provider input material and inclusion reasons, never hidden model reasoning.
- Use neutral synthetic fixtures. They are public demo data and may be distributed with the project; never add private stories, people, accounts, device names, local usernames, network addresses, endpoints, or credentials.
- Local-host mode writes readable Book files and may use Fake or OpenAI-compatible Providers. Hosted/device mode keeps Books in that browser's unencrypted localStorage and uses Fake generation only.
- Keep Provider keys out of story files. Local-host keys are plaintext in the configured Provider file; hosted/device test keys are runtime input and must not be persisted.
- The local host defaults to loopback. Non-loopback binding requires an access token and explicit trusted Host configuration; do not describe it as safe for public exposure.
- Prefer Node standard library, native HTML controls, plain CSS, and the smallest focused test that proves non-trivial behavior.
- Preserve existing changes. Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run build:local` before claiming completion.
- Do not create a remote, push, release, deploy, or add a license without maintainer approval.
