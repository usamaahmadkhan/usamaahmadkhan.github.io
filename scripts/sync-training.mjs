// PARKED — the Caliber half of this is dropped (needs OAuth). What stays
// useful and provider-agnostic is normalizeMuscle / muscleGroupsFor /
// toSnapshot below, all covered by --selfcheck; next iteration swaps only the
// fetch half for whichever provider is chosen. See PLAN.md V2-A.
//
// D25 / PLAN.md V2-A — pull the last workout from Caliber's MCP server and
// write a curated, activity-only snapshot to src/assets/data/training.json.
// The committed JSON is the only thing that reaches the public site, so this
// maps a narrow shape by hand rather than dumping the raw response.
//
//   node scripts/caliber-auth.mjs             # once, to get a refresh token
//   CALIBER_REFRESH_TOKEN=… node scripts/sync-training.mjs
//   node scripts/sync-training.mjs --selfcheck   # offline, no network
//
// Auth is OAuth 2.0 (Keycloak), not an API key — see scripts/caliber-auth.mjs.
// Tool names are discovered at runtime via tools/list rather than hardcoded,
// since Caliber documents them as prose titles ("Get workouts") and the wire
// names aren't published.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'data', 'training.json');
const MCP_URL = 'https://api.caliberstrong.com/mcp';
const TOKEN_URL = 'https://id.caliberstrong.com/realms/caliber/protocol/openid-connect/token';
const CLIENT_ID = 'caliber-mcp';

// --------------------------------------------------------------------------
// Muscle normalisation — the bit that drives the body map.
// Caliber reports fine-grained muscles ("quadriceps"); the SVG in
// src/index.html only has five anterior groups. Anything unmapped is dropped
// and warned about rather than silently doing nothing.
// --------------------------------------------------------------------------

const MUSCLE_GROUPS = {
  legs: ['quad', 'hamstring', 'glute', 'calf', 'calves', 'adductor', 'abductor', 'thigh', 'leg', 'soleus', 'gastrocnemius', 'hip'],
  arms: ['bicep', 'tricep', 'forearm', 'brachi'],
  shoulders: ['shoulder', 'delt', 'trap', 'rotator'],
  chest: ['chest', 'pec'],
  core: ['ab', 'abs', 'abdominal', 'oblique', 'core', 'transverse'],
};

// Fallback when the API gives no muscle metadata: infer from exercise names.
// Longest patterns first so "leg curl" beats "curl".
const EXERCISE_HINTS = [
  [/leg curl|leg press|leg extension|calf raise|hip thrust|squat|lunge|deadlift|glute/i, 'legs'],
  [/bench|chest|pec (fly|deck)|push[- ]?up|dip/i, 'chest'],
  [/shoulder press|overhead press|lateral raise|front raise|shrug|upright row|face pull/i, 'shoulders'],
  [/bicep|tricep|curl|pushdown|skull ?crusher|hammer/i, 'arms'],
  [/plank|crunch|sit[- ]?up|russian twist|leg raise|ab wheel/i, 'core'],
];

const unmapped = new Set();

export function normalizeMuscle(name) {
  const s = String(name).toLowerCase().trim();
  if (!s) return null;
  for (const [group, needles] of Object.entries(MUSCLE_GROUPS)) {
    // word-ish match so "ab" doesn't swallow "abductor"
    if (needles.some((n) => s === n || s.includes(n))) return group;
  }
  unmapped.add(s);
  return null;
}

export function muscleGroupsFor(exercises) {
  const groups = new Set();
  for (const ex of exercises) {
    const reported = [ex.muscle, ex.muscleGroup, ...(ex.muscles ?? []), ...(ex.muscleGroups ?? [])].filter(Boolean);
    let matched = false;
    for (const m of reported) {
      const g = normalizeMuscle(m);
      if (g) { groups.add(g); matched = true; }
    }
    if (matched) continue;
    // no usable muscle metadata — fall back to the exercise name
    const hit = EXERCISE_HINTS.find(([re]) => re.test(String(ex.name ?? '')));
    if (hit) groups.add(hit[1]);
  }
  return [...groups];
}

// --------------------------------------------------------------------------
// Snapshot shape — activity only. Never body composition, weight, or nutrition,
// even though the MCP server exposes all three.
// --------------------------------------------------------------------------

export function toSnapshot(workout) {
  const exercises = (workout.exercises ?? []).map((e) => ({
    name: String(e.name ?? '').slice(0, 80),
    sets: Number(e.sets?.length ?? e.sets ?? 0),
  })).filter((e) => e.name);

  const date = workout.date ? new Date(workout.date) : new Date();
  const muscles = muscleGroupsFor(workout.exercises ?? []);

  return {
    updated: new Date().toISOString(),
    session_id: String(workout.id ?? '').slice(0, 16).toUpperCase(),
    day: date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase(),
    target: (workout.name ? String(workout.name) : muscles.join(' + ') || 'SESSION').toUpperCase().slice(0, 24),
    focus: [...new Set((workout.exercises ?? []).flatMap((e) => [e.muscle, e.muscleGroup, ...(e.muscles ?? [])].filter(Boolean)))].join(', ').slice(0, 120),
    muscles,
    total_sets: exercises.reduce((n, e) => n + e.sets, 0),
    exercises,
  };
}

// --------------------------------------------------------------------------
// OAuth + MCP transport
// --------------------------------------------------------------------------

async function accessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`token refresh failed: ${body.error_description || body.error || res.status}. Re-run scripts/caliber-auth.mjs.`);
  }
  return body.access_token;
}

let rpcId = 0;
let sessionId = null;

// Streamable HTTP transport: the server may answer with plain JSON or an SSE
// stream, so accept both and pull the JSON-RPC payload out either way.
async function rpc(token, method, params) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const text = await res.text();
  if (!text.trim()) return null;

  const payload = text.includes('data:')
    ? JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join(''))
    : JSON.parse(text);

  if (payload.error) throw new Error(`${method} -> ${payload.error.message ?? JSON.stringify(payload.error)}`);
  return payload.result;
}

// Tool result content is a list of content blocks; the useful part is JSON in a
// text block for every Caliber tool seen so far.
function parseToolResult(result) {
  const block = (result?.content ?? []).find((c) => c.type === 'text');
  if (!block) return result?.structuredContent ?? null;
  try { return JSON.parse(block.text); } catch { return block.text; }
}

async function fetchLastWorkout(refreshToken) {
  const token = await accessToken(refreshToken);

  await rpc(token, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'usamaahmadkhan.dev-sync', version: '1.0.0' },
  });

  const { tools = [] } = (await rpc(token, 'tools/list', {})) ?? {};
  const workoutTool = tools.find((t) => /workout/i.test(t.name) && !/plan|template/i.test(t.name));
  if (!workoutTool) {
    throw new Error(`no workouts tool found. Available: ${tools.map((t) => t.name).join(', ') || '(none)'}`);
  }

  // Ask for a recent window; the tool's own argument names vary, so send the
  // common ones and let the server ignore what it doesn't use.
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const raw = parseToolResult(await rpc(token, 'tools/call', {
    name: workoutTool.name,
    arguments: { startDate: since, endDate: until, start_date: since, end_date: until, limit: 20 },
  }));

  const list = Array.isArray(raw) ? raw : (raw?.workouts ?? raw?.items ?? raw?.data ?? []);
  if (!Array.isArray(list) || list.length === 0) throw new Error('no workouts returned in the last 30 days');

  // newest first
  return [...list].sort((a, b) => new Date(b.date ?? b.completedAt ?? 0) - new Date(a.date ?? a.completedAt ?? 0))[0];
}

// --------------------------------------------------------------------------

function selfCheck() {
  // muscle normalisation
  assert.equal(normalizeMuscle('Quadriceps'), 'legs');
  assert.equal(normalizeMuscle('hamstrings'), 'legs');
  assert.equal(normalizeMuscle('Biceps'), 'arms');
  assert.equal(normalizeMuscle('Rear Delts'), 'shoulders');
  assert.equal(normalizeMuscle('Pectorals'), 'chest');
  assert.equal(normalizeMuscle('Obliques'), 'core');
  assert.equal(normalizeMuscle('Latissimus Dorsi'), null, 'back has no anterior polygon — must stay unmapped');

  // name fallback when the API reports no muscle metadata
  assert.deepEqual(muscleGroupsFor([{ name: 'Leg Press (Machine)' }]), ['legs']);
  assert.deepEqual(muscleGroupsFor([{ name: 'Barbell Bench Press' }]), ['chest']);
  assert.deepEqual(muscleGroupsFor([{ name: 'Seated Leg Curl' }]), ['legs'], '"leg curl" must beat "curl"');
  // reported metadata wins over the name guess
  assert.deepEqual(muscleGroupsFor([{ name: 'Mystery Machine', muscles: ['Glutes'] }]), ['legs']);

  const snap = toSnapshot({
    id: '1c8e3637', date: '2026-08-12', name: 'Legs',
    exercises: [
      { name: 'Leg Press (Machine)', sets: [1, 2, 3], muscles: ['Quadriceps'] },
      { name: 'Plank', sets: [1] },
    ],
  });
  assert.equal(snap.day, 'WEDNESDAY');
  assert.equal(snap.target, 'LEGS');
  assert.equal(snap.total_sets, 4, 'total = sum of set counts');
  assert.deepEqual(snap.muscles, ['legs', 'core']);
  assert.ok(!Number.isNaN(Date.parse(snap.updated)));
  for (const banned of ['weight', 'bodyFat', 'calories', 'protein']) {
    assert.ok(!(banned in snap), `snapshot must not carry ${banned}`);
  }
  console.log('selfcheck OK', JSON.stringify(snap));
}

async function main() {
  if (process.argv.includes('--selfcheck')) return selfCheck();

  const refresh = process.env.CALIBER_REFRESH_TOKEN;
  if (!refresh) {
    console.error('CALIBER_REFRESH_TOKEN not set — run: node scripts/caliber-auth.mjs');
    process.exit(1);
  }

  const workout = await fetchLastWorkout(refresh);
  const snap = toSnapshot(workout);
  if (unmapped.size) console.warn(`[warn] unmapped muscles (no body-map group): ${[...unmapped].join(', ')}`);
  if (snap.muscles.length === 0) console.warn('[warn] no muscle groups resolved — body map will render dim');

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snap, null, 2)}\n`);
  console.log(`wrote ${OUT} — ${snap.target}, ${snap.total_sets} sets, muscles: ${snap.muscles.join(', ') || 'none'}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
