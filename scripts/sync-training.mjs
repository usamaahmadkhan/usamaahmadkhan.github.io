// D25 / PLAN.md V2-A — fetch training telemetry from Caliber and write a
// curated, activity-only snapshot to src/assets/data/training.json. The
// committed JSON is the only thing that ever reaches the public site, so this
// maps a narrow shape by hand rather than dumping the raw response.
//
// BLOCKED: the actual Caliber MCP call (fetchCaliber) is not implemented — the
// server returns 401 and publishes no docs, so its tool names and response
// shape can't be known without a credential to probe it. Everything else here
// (shape mapping, atomic write, self-check) is real and tested.
//
//   node scripts/sync-training.mjs              # real run (needs CALIBER_TOKEN)
//   node scripts/sync-training.mjs --selfcheck  # offline shape/mapping test

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'data', 'training.json');
const MCP_URL = 'https://api.caliberstrong.com/mcp'; // JSON-RPC endpoint, bearer-auth

// Publication-safe shape: last workout's exercises/sets + worked muscle
// groups. Activity only — never body-composition or health metrics.
function toSnapshot(raw) {
  const exercises = (raw.exercises ?? []).map((e) => ({
    name: String(e.name ?? '').slice(0, 80),
    sets: Number(e.sets ?? 0),
  }));
  return {
    updated: new Date().toISOString(),
    session_id: String(raw.id ?? '').slice(0, 16),
    day: String(raw.day ?? '').toUpperCase(),
    target: String(raw.target ?? '').toUpperCase(),
    focus: String(raw.focus ?? ''),
    muscles: (raw.muscles ?? []).map((m) => String(m).toLowerCase()),
    total_sets: exercises.reduce((n, e) => n + e.sets, 0),
    exercises,
  };
}

// eslint-disable-next-line no-unused-vars
async function fetchCaliber(token) {
  // TODO: probe MCP_URL with the credential to enumerate tools + response
  // shape, call the workout/stats tool, return its raw payload for toSnapshot.
  throw new Error(`Caliber MCP call not implemented — needs credential + tool discovery at ${MCP_URL}. See PLAN.md V2-A.`);
}

function selfCheck() {
  const snap = toSnapshot({
    id: '1C8E3637', day: 'wednesday', target: 'legs', focus: 'Quads, Glutes',
    muscles: ['Legs'],
    exercises: [{ name: 'Leg Press', sets: 3 }, { name: 'Plank', sets: 1 }],
  });
  assert.equal(snap.day, 'WEDNESDAY');
  assert.equal(snap.target, 'LEGS');
  assert.deepEqual(snap.muscles, ['legs']);
  assert.equal(snap.total_sets, 4, 'total = sum of set counts');
  assert.equal(snap.exercises.length, 2);
  assert.ok(!Number.isNaN(Date.parse(snap.updated)), 'updated is ISO');
  assert.ok(!('bodyFat' in snap) && !('weight' in snap), 'no body-composition fields');
  console.log('selfcheck OK', JSON.stringify(snap));
}

async function main() {
  if (process.argv.includes('--selfcheck')) return selfCheck();

  const token = process.env.CALIBER_TOKEN;
  if (!token) {
    console.error('CALIBER_TOKEN not set');
    process.exit(1);
  }

  const raw = await fetchCaliber(token);
  const snap = toSnapshot(raw);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snap, null, 2)}\n`);
  console.log('wrote', OUT);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
