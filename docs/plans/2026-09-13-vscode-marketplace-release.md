# Unlok Code on the VS Code Marketplace: release checklist

## Where things stand on 2026-09-13

- The extension is `unlok.unlok-code` 4.1.29 (`cline/apps/vscode/package.json`): publisher `unlok`, Apache 2.0, icon, marketplace README and walkthrough all present.
- It is not on the marketplace yet, and no publisher named `unlok` exists there (the publisher page returns 404 and a gallery search for "unlok" returns nothing), so the id looks available.
- A full production package build passes locally (`bun run package`: protos, type checks, webview build, lint, esbuild). A real VSIX was built the same way CI does it, with the marketplace README swapped in.
- The repo already carries Cline's release pipeline (`.github/workflows/ext-vscode-publish-stable.yml`, `scripts/publish-marketplace.mjs`), adapted today:
  - The VSIX artifact is named `unlok-code-<version>.vsix`.
  - Open VSX is optional. Without `OVSX_PAT` the release goes to the VS Code Marketplace only and says so.
  - The post to Cline's Slack channel is gone.
  - `CHANGELOG.md` starts with `## [4.1.29]`, which the workflow verifies against the package version.

## What only you can do (about 20 minutes)

1. **Create the publisher.** Sign in at https://marketplace.visualstudio.com/manage with the Microsoft account that should own Unlok's listing. Create a publisher with ID `unlok` (this must match `publisher` in package.json exactly) and display name `Unlok`. If `unlok` turns out to be taken, pick another id and change `publisher` in package.json before publishing.
2. **Create the token.** In Azure DevOps (https://dev.azure.com, any organization under the same Microsoft account) create a Personal Access Token: organization "All accessible organizations", scope "Marketplace: Manage", expiry as long as you are comfortable with. Copy it once.
3. **Give CI the token.** In https://github.com/hexanams/unlok-tools/settings/environments create an environment named `publish` (the workflow runs under it) and add `VSCE_PAT` as an environment secret. Optionally add `OVSX_PAT` (an Open VSX access token from https://open-vsx.org after creating the `unlok` namespace) so Cursor, Windsurf and VSCodium users get the same build.
4. **Release.** On https://github.com/hexanams/unlok-tools/actions run "ext-vscode-publish-stable" from `main` with tag `v4.1.29`, release type `release`, auto create tag on. It runs the test workflow first, verifies the tag, changelog and token, publishes, and attaches the VSIX to a GitHub release.

Or publish from this machine in one command, if you prefer to skip CI for the first release:

```sh
cd unlok-tools/cline/apps/vscode
VSCE_PAT=<token> bun run publish:marketplace
```

## After the first publish

- The listing appears at https://marketplace.visualstudio.com/items?itemName=unlok.unlok-code within a few minutes. The marketplace README already links there.
- Every later release: bump `version` in package.json, add a `## [x.y.z]` entry at the top of `CHANGELOG.md`, push to `main`, run the workflow with the matching tag.
- Nightly builds (`ext-vscode-publish-nightly.yml`, `scripts/publish-nightly.mjs`) publish a separate pre release id and still carry Cline's naming; adapt them only when a nightly channel is wanted.

## Known cosmetic leftovers, none blocking

- Internal asset file names (`assets/icons/cline-bot.svg`, `sleepy-cline.svg`) and the `cline-icon` contribution id still say Cline. Nothing user facing shows the word.
- `galleryBanner` is unset, so the listing header uses the marketplace default. A `{"color": "...", "theme": "dark"}` entry in package.json sets it.
