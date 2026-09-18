# lib-site

Source for [lib.minamorl.com](https://lib.minamorl.com): introductions, guides, and
executable examples for libraries published under the `@minamorl` npm scope.
Each library has its own subdirectory (`/darkcore/`, `/berylx/`, …); the root is a
short landing page.

Built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build).

## Development

Requires Node 24 (`.nvmrc`) and npm.

```sh
npm ci                  # install
npm run dev             # local dev server
npm run build           # static build into dist/
npm run preview         # serve dist/ locally
npm run check           # astro check (content + TypeScript)
npm run check:examples  # type-check and execute every example under examples/
npm test                # check → check:examples → build
```

## Layout

```
astro.config.mjs          site config; one sidebar group per library
src/content.config.ts     Starlight docs collection
src/content/docs/         pages (index.mdx is the landing page)
  darkcore/               @minamorl/darkcore docs
  berylx/                 @minamorl/berylx docs
src/styles/theme.css      fonts, palette, and layout tokens (all values live here)
examples/                 runnable TypeScript examples, checked by npm test
  tsconfig.json           strict NodeNext config for examples
  smoke.ts                proves both packages import and expose their exports
scripts/check-examples.mjs
deploy/                   hosting and deployment (see deploy/README.md)
```

## Adding a library

1. Create `src/content/docs/<lib>/index.mdx` and `examples.mdx` (plus any further pages) for its docs.
2. Create `examples/<lib>/` with `.ts` files that import the published package
   (add it to `devDependencies` with an exact version). Every file is compiled and
   executed by `npm run check:examples`; prefix shared helpers with `_` to skip execution.
3. Add one entry to the `libraries` array in `astro.config.mjs`.

## Deployment

See `deploy/README.md`.
