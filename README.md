# ODonnell Lab Wiki

Lab tools, databases, and reference guides. Hosted on Netlify, data stored in private GitHub repos.

## File structure

```
lab-wiki/              ← this repo (public)
├── index.html         ← landing page
├── sequencing.html    ← Illumina sequencing wiki + index registry
├── bacteria.html      ← password-gated strain registry + BSL-2 training
├── shared.css         ← shared styles used by all pages
├── netlify.toml       ← Netlify config
└── netlify/functions/
    └── github.js      ← serverless proxy (reads secrets from env vars)
```

Live on Netlify at **odonnell-lab-wiki.netlify.app**, and only there.

**Hosting rule for lab sites.** Public static content (the lab website, the game) lives on
Cloudflare Pages, alongside the DNS. Anything that needs a server function holding secrets —
this wiki — lives on Netlify, because that is the runtime `netlify/functions/github.js` is
written for. From 2026-06-05 to 2026-09-13 the lab website linked to a Cloudflare Pages copy
of this repo at `lab-tool-wiki.pages.dev`; that copy never executed the function, so the index
registry and the bacteria page were dead there. It has been deleted. Do not stand up a second
host without porting and testing the function on it first.

## Adding a new tool/page

1. Create a new HTML file (e.g. `strains.html`)
2. Add `<link rel="stylesheet" href="/shared.css">` and the site header
3. Call `/.netlify/functions/github?action=read&db=strains` for data
4. Add a card for it on `index.html`
5. Add the new page link to the `site-nav` in every page header
6. `git push` — Netlify deploys automatically

## Setup (one-time)

### 1. Data repos on GitHub (all private)
Create these private repos, each with an initial JSON file containing `[]`:
- `lab-sequencing-tools` → `lab_indexes.json`
- Add more as needed (`lab-strains`, `lab-plasmids`, etc.)

### 2. Connect to Netlify
- [app.netlify.com](https://app.netlify.com) → Add new site → Import from Git → pick this repo
- Set these environment variables under **Site configuration → Environment variables**:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | Personal access token (repo scope) from github.com/settings/tokens |
| `GITHUB_OWNER` | `ODonnellLab` |
| `ADMIN_PASSWORD` | Password for the Clear All operation |
| `REPO_INDEXES` | `lab-sequencing-tools` |
| `REPO_EHS` | `EHS` *(pathogen registrations, private)* |
| `BIOSAFETY_PASSWORD` | Password gating the Bacteria Strains page |
| `REPO_STRAINS` | `lab-strains` *(add when ready)* |
| `REPO_PLASMIDS` | `lab-plasmids` *(add when ready)* |
| `REPO_REAGENTS` | `lab-reagents` *(add when ready)* |

### 3. Renewing the GitHub token
When the token expires, a banner appears in the app with step-by-step instructions.
No HTML changes needed — just update `GITHUB_TOKEN` in the Netlify dashboard and trigger a redeploy.

## Editing workflow
```
edit file locally → git commit → git push → Netlify auto-deploys (~30s)
```
No manual upload, no token in any source file.
