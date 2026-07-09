# Scriptorium Local Dev Setup

Scriptorium is a Readest fork plus shared automation. Use this setup for local
reader work, WebDAV service work, and annotation/revision tooling.

## Runtime

Use a recent Node runtime. The upstream README recommends Node 24:

```sh
nvm install v24
nvm use v24
npm install -g pnpm
rustup update
```

On this workstation, the Cursor-bundled Node 24 runtime has been the reliable
local option for focused Readest tests when other local Node installations are
misconfigured.

## Repository Setup

```sh
git submodule update --init --recursive
pnpm install
pnpm --filter @readest/readest-app setup-vendors
```

`setup-vendors` is required before broad app tests because generated/vendor
assets such as PDF.js, SimpleCC, and WASM files are expected by the app.

## Readest Web App

```sh
pnpm dev-web
```

For a production-like web preview:

```sh
pnpm preview
```

## Tauri App

```sh
pnpm tauri info
pnpm tauri dev
```

Mobile targets require the platform SDK setup described by the upstream README:

```sh
pnpm tauri android init
pnpm tauri android dev

pnpm tauri ios init
pnpm tauri ios dev
```

## WebDAV Service

Run the service locally in in-memory test mode:

```sh
cd tools/readest-webdav-cloudrun
npm install
npm test
```

Run a local service with environment variables:

```sh
cp .env.example .env
set -a
. ./.env
set +a
npm start
```

Smoke test it:

```sh
npm run smoke -- \
  --url http://localhost:8080 \
  --username "$WEBDAV_USERNAME" \
  --password "$WEBDAV_PASSWORD"
```

## Revision Tooling

Compile and test the Python tools:

```sh
python3 -m py_compile tools/readest-revision-sync/scripts/*.py
PYTHONPATH=tools/readest-revision-sync/scripts \
  python3 -m unittest discover \
  -s tools/readest-revision-sync/tests \
  -p 'test_*.py'
```

Focused Readest auto-refresh test:

```sh
cd apps/readest-app
./node_modules/.bin/vitest run src/__tests__/app/library/book-file-refresh.test.ts
```

## Working Tree Hygiene

- Keep generated directories such as `node_modules/` untracked.
- Put Scriptorium source changes on focused branches from `main`.
- Keep Bibliotech and AtelierNymphet caller workflow changes in their owning
  repositories.
- Never commit secrets, Readest sync JSON, Supabase service keys, WebDAV
  passwords, Gemini keys, or GitHub tokens.
