# ODonnell Lab Wiki

Lab tools, databases, and reference guides. Hosted on Netlify, data stored in private GitHub repos.

## File structure

```
lab-wiki/              ← this repo (public)
├── index.html         ← landing page
├── sequencing.html    ← Illumina sequencing wiki + index registry
├── shared.css         ← shared styles used by all pages
├── netlify.toml       ← Netlify config
└── netlify/functions/
    └── github.js      ← serverless proxy (reads secrets from env vars)
```

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
| `GITHUB_OWNER` | `mikeod38` |
| `ADMIN_PASSWORD` | Password for the Clear All operation |
| `REPO_INDEXES` | `lab-sequencing-tools` |
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
