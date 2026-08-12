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
const SITE_URL = 'https://usamaahmadkhan.dev';

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
  writeFileSync(join(outDir, 'index.html'), page, 'utf8');
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
writeFileSync(join(DIST, 'blog', 'index.html'), indexPage, 'utf8');
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

log('build complete');
