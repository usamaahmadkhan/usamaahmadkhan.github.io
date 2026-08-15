// Automated render + smoke test. Builds nothing (run `npm run build` first);
// serves dist/ on a throwaway port, drives system Chrome via puppeteer-core,
// asserts key elements + zero console errors per page, writes screenshots.
// Exits non-zero on any failure. No test framework — plain asserts.
//
// Usage: node scripts/check.mjs   (or: npm run check)

import { createServer } from 'node:http';
import { readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = dirname(fileURLToPath(import.meta.url));
const DIST = join(root, '..', 'dist');
const SHOTS = join(root, '..', 'dist', '..', '.shots'); // .gitignored sibling
const PORT = 8099;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

// --- static server: mirrors Cloudflare Pages clean-URL + 404 behaviour ---
function serve() {
  return createServer(async (req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    let file = join(DIST, path);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      if (path.endsWith('/')) file = join(DIST, path, 'index.html');
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      try {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end(await readFile(join(DIST, '404.html')));
      } catch { res.writeHead(404); res.end('not found'); }
    }
  }).listen(PORT);
}

const results = [];
function check(name, fn) { return fn().then(() => results.push([true, name])).catch((e) => results.push([false, `${name}: ${e.message}`])); }

async function main() {
  if (!CHROME) throw new Error('No Chrome/Edge found — install one or edit CHROME[] in check.mjs');
  if (!existsSync(DIST)) throw new Error('dist/ missing — run `npm run build` first');
  await mkdir(SHOTS, { recursive: true });

  const server = serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const base = `http://localhost:${PORT}`;

  const routes = ['/', '/resume/', '/contact/', '/blog/', '/blog/hello-world/'];

  for (const route of routes) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    // reduced-motion makes reveals + counters settle instantly, so a fullPage
    // screenshot captures every section (not just above-fold, unrevealed content)
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(base + route, { waitUntil: 'networkidle0' });
    const slug = route === '/' ? 'home' : route.replace(/\//g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: join(SHOTS, `${slug}.png`), fullPage: true });

    await check(`${route} no console errors`, async () =>
      assert.equal(errors.length, 0, errors.join(' | ')));
    await check(`${route} has title`, async () =>
      assert.ok((await page.title()).length > 0));
    await page.close();
  }

  // Homepage interaction checks
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base + '/', { waitUntil: 'networkidle0' });

  await check('hero CTA buttons present', async () => {
    const labels = await page.$$eval('.hero__actions a', (as) => as.map((a) => a.textContent.trim()));
    assert.ok(labels.some((t) => /Get in touch/i.test(t)), 'Get in touch missing');
    assert.ok(labels.some((t) => /GitHub/i.test(t)), 'GitHub missing');
    assert.ok(labels.some((t) => /LinkedIn/i.test(t)), 'LinkedIn missing');
  });

  await check('impact counters reach their data-driven final values', async () => {
    // expected = prefix + countTo + suffix, read from each element's own data
    const expected = await page.$$eval('.impact-count', (els) => els.map((e) =>
      `${e.dataset.countPrefix || ''}${e.dataset.countTo}${e.dataset.countSuffix || ''}`));
    assert.ok(expected.length > 0, 'no .impact-count elements found');
    await page.$eval('#impact', (el) => el.scrollIntoView());
    await new Promise((r) => setTimeout(r, 1600));
    const vals = await page.$$eval('.impact-count', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(vals, expected, `got ${JSON.stringify(vals)} want ${JSON.stringify(expected)}`);
  });

  await check('theme toggle flips data-theme and background', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    // click via the element itself — the fixed nav intercepts hit-testing clicks
    await page.$eval('[data-theme-toggle]', (el) => el.click());
    await new Promise((r) => setTimeout(r, 250));
    const after = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    assert.notEqual(before.theme, after.theme, 'data-theme did not change');
    assert.notEqual(before.bg, after.bg, 'background did not change');
  });

  await check('training section hidden without data (D25)', async () => {
    const hidden = await page.$eval('#training', (el) => el.hidden);
    assert.equal(hidden, true, 'training section should be hidden with no snapshot');
  });

  await page.close();

  // D25: drop a fresh fixture, reload, confirm the section reveals with values
  await check('training section reveals with fresh data (D25)', async () => {
    const dir = join(DIST, 'assets', 'data');
    await mkdir(dir, { recursive: true });
    const fixture = { updated: new Date().toISOString(), session_id: 'TEST01', day: 'WEDNESDAY', target: 'LEGS', focus: 'Quads', muscles: ['legs'], total_sets: 6, exercises: [{ name: 'Leg Press', sets: 3 }, { name: 'Plank', sets: 3 }] };
    await writeFile(join(dir, 'training.json'), JSON.stringify(fixture));
    try {
      const p2 = await browser.newPage();
      await p2.setViewport({ width: 1280, height: 900 });
      await p2.goto(base + '/', { waitUntil: 'networkidle0' });
      const shown = await p2.$eval('#training', (el) => !el.hidden);
      const txt = await p2.$eval('#training', (el) => el.textContent);
      const cards = await p2.$$eval('#training .train__card', (els) => els.length);
      const lit = await p2.$$eval('#training [data-muscle="legs"].is-active', (els) => els.length);
      await p2.close();
      assert.ok(shown, 'training stayed hidden with fresh data');
      assert.ok(/LEGS/.test(txt), `target missing: ${txt}`);
      assert.equal(cards, 2, `expected 2 exercise cards, got ${cards}`);
      assert.ok(lit > 0, 'worked muscle group not lit on body map');
    } finally {
      await rm(join(dir, 'training.json'), { force: true });
    }
  });

  await check('training section stays hidden with stale data (D25)', async () => {
    const dir = join(DIST, 'assets', 'data');
    await mkdir(dir, { recursive: true });
    const old = new Date(Date.now() - 30 * 86400000).toISOString(); // 30d > 10d cap
    await writeFile(join(dir, 'training.json'), JSON.stringify({ updated: old, streak_days: 12, sessions_last_30d: 18, weekly_volume: [1, 2, 3] }));
    try {
      const p3 = await browser.newPage();
      await p3.goto(base + '/', { waitUntil: 'networkidle0' });
      const hidden = await p3.$eval('#training', (el) => el.hidden);
      await p3.close();
      assert.equal(hidden, true, 'stale data should keep section hidden');
    } finally {
      await rm(join(dir, 'training.json'), { force: true });
    }
  });

  await browser.close();
  server.close();

  // report
  const failed = results.filter(([ok]) => !ok);
  for (const [ok, name] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in ${SHOTS}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
