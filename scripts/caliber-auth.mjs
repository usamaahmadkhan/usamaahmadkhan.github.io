// PARKED — the Caliber path was dropped because it requires OAuth. Kept only
// because the endpoints below were read off Caliber's live discovery documents
// and would be tedious to rediscover. Nothing in the build references this.
// See PLAN.md V2-A for the provider comparison and what to do next.
//
// One-time interactive login to Caliber, to obtain a refresh token for CI.
//
// Caliber's MCP server authenticates with OAuth 2.0 (Keycloak), not a static
// API key — so a token can't just be pasted from a settings page. This runs the
// device-authorization grant: it prints a URL + code, you log in in a browser,
// and it prints a long-lived refresh token. Store that as the
// CALIBER_REFRESH_TOKEN repo secret; scripts/sync-training.mjs exchanges it for
// a short-lived access token on every run.
//
//   node scripts/caliber-auth.mjs
//
// Endpoints below were read from the server's own discovery documents:
//   https://api.caliberstrong.com/.well-known/oauth-protected-resource
//   https://id.caliberstrong.com/realms/caliber/.well-known/openid-configuration

const DEVICE_URL = 'https://id.caliberstrong.com/realms/caliber/protocol/openid-connect/auth/device';
const TOKEN_URL = 'https://id.caliberstrong.com/realms/caliber/protocol/openid-connect/token';
const CLIENT_ID = 'caliber-mcp';
// offline_access is what makes the refresh token long-lived enough for a cron job
const SCOPE = 'openid offline_access';

const form = (obj) => new URLSearchParams(obj).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const startRes = await fetch(DEVICE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!startRes.ok) throw new Error(`device authorization failed: ${startRes.status} ${await startRes.text()}`);

  const start = await startRes.json();
  console.log('\n  Open:  ' + (start.verification_uri_complete || start.verification_uri));
  if (!start.verification_uri_complete) console.log('  Code:  ' + start.user_code);
  console.log('\nWaiting for you to approve…\n');

  const deadline = Date.now() + (start.expires_in ?? 600) * 1000;
  let interval = (start.interval ?? 5) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: start.device_code,
      }),
    });
    const body = await res.json();

    if (res.ok && body.refresh_token) {
      console.log('Success. Add this as the CALIBER_REFRESH_TOKEN repo secret:\n');
      console.log(body.refresh_token);
      console.log('\n  gh secret set CALIBER_REFRESH_TOKEN\n');
      return;
    }
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') { interval += 5000; continue; }
    throw new Error(`token exchange failed: ${body.error_description || body.error || JSON.stringify(body)}`);
  }
  throw new Error('timed out waiting for approval');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
