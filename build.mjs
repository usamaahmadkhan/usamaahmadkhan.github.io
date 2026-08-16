// Static build: copies src/ -> dist/, renders content/posts/*.md into
// dist/blog/. The only dependency is `marked`. See PLAN.md D6 / phase 5.

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, 'src');
const CONTENT = join(root, 'content', 'posts');
const TEMPLATES = join(root, 'templates');
const DIST = join(root, 'dist');

// The site is served from the domain root, so no path prefix is needed and
// BASE is empty. Both values are still overridable because GitHub Pages serves
// *project* repos from /<repo> — if this is ever hosted from a repo not named
// <user>.github.io, the deploy workflow passes that subpath in and every
// root-absolute URL (/assets/…, /blog/, /contact/) gets rewritten to match.
const SITE_URL = (process.env.SITE_URL || 'https://usamaahmadkhan.github.io').replace(/\/$/, '');
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');

// The source files hardcode this origin in canonical/OG tags; it's swapped for
// the real SITE_URL at build time so the deploy target isn't baked into src/.
const SRC_ORIGIN = 'https://usamaahmadkhan.dev';

// Rewrites the origin, then pushes root-absolute URLs under BASE. The negative
// lookahead skips protocol-relative URLs (//cdn…) so they aren't mangled.
function withBase(text) {
  let out = text.split(SRC_ORIGIN).join(SITE_URL);
  if (BASE) {
    out = out
      .replace(/((?:href|src)=")\/(?!\/)/g, `$1${BASE}/`)
      .replace(/((?:import|fetch)\(\s*['"])\/(?!\/)/g, `$1${BASE}/`);
  }
  return out;
}

function log(msg) { console.log(`[build] ${msg}`); }

function fail(msg) {
  console.error(`[build] ERROR: ${msg}`);
  process.exit(1);
}

// --------------------------------------------------------------------------
// 1. Reset dist/ and copy static site
// --------------------------------------------------------------------------

// On Windows, an editor's recursive file watcher (VS Code included) can hold
// a directory-notification handle on dist/ without FILE_SHARE_DELETE, which
// makes deleting or renaming the dist/ directory *entry itself* fail with
// EPERM/EBUSY even though nothing blocks touching files inside it. So: never
// remove dist/ itself — only clear its contents, leaving the directory
// object (and the watcher's handle on it) untouched.
if (existsSync(DIST)) {
  for (const entry of readdirSync(DIST)) {
    rmSync(join(DIST, entry), { recursive: true, force: true });
  }
} else {
  mkdirSync(DIST, { recursive: true });
}
cpSync(SRC, DIST, { recursive: true });
log(`copied src/ -> dist/`);

// Fix up everything copied verbatim from src/ — origin swap always, base-path
// prefix when deploying to a subpath. Rendered blog pages get the same
// treatment later, as they're written.
const rewriteTree = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) rewriteTree(p);
    else if (/\.(html|js|xml|txt)$/.test(entry.name)) {
      writeFileSync(p, withBase(readFileSync(p, 'utf8')), 'utf8');
    }
  }
};
rewriteTree(DIST);
log(`site url ${SITE_URL}${BASE ? `, base path ${BASE}` : ''}`);

// --------------------------------------------------------------------------
// 2. Frontmatter parser — deliberately tiny, not a YAML library
// --------------------------------------------------------------------------

function parseFrontmatter(raw, filename) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) fail(`${filename}: missing frontmatter block (expected --- ... ---)`);

  const [, block, body] = match;
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx === -1) fail(`${filename}: malformed frontmatter line "${line}"`);
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (/^['"].*['"]$/.test(value)) value = value.slice(1, -1);
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    data[key] = value;
  }

  for (const required of ['title', 'date', 'summary']) {
    if (!data[required]) fail(`${filename}: missing required frontmatter field "${required}"`);
  }
  if (Number.isNaN(Date.parse(data.date))) fail(`${filename}: invalid date "${data.date}"`);

  return { ...data, body };
}

function slugify(filename) {
  return filename.replace(/\.md$/, '');
}

function formatDateDisplay(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) fail(`template placeholder {{${key}}} has no value`);
    return vars[key];
  });
}

// --------------------------------------------------------------------------
// 3. Load + render posts
// --------------------------------------------------------------------------

if (!existsSync(CONTENT)) fail(`content directory not found: ${CONTENT}`);

const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md'));
const postTemplate = readFileSync(join(TEMPLATES, 'post.html'), 'utf8');
const indexTemplate = readFileSync(join(TEMPLATES, 'blog-index.html'), 'utf8');

const posts = files
  .map((filename) => {
    const raw = readFileSync(join(CONTENT, filename), 'utf8');
    const post = parseFrontmatter(raw, filename);
    post.slug = slugify(filename);
    return post;
  })
  .filter((post) => {
    if (post.draft === true) {
      log(`skipping draft: ${post.slug}`);
      return false;
    }
    return true;
  })
  .sort((a, b) => new Date(b.date) - new Date(a.date));

if (posts.length === 0) log('no published posts found');

for (const post of posts) {
  const html = marked.parse(post.body.trim());
  const page = fill(postTemplate, {
    title: escapeHtml(post.title),
    summary: escapeHtml(post.summary),
    slug: post.slug,
    date_display: formatDateDisplay(post.date),
    content: html,
  });

  const outDir = join(DIST, 'blog', post.slug);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), withBase(page), 'utf8');
  log(`rendered blog/${post.slug}/`);
}

// --------------------------------------------------------------------------
// 4. Blog index
// --------------------------------------------------------------------------

const postLinks = posts.map((post) => `
    <a class="post-link" href="/blog/${post.slug}/">
      <span class="post-link__title">${escapeHtml(post.title)}</span>
      <span class="post-link__date mono">${formatDateDisplay(post.date)}</span>
      <span class="post-link__summary">${escapeHtml(post.summary)}</span>
    </a>`).join('\n');

const indexPage = fill(indexTemplate, {
  count: `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`,
  posts: postLinks || '<p class="muted">Nothing published yet.</p>',
});

mkdirSync(join(DIST, 'blog'), { recursive: true });
writeFileSync(join(DIST, 'blog', 'index.html'), withBase(indexPage), 'utf8');
log(`rendered blog/index.html (${posts.length} posts)`);

// --------------------------------------------------------------------------
// 5. sitemap.xml
// --------------------------------------------------------------------------

const staticRoutes = ['/', '/resume/', '/contact/', '/blog/'];
const postRoutes = posts.map((p) => `/blog/${p.slug}/`);
const allRoutes = [...staticRoutes, ...postRoutes];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes.map((route) => `  <url><loc>${SITE_URL}${route}</loc></url>`).join('\n')}
</urlset>
`;

writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');
log(`wrote sitemap.xml (${allRoutes.length} routes)`);

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'utf8');

log('build complete');
