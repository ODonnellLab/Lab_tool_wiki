/**
 * ODonnell Lab — Cloudflare Pages Function: GitHub proxy
 *
 * Port of netlify/functions/github.js for Cloudflare Pages, which is where this
 * site is actually served from (lab-tool-wiki.pages.dev). Netlify functions do
 * not execute on Pages, so /.netlify/functions/* returns the HTML 404 page
 * rather than JSON. This file serves the same API at /api/github.
 *
 * Environment variables (Pages -> Settings -> Environment variables):
 *   GITHUB_TOKEN        Personal access token with repo scope
 *   GITHUB_OWNER        Org or user (default: ODonnellLab)
 *   ADMIN_PASSWORD      Password for destructive index operations
 *   BIOSAFETY_PASSWORD  Password gating the bacteria strains page
 *   REPO_EHS            Private EHS repo (default: EHS)
 *   REPO_INDEXES        Sequencing indexes (default: lab-sequencing-tools)
 *   NOTIFY_ISSUE_REPO   Where registration issues are opened (default: REPO_EHS)
 *
 * Secrets live only here, never in any committed file.
 */

const BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: CORS });
const err = (code, msg) =>
  new Response(JSON.stringify({ error: msg }), { status: code, headers: CORS });

const b64decode = (s) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64encode = (s) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export async function onRequestOptions() {
  return new Response('', { status: 200, headers: CORS });
}

async function handle(request, env) {
  const TOKEN = env.GITHUB_TOKEN;
  const OWNER = env.GITHUB_OWNER || 'ODonnellLab';
  if (!TOKEN) return err(500, 'GITHUB_TOKEN not set in environment variables.');

  // The EHS repo is deliberately NOT in this map: the generic read/write/archive
  // actions take no password, so anything listed here is public. EHS data is
  // reached only through the ehs* actions, which check BIOSAFETY_PASSWORD.
  const DB_REPOS = {
    indexes: env.REPO_INDEXES || 'lab-sequencing-tools',
    strains: env.REPO_STRAINS || 'lab-strains',
    plasmids: env.REPO_PLASMIDS || 'lab-plasmids',
    reagents: env.REPO_REAGENTS || 'lab-reagents',
  };
  const DB_FILES = {
    indexes: 'lab_indexes.json',
    strains: 'strains.json',
    plasmids: 'plasmids.json',
    reagents: 'reagents.json',
  };

  const gh = {
    Authorization: `token ${TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'User-Agent': 'odonnell-lab-wiki',
  };

  let action, db, body = {};
  if (request.method === 'GET') {
    const u = new URL(request.url);
    action = u.searchParams.get('action') || 'read';
    db = u.searchParams.get('db') || 'indexes';
  } else {
    try { body = await request.json(); } catch { body = {}; }
    action = body.action || 'read';
    db = body.db || 'indexes';
  }
  if (!DB_REPOS[db]) return err(400, `Unknown database "${db}".`);

  const EHS_REPO = env.REPO_EHS || 'EHS';
  const BIO_PW = env.BIOSAFETY_PASSWORD || '';

  const readJson = async (repo, path) => {
    const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`
              + `?ref=${BRANCH}&_=${Date.now()}`;
    const r = await fetch(url, { headers: gh });
    if (r.status === 404) return { data: null, sha: null };
    if (r.status === 401) throw new Error('token_expired');
    if (!r.ok) throw new Error(`GitHub read error ${r.status} for ${path}`);
    const j = await r.json();
    return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
  };

  const writeJson = async (repo, path, payload, sha, message) => {
    const put = { message, content: b64encode(JSON.stringify(payload, null, 2)), branch: BRANCH };
    if (sha) put.sha = sha;
    const r = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`,
      { method: 'PUT', headers: gh, body: JSON.stringify(put) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub write error ${r.status}`);
    }
    return r.json();
  };

  try {
    if (action === 'config') return ok({ owner: OWNER, databases: Object.keys(DB_REPOS) });

    if (action === 'checkPassword') {
      const ADMIN = env.ADMIN_PASSWORD || '';
      return ok({ ok: ADMIN !== '' && body.password === ADMIN });
    }

    if (action === 'read') {
      const r = await readJson(DB_REPOS[db], DB_FILES[db]);
      return ok({ data: r.data ?? [], sha: r.sha });
    }

    if (action === 'write') {
      const j = await writeJson(DB_REPOS[db], DB_FILES[db], body.data, body.sha,
        body.message || `Update ${DB_FILES[db]}`);
      return ok({ sha: j.content?.sha });
    }

    if (action === 'archive') {
      await writeJson(DB_REPOS[db], body.archivePath, body.data, null,
        body.message || `Archive to ${body.archivePath}`);
      return ok({ ok: true });
    }

    // ── Bacteria strains page (password-gated) ──────────────────────────
    const gate = () => {
      if (!BIO_PW) return err(500, 'BIOSAFETY_PASSWORD not set in environment variables.');
      if (body.password !== BIO_PW) return err(401, 'Incorrect password.');
      return null;
    };

    if (action === 'ehsUnlock') {
      const bad = gate(); if (bad) return bad;
      const [regs, strains, watch] = await Promise.all([
        readJson(EHS_REPO, 'web/registrations.json'),
        readJson(EHS_REPO, 'web/strains.json'),
        readJson(EHS_REPO, 'web/watchlist.json'),
      ]);
      return ok({
        registrations: regs.data?.data || [],
        strains: strains.data?.data || [],
        watchlist: watch.data?.data || {},
        generated: regs.data?.generated || null,
      });
    }

    if (action === 'ehsDeck') {
      const bad = gate(); if (bad) return bad;
      const url = `https://api.github.com/repos/${OWNER}/${EHS_REPO}/contents/deck/index.html`
                + `?ref=${BRANCH}&_=${Date.now()}`;
      const r = await fetch(url, { headers: gh });
      if (!r.ok) return err(404, 'Training deck not found in the EHS repo.');
      const j = await r.json();
      return ok({ html: b64decode(j.content) });
    }

    // Append-only edits, merged by the EHS build script; never touches strains.json.
    if (action === 'ehsSaveStrain') {
      const bad = gate(); if (bad) return bad;
      const op = body.op || 'add';
      const entry = body.strain || {};
      if (!entry.strain_id) return err(400, 'strain_id is required.');
      const FILE = 'web/strains-additions.json';
      const cur = await readJson(EHS_REPO, FILE);
      const payload = cur.data || { generated: null, data: [] };
      const list = payload.data || [];
      const key = (s) => `${s.strain_id}::${s.species || ''}`;
      const idx = list.findIndex((s) => key(s) === key(entry));
      const now = new Date().toISOString().slice(0, 19);

      if (op === 'add') {
        if (idx >= 0) return err(409, `Strain "${entry.strain_id}" is already in the wiki list.`);
        entry.origin = 'wiki';
        entry.added_on = now;
        entry.history = [`${now} added by ${entry.edited_by || 'unknown'}`];
        list.push(entry);
      } else if (op === 'update') {
        const prior = idx >= 0 ? list[idx] : null;
        entry.origin = prior?.origin || 'wiki';
        entry.added_on = prior?.added_on || now;
        entry.updated_on = now;
        entry.history = (prior?.history || []).concat(`${now} edited by ${entry.edited_by || 'unknown'}`);
        if (idx >= 0) list[idx] = entry; else list.push(entry);
      } else if (op === 'retire') {
        const prior = idx >= 0 ? list[idx] : entry;
        prior.retired = true;
        prior.retired_on = now;
        prior.retired_reason = body.reason || '';
        prior.history = (prior.history || []).concat(`${now} retired by ${entry.edited_by || 'unknown'}`);
        if (idx >= 0) list[idx] = prior; else list.push(prior);
      } else {
        return err(400, `Unknown op "${op}".`);
      }

      payload.data = list;
      payload.generated = now;
      await writeJson(EHS_REPO, FILE, payload, cur.sha,
        `${op} strain ${entry.strain_id} via wiki by ${entry.edited_by || 'unknown'}`);
      return ok({ saved: entry.strain_id, op });
    }

    if (action === 'ehsNotify') {
      const bad = gate(); if (bad) return bad;
      const repo = env.NOTIFY_ISSUE_REPO || EHS_REPO;
      const { strain_id, species, note, added_by, source, status, op, reason } = body;
      const needsReg = status === 'needs_registration' || status === 'identify_first'
                       || status === 'unknown';
      const verb = op === 'update' ? 'edited' : op === 'retire' ? 'retired' : 'added';
      const title = needsReg && op !== 'retire'
        ? `Registration check needed: ${species || 'unidentified'} (${strain_id})`
        : `Strain ${verb} via wiki: ${species || 'unidentified'} (${strain_id})`;
      const lines = [
        needsReg && op !== 'retire'
          ? `A strain was ${verb} on the lab wiki and its species is not covered by a registration.`
          : `A strain was ${verb} on the lab wiki. Every change raises an issue so nothing changes unnoticed.`,
        '', '| Field | Value |', '|---|---|',
        `| Change | ${verb} |`,
        `| Strain ID | ${strain_id || '-'} |`,
        `| Species | ${species || 'unidentified'} |`,
        `| Source | ${source || '-'} |`,
        `| By | ${added_by || 'unknown'} |`,
        `| Screening result | ${status || 'unknown'} |`,
        `| Note | ${note || '-'} |`,
      ];
      if (reason) lines.push(`| Reason | ${reason} |`);
      lines.push('', 'Recorded in `web/strains-additions.json`, which the build script merges on',
        'top of the sheet-derived rows. Nothing generated was overwritten.', '');
      if (needsReg) {
        lines.push('**Next step:** if this resolves to a BSL-2 human pathogen it needs a',
          'Connecticut registration before anyone works with it:', '', '```',
          `/pathogen-risk-assessment ${species || strain_id}`, '```', '');
      }
      lines.push('_Opened automatically from the lab wiki bacteria strains page._');
      const r = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/issues`, {
        method: 'POST', headers: gh,
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
}

export const onRequestGet = (ctx) => handle(ctx.request, ctx.env);
export const onRequestPost = (ctx) => handle(ctx.request, ctx.env);
