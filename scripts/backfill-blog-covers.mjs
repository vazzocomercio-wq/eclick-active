/**
 * Backfill: regera capas de blog_posts que vieram com .svg placeholder.
 *
 * Causa: o pipeline pedia 1200x630, DALL·E 3 só aceita 1024/1792, OpenAI
 * provider falhava e caía no PlaceholderImageProvider (SVG com prompt).
 * Fix do provider + endpoint POST /blog-ai/posts/:id/regenerate-cover
 * foram commitados em 79066da; este script chama o endpoint pra cada
 * post afetado.
 *
 * Uso: node scripts/backfill-blog-covers.mjs [--dry] [--owner-email=X]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ACTIVE_API = process.env.ACTIVE_API_URL ?? 'https://api.active.eclick.app.br';
const OWNER_EMAIL = process.argv.find((a) => a.startsWith('--owner-email='))?.split('=')[1]
  ?? 'vazzocomercio@gmail.com';
const DRY = process.argv.includes('--dry');

function loadEnv() {
  const envPath = resolve(__dirname, '..', 'apps', 'api', '.env');
  const raw = readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

async function mintJwt(env, email) {
  const SUPA = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  const g = await fetch(`${SUPA}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const gj = await g.json();
  const hashed = gj?.properties?.hashed_token ?? gj?.hashed_token;
  if (!hashed) {
    throw new Error(`generate_link falhou: ${JSON.stringify(gj)}`);
  }
  const v = await fetch(`${SUPA}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  });
  const vj = await v.json();
  if (!vj?.access_token) throw new Error(`verify falhou: ${JSON.stringify(vj)}`);
  return vj.access_token;
}

async function listPlaceholderPosts(env) {
  const SUPA = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  const url = `${SUPA}/rest/v1/blog_posts?select=id,org_id,title,cover_image_url&order=created_at.desc&limit=500`;
  const res = await fetch(url, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'active' },
  });
  if (!res.ok) throw new Error(`list blog_posts falhou: ${res.status} ${await res.text()}`);
  const all = await res.json();
  // Placeholder = URL com .svg (com ou sem query).
  return all.filter((r) => typeof r.cover_image_url === 'string' && /\.svg(\?|$)/.test(r.cover_image_url));
}

async function regenerateCover(jwt, postId) {
  const res = await fetch(`${ACTIVE_API}/blog-ai/posts/${postId}/regenerate-cover`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const env = loadEnv();
  console.log(`[backfill] ACTIVE_API=${ACTIVE_API} owner=${OWNER_EMAIL} dry=${DRY}`);

  const posts = await listPlaceholderPosts(env);
  console.log(`[backfill] ${posts.length} post(s) com capa placeholder`);
  if (posts.length === 0) return;

  // Distintos org_ids — se um dia houver mais de uma org, ajustar a estratégia
  // de owner-email. Por enquanto só Vazzo (98ea944c…) tem posts.
  const orgs = [...new Set(posts.map((p) => p.org_id))];
  console.log(`[backfill] orgs envolvidas: ${orgs.join(', ')}`);

  if (DRY) {
    posts.forEach((p) => console.log(`  • ${p.id}  ${p.title}`));
    return;
  }

  console.log(`[backfill] mintando JWT para ${OWNER_EMAIL}…`);
  const jwt = await mintJwt(env, OWNER_EMAIL);
  console.log(`[backfill] JWT obtido (${jwt.length} chars)`);

  let ok = 0;
  let fail = 0;
  for (const p of posts) {
    process.stdout.write(`[regen] ${p.id} "${p.title.slice(0, 60)}"… `);
    try {
      const r = await regenerateCover(jwt, p.id);
      if (r.ok) {
        const newUrl = (r.body && typeof r.body === 'object' && r.body.cover_image_url) || '?';
        const isStillSvg = /\.svg(\?|$)/.test(newUrl);
        if (isStillSvg) {
          console.log(`⚠️  ainda placeholder (${r.status}) — provavelmente OpenAI falhou`);
          fail++;
        } else {
          console.log(`✓ ${r.status} → ${newUrl.slice(0, 80)}…`);
          ok++;
        }
      } else {
        console.log(`✗ ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        fail++;
      }
    } catch (e) {
      console.log(`✗ erro: ${e.message}`);
      fail++;
    }
  }
  console.log(`[backfill] DONE — ${ok} ok / ${fail} falha`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
