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
 *   REPO_EHS            Bacteria strains + EHS registrations (default: EHS, private)
 *   BIOSAFETY_PASSWORD  Password gating the bacteria strains page
 *   NOTIFY_ISSUE_REPO   Repo for registration-request issues (default: REPO_EHS)
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

// NOTE: the EHS repo is deliberately NOT in this map. The generic read/write/
// archive actions below take no password, so anything listed here is public to
// anyone who can load the site. EHS data is reached only through the ehs* actions,
// which check BIOSAFETY_PASSWORD first.
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

    // ── Bacteria strains page (password-gated) ────────────────────────────
    // All three actions require BIOSAFETY_PASSWORD. The password is compared
    // only here, server-side; no gated content is served without it.
    const BIO_PW  = process.env.BIOSAFETY_PASSWORD || '';
    const EHS_REPO = process.env.REPO_EHS || 'EHS';

    const readEhsJson = async (path) => {
      const url = `https://api.github.com/repos/${OWNER}/${EHS_REPO}/contents/${path}`
                + `?ref=${BRANCH}&_=${Date.now()}`;
      const r = await fetch(url, { headers: ghHeaders });
      if (r.status === 404) return { data: null, sha: null };
      if (r.status === 401) throw new Error('token_expired');
      if (!r.ok) throw new Error(`GitHub read error ${r.status} for ${path}`);
      const j = await r.json();
      const raw = Buffer.from(j.content.replace(/\n/g, ''), 'base64').toString('utf8');
      return { data: JSON.parse(raw), sha: j.sha };
    };

    const readEhsRaw = async (path) => {
      const url = `https://api.github.com/repos/${OWNER}/${EHS_REPO}/contents/${path}`
                + `?ref=${BRANCH}&_=${Date.now()}`;
      const r = await fetch(url, { headers: ghHeaders });
      if (!r.ok) return null;
      const j = await r.json();
      return Buffer.from(j.content.replace(/\n/g, ''), 'base64').toString('utf8');
    };

    // UNLOCK — verify password, then return the gated payload
    if (action === 'ehsUnlock') {
      if (!BIO_PW) return err(500, 'BIOSAFETY_PASSWORD not set in environment variables.');
      if (body.password !== BIO_PW) return err(401, 'Incorrect password.');
      const [regs, strains, watch] = await Promise.all([
        readEhsJson('web/registrations.json'),
        readEhsJson('web/strains.json'),
        readEhsJson('web/watchlist.json'),
      ]);
      return ok({
        registrations: regs.data?.data || [],
        strains:       strains.data?.data || [],
        watchlist:     watch.data?.data || {},
        generated:     regs.data?.generated || null,
      });
    }

    // TRAINING DECK — gated BSL-2 onboarding slides, served as raw HTML
    if (action === 'ehsDeck') {
      if (!BIO_PW) return err(500, 'BIOSAFETY_PASSWORD not set in environment variables.');
      if (body.password !== BIO_PW) return err(401, 'Incorrect password.');
      const html = await readEhsRaw('deck/index.html');
      if (!html) return err(404, 'Training deck not found in the EHS repo.');
      return ok({ html });
    }

    // SAVE STRAIN — add, edit or retire an entry in web/strains-additions.json.
    //
    // Writes never touch web/strains.json, which scripts/build_web_data.py
    // regenerates from the strain sheets and would clobber. The build script
    // merges additions on top of the sheet-derived rows instead, so wiki edits
    // survive every rebuild and can override a sheet row by strain_id.
    //
    // Every write is committed under the editor's name and raises a
    // notification issue. There is no silent write path.
    if (action === 'ehsSaveStrain') {
      if (!BIO_PW) return err(500, 'BIOSAFETY_PASSWORD not set in environment variables.');
      if (body.password !== BIO_PW) return err(401, 'Incorrect password.');
      const op = body.op || 'add';
      const entry = body.strain || {};
      if (!entry.strain_id) return err(400, 'strain_id is required.');
      const FILE = 'web/strains-additions.json';
      const current = await readEhsJson(FILE);
      const payload = current.data || { generated: null, data: [] };
      const list = payload.data || [];
      const key = s => `${s.strain_id}::${s.species || ''}`;
      const idx = list.findIndex(s => key(s) === key(entry));
      const now = new Date().toISOString().slice(0, 19);

      if (op === 'add') {
        if (idx >= 0) return err(409, `Strain "${entry.strain_id}" is already in the wiki list.`);
        if ((body.sheetStrainIds || []).includes(entry.strain_id)) {
          entry.overrides_sheet = true;
        }
        entry.origin = 'wiki';
        entry.added_on = now;
        entry.history = [`${now} added by ${entry.edited_by || 'unknown'}`];
        list.push(entry);
      } else if (op === 'update') {
        const prior = idx >= 0 ? list[idx] : null;
        entry.origin = prior?.origin || 'wiki';
        entry.added_on = prior?.added_on || now;
        entry.updated_on = now;
        entry.overrides_sheet = prior?.overrides_sheet ?? !!body.fromSheet;
        entry.history = (prior?.history || []).concat(
          `${now} edited by ${entry.edited_by || 'unknown'}`);
        if (idx >= 0) list[idx] = entry; else list.push(entry);
      } else if (op === 'retire') {
        const prior = idx >= 0 ? list[idx] : entry;
        prior.retired = true;
        prior.retired_on = now;
        prior.retired_reason = body.reason || '';
        prior.overrides_sheet = prior.overrides_sheet ?? !!body.fromSheet;
        prior.history = (prior.history || []).concat(
          `${now} retired by ${entry.edited_by || 'unknown'}`);
        if (idx >= 0) list[idx] = prior; else list.push(prior);
      } else {
        return err(400, `Unknown op "${op}". Use add, update or retire.`);
      }

      payload.data = list;
      payload.generated = now;
      const content = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64');
      const put = {
        message: `${op} strain ${entry.strain_id} (${entry.species || 'unidentified'})`
               + ` via wiki by ${entry.edited_by || 'unknown'}`,
        content, branch: BRANCH,
      };
      if (current.sha) put.sha = current.sha;
      const r = await fetch(
        `https://api.github.com/repos/${OWNER}/${EHS_REPO}/contents/${FILE}`,
        { method: 'PUT', headers: ghHeaders, body: JSON.stringify(put) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return err(r.status, e.message || `Write failed ${r.status}`);
      }
      return ok({ saved: entry.strain_id, op });
    }

    // NOTIFY — open a GitHub issue asking the PI to file a registration
    if (action === 'ehsNotify') {
      if (!BIO_PW) return err(500, 'BIOSAFETY_PASSWORD not set in environment variables.');
      if (body.password !== BIO_PW) return err(401, 'Incorrect password.');
      const repo = process.env.NOTIFY_ISSUE_REPO || EHS_REPO;
      const { strain_id, species, note, added_by, source, status, op, reason } = body;
      const needsReg = status === 'needs_registration' || status === 'unknown';
      const verb = op === 'update' ? 'edited' : op === 'retire' ? 'retired' : 'added';
      const title = needsReg && op !== 'retire'
        ? `Registration needed: ${species || 'unidentified'} (${strain_id})`
        : `Strain ${verb} via wiki: ${species || 'unidentified'} (${strain_id})`;
      const lines = [
        needsReg && op !== 'retire'
          ? `A strain was ${verb} on the lab wiki and its species has no EHS registration on file.`
          : `A strain was ${verb} on the lab wiki. Every change raises an issue so nothing`
            + ' changes unnoticed.',
        '',
        '| Field | Value |',
        '|---|---|',
        `| Change | ${verb} |`,
        `| Strain ID | ${strain_id || '—'} |`,
        `| Species | ${species || 'unidentified'} |`,
        `| Source | ${source || '—'} |`,
        `| By | ${added_by || 'unknown'} |`,
        `| Screening result | ${status || 'unknown'} |`,
        `| Note | ${note || '—'} |`,
      ];
      if (reason) lines.push(`| Reason | ${reason} |`);
      lines.push(
        '',
        'The change is recorded in `web/strains-additions.json`, which the build script merges',
        'on top of the sheet-derived rows. Nothing in `web/strains.json` was overwritten, and',
        'the entry keeps a `history` field listing who changed it and when.',
        '');
      if (needsReg) {
        lines.push(
          '**Next step:** if this is a human pathogen it needs a Connecticut state registration',
          'before anyone works with it. Draft one with the `pathogen-risk-assessment` skill:',
          '',
          '```',
          `/pathogen-risk-assessment ${species || strain_id}`,
          '```',
          '',
          'Then submit through Yale EHS and set `status: approved` on the record.',
          '');
      }
      lines.push('_Opened automatically from the lab wiki bacteria strains page._');
      const r = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/issues`, {
        method: 'POST', headers: ghHeaders,
        body: JSON.stringify({
          title, body: lines.join('\n'),
          labels: needsReg ? ['registration-needed', 'strain-added'] : ['strain-added'],
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return err(r.status, e.message || `Issue creation failed ${r.status}`);
      }
      const j = await r.json();
      return ok({ issue: j.number, url: j.html_url });
    }

    return err(400, `Unknown action: "${action}"`);

  } catch (e) {
    return err(500, e.message);
  }
};
