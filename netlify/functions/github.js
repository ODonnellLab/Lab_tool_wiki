/**
 * ODonnell Lab — Netlify GitHub proxy function
 *
 * Routes read/write calls to any JSON file in any lab private repo.
 * Token and admin password live only in Netlify environment variables.
 *
 * ── Environment variables (set in Netlify dashboard) ───────────────────────
 *   GITHUB_TOKEN      Personal access token (repo scope)
 *   GITHUB_OWNER      GitHub username or org  (e.g. mikeod38)
 *   ADMIN_PASSWORD    Password for destructive operations (Clear All)
 *
 * ── Per-database repos (add one per database) ──────────────────────────────
 *   REPO_INDEXES      Sequencing indexes  (default: lab-sequencing-tools)
 *   REPO_STRAINS      Strain database     (default: lab-strains)
 *   REPO_PLASMIDS     Plasmid registry    (default: lab-plasmids)
 *   REPO_REAGENTS     Reagent tracker     (default: lab-reagents)
 *
 * ── Request format ─────────────────────────────────────────────────────────
 *   GET  ?action=read&db=indexes              returns { data, sha }
 *   GET  ?action=config                       returns { owner } (no secrets)
 *   POST { action:"write",   db, data, sha, message }
 *   POST { action:"archive", db, data, archivePath, message }
 *   POST { action:"checkPassword", password } returns { ok }
 */

const DB_REPOS = {
  indexes:  process.env.REPO_INDEXES  || 'lab-sequencing-tools',
  strains:  process.env.REPO_STRAINS  || 'lab-strains',
  plasmids: process.env.REPO_PLASMIDS || 'lab-plasmids',
  reagents: process.env.REPO_REAGENTS || 'lab-reagents',
};

const DB_FILES = {
  indexes:  'lab_indexes.json',
  strains:  'strains.json',
  plasmids: 'plasmids.json',
  reagents: 'reagents.json',
};

const BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const ok  = (body) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const TOKEN    = process.env.GITHUB_TOKEN;
  const OWNER    = process.env.GITHUB_OWNER || 'ODonnellLab';
  const ADMIN_PW = process.env.ADMIN_PASSWORD || '';

  if (!TOKEN) return err(500, 'GITHUB_TOKEN not set in Netlify environment variables.');

  const ghHeaders = {
    'Authorization': `token ${TOKEN}`,
    'Content-Type':  'application/json',
    'Accept':        'application/vnd.github+json',
  };

  let action, db, body = {};
  if (event.httpMethod === 'GET') {
    action = event.queryStringParameters?.action || 'read';
    db     = event.queryStringParameters?.db || 'indexes';
  } else {
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    action = body.action || 'read';
    db     = body.db || 'indexes';
  }

  if (!DB_REPOS[db]) {
    return err(400, `Unknown database "${db}". Valid options: ${Object.keys(DB_REPOS).join(', ')}`);
  }

  const repo = DB_REPOS[db];
  const file = DB_FILES[db];

  try {
    // CONFIG — safe to expose, contains no secrets
    if (action === 'config') {
      return ok({ owner: OWNER, databases: Object.keys(DB_REPOS) });
    }

    // PASSWORD CHECK — compared server-side only
    if (action === 'checkPassword') {
      return ok({ ok: ADMIN_PW !== '' && body.password === ADMIN_PW });
    }

    // READ
    if (action === 'read') {
      const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${file}?ref=${BRANCH}&_=${Date.now()}`;
      const r = await fetch(url, { headers: ghHeaders });
      if (r.status === 404) return ok({ data: [], sha: null });
      if (r.status === 401) return err(401, 'token_expired');
      if (!r.ok) return err(r.status, `GitHub read error ${r.status}`);
      const j = await r.json();
      const data = JSON.parse(Buffer.from(j.content.replace(/\n/g, ''), 'base64').toString('utf8'));
      return ok({ data, sha: j.sha });
    }

    // WRITE
    if (action === 'write') {
      const { data, sha, message } = body;
      const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
      const payload = { message: message || `Update ${file}`, content, branch: BRANCH };
      if (sha) payload.sha = sha;
      const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${file}`;
      const r = await fetch(url, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(payload) });
      if (r.status === 401) return err(401, 'token_expired');
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return err(r.status, e.message || `GitHub write error ${r.status}`);
      }
      const j = await r.json();
      return ok({ sha: j.content?.sha });
    }

    // ARCHIVE (write to archives/ subfolder)
    if (action === 'archive') {
      const { data, archivePath, message } = body;
      const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
      const payload = { message: message || `Archive to ${archivePath}`, content, branch: BRANCH };
      const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${archivePath}`;
      const r = await fetch(url, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(payload) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return err(r.status, e.message || `Archive failed ${r.status}`);
      }
      return ok({ ok: true });
    }

    return err(400, `Unknown action: "${action}"`);

  } catch (e) {
    return err(500, e.message);
  }
};
