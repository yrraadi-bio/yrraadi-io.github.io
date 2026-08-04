# origin.bio

The company site. Served from Cloudflare as a Workers static-assets project named
`origin-site`, on `origin.bio` and `www.origin.bio`.

It used to be GitHub Pages. It is not any more — Pages is switched off and the DNS
points at Cloudflare, so **nothing here publishes by pushing to a Pages branch.**

## Making a change

```bash
git switch main && git pull
git switch -c your-change
# edit, then:
npm install          # first time only
npm run preview      # http://127.0.0.1:8810
```

Open a pull request against `main`. CI builds it and runs the same checks the deploy
runs. Merging to `main` publishes to origin.bio within a couple of minutes; there is
no separate deploy step and nothing to run on your own machine.

`main` is what is live. Treat it that way.

## What lives where

| Path | What it is |
|---|---|
| `index.html`, `style.css` | The whole one-page site: hero, data engine, drug table, investors, research |
| `js/`, `*.js` at the root | The scroll acts, the canvases, the access form (`access.js`), the workspace embed (`platform.js`) |
| `blogs/`, `introducing-axis/` | Research posts, each a self-contained folder |
| `assets/`, `drugs/`, `*.webp` | Artwork, video, the drug structures, the social cards |
| `platform/`, `static/` | The embedded workspace: a **built** React bundle, not source (see below) |
| `api/` | Baked slide tiles and run data the workspace reads. 18,400 files. Do not hand-edit |
| `_headers`, `_redirects` | Response headers and redirects, applied by Cloudflare |
| `_dev/` | Build and one-off scripts. Never published |

## Two things that will surprise you

**The workspace is built somewhere else.** The panel embedded on the homepage is a
React app whose source is in the `origin-2.0` monorepo under `webapp/ui`, not here.
What is committed here is the compiled bundle. Changing the workspace means editing
the monorepo, building with the static-API flags, and copying the output into
`static/dist/` and `platform/index.html`. Editing files in `static/dist/` directly
works right up until the next build overwrites them.

**There is a hard ceiling on file count.** Cloudflare accepts 20,000 assets per
deployment. We are at about 18,700, and the slide tiles under `api/` are 18,400 of
those — roughly 9,000 per published slide. **Publishing a third slide will break the
deploy.** `npm run build` fails with the count and a warning once it is within a
thousand of the limit, so this surfaces in CI rather than as a confusing upload
error. Moving the tiles to R2 object storage is the fix, and is not done yet.

## Commands

| Command | Does |
|---|---|
| `npm run preview` | Serve the site locally on 8810 |
| `npm run build` | Assemble `dist/`, the exact set of files that ships, and validate it |
| `npm run check` | `build`, plus have Wrangler read the result without uploading |
| `npm run deploy` | Publish to origin.bio. **CI does this. Only use it locally in an emergency** |

`dist/` is generated and git-ignored. It is built with hardlinks, so it costs no
second copy of the 277 MB on disk.

## Who can deploy

CI, using two repository secrets under Settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN` — scoped to Workers Scripts:Edit and Workers Routes:Edit
- `CLOUDFLARE_ACCOUNT_ID` — the account `origin-site` lives in

The repo is public, so neither can go in the tree. Deploying by hand needs both in
your environment plus `npx wrangler deploy`, which is worth avoiding: a laptop deploy
puts the live site ahead of `main`, and then nobody can tell what is published.

## Worth knowing

- **The access form** posts to a Google Apps Script that appends to a Sheet. The
  script is `_dev/access-endpoint.gs`; the deployment URL is in `access.js`. Editing
  the script in the Apps Script editor does nothing until it is redeployed there.
- **The CSP in `_headers` is report-only.** It is correct as written but not yet
  enforcing. Turning it on is a deliberate step, after watching real reports.
- **Large media is cached for a week**, keyed on filename. Replacing an image under
  the same name takes up to seven days to reach a repeat visitor; a new filename
  lands immediately. That is why the social card is `og-home.jpg` rather than a
  new version of the old file.
- **`www` and the apex both serve** rather than one redirecting to the other. Fine,
  but it means two canonical URLs until that is settled.
