# Releasing to npm

The CLI package (`cli/`, published as **`responses-proxy`**) is released to npm by
GitHub Actions — see `.github/workflows/publish.yml`.

## One-time setup

Add a repository secret so the workflow can authenticate to npm:

1. Create an **npm automation token** with publish rights on `responses-proxy`
   (npmjs.com → Access Tokens → Generate → *Automation*). Automation tokens bypass
   2FA, which is required for unattended CI publishes.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the token from step 1

## Cutting a release

1. Bump the version in `cli/package.json` (e.g. `0.2.10` → `0.2.11`).
2. Commit and push to `main`:
   ```bash
   git commit -am "chore: bump version to 0.2.11"
   git push origin main
   ```
3. The push touches `cli/package.json`, which triggers the **Publish to npm**
   workflow. It runs typecheck + tests, then publishes if that version is not
   already on npm.

The workflow is **idempotent**: if the version already exists on npm it skips the
publish step instead of failing, so re-runs and unrelated edits to
`cli/package.json` are safe.

## Manual release

From the **Actions** tab, run **Publish to npm** via *Run workflow*
(`workflow_dispatch`). It publishes whatever version is in `cli/package.json` on the
selected ref, skipping if already published.

## What the workflow does

- Installs deps with `npm ci` (compiles the native `better-sqlite3` from source).
- Runs `npm run check` (typecheck) and `npm test`.
- Publishes from `cli/`; `prepublishOnly` runs `build-cli.js`, which builds the
  server + client and bundles `dist/` into `cli/dist/`.
