# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

ODonnell Lab internal wiki — a static site (plain HTML/CSS) deployed on Netlify, with a single serverless function acting as a proxy to private GitHub repos where all lab data is stored as JSON files. No build step, no npm, no framework.

## Deployment

```
git push   # Netlify auto-deploys in ~30 seconds
```

There is no local dev server or test suite. To verify UI changes, push and check the Netlify preview URL, or open the HTML file directly in a browser (read-only, no function calls will work locally).

## Architecture

```
index.html                  ← landing page (card grid)
sequencing.html             ← Illumina wiki + index registry (live CRUD)
shared.css                  ← design system used by all pages
netlify/functions/github.js ← serverless proxy; all data R/W goes through here
```

**Data flow:** Browser → `/.netlify/functions/github` → GitHub API → private repo JSON files. The function holds all secrets (token, admin password) via Netlify environment variables — none appear in source.

**Supported actions** (all routed through `github.js`):
- `GET ?action=read&db=<db>` → returns `{ data, sha }`
- `GET ?action=config` → returns `{ owner, databases }`
- `POST { action:"write", db, data, sha, message }` → upserts JSON file
- `POST { action:"archive", db, data, archivePath, message }` → writes to `archives/` subfolder
- `POST { action:"checkPassword", password }` → server-side password check

**Database mapping** (env var → GitHub repo → JSON file):
| db key | env var | default repo | file |
|--------|---------|-------------|------|
| `indexes` | `REPO_INDEXES` | `lab-sequencing-tools` | `lab_indexes.json` |
| `strains` | `REPO_STRAINS` | `lab-strains` | `strains.json` |
| `plasmids` | `REPO_PLASMIDS` | `lab-plasmids` | `plasmids.json` |
| `reagents` | `REPO_REAGENTS` | `lab-reagents` | `reagents.json` |

## Adding a new page

1. Create `<name>.html` — link `shared.css` and copy the `<header class="site-header">` block from an existing page.
2. Add the new page to `site-nav` in **every** existing page header.
3. Add a card for it in `index.html`.
4. If the page needs its own data repo: add a `REPO_<NAME>` entry to `DB_REPOS` and `DB_FILES` in `github.js`, and create the corresponding private GitHub repo with an initial `[]` JSON file.

## Design system (`shared.css`)

CSS custom properties are defined on `:root`. Key tokens:
- **Colors:** `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--text`, `--text-muted`, `--text-dim`
- **Accents:** `--accent` (blue), `--accent2` (green), `--accent3` (red/orange), `--accent4` (purple), `--accent5` (orange)
- **Fonts:** `--mono` (IBM Plex Mono), `--sans` (IBM Plex Sans), `--serif` (IBM Plex Serif)

Reusable component classes: `.btn`, `.btn-green`, `.btn-outline`, `.badge-*`, `.callout`, `.callout.green/.orange/.red`, `.data-table`, `.table-wrap`, `.card`, `.filter-input`, `.filter-select`, `.dna-input`.

Per-card accent color is set via inline CSS variable: `style="--card-accent: var(--accent2)"`.

## Netlify environment variables (set in dashboard, never in source)

`GITHUB_TOKEN`, `GITHUB_OWNER`, `ADMIN_PASSWORD`, `REPO_INDEXES`, `REPO_STRAINS`, `REPO_PLASMIDS`, `REPO_REAGENTS`
