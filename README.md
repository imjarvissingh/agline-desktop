# AGline Desktop

The Windows and macOS app for [AGline](https://agline.in): when an AI agent rings your AGline number, this tray app shows an incoming-call window, then the call screen where you answer by typing (desktop voice reply is not supported yet).

This repository is a public mirror of the desktop app, kept here so CI can build both platforms. The source of truth is the private AGline monorepo (`apps/desktop`); changes are copied here by hand. Issues are welcome; contributions are reviewed before they are merged upstream.

## Develop
```bash
pnpm install
pnpm typecheck && pnpm test   # unit tests
pnpm test:smoke               # launches Electron against a fake API
pnpm dev                      # runs against https://agline.in (override with AGLINE_ORIGIN)
pnpm pack:mac / pnpm pack:win # unsigned installers into out/
```
Builds are unsigned unless `CSC_LINK`/`CSC_KEY_PASSWORD` (and Apple notarization variables) are set. Unsigned macOS builds re-sign ad hoc, and users must right-click Open the first time; Windows shows SmartScreen.

No secrets belong in this repository.
