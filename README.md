# usamaahmadkhan.dev

Personal site — infra/SRE dashboard portfolio, ATS-friendly résumé, and a markdown blog.
Plain HTML/CSS/JS, one build script, one runtime dependency. No framework, no client-side
rendering. See [PLAN.md](PLAN.md) for the full design spec and the list of decisions behind it.

## Requirements

- [Node.js](https://nodejs.org/) 20+

## Local development

```bash
npm install
npm run build   # renders content/posts/*.md -> dist/, copies src/ -> dist/
npm run dev     # build + serve dist/ at http://localhost:8080
npm run check   # build + headless-Chrome render test, screenshots to .shots/
```

`dist/` is generated and gitignored — never edit it directly.

`npm run check` drives an installed Chrome/Edge via `puppeteer-core` (a dev-only
dependency — the site itself ships only `marked`). It asserts zero console
errors per page plus a few interactions, and writes full-page screenshots to
`.shots/` for a visual pass.

## Editing content

| To change... | Edit... |
|---|---|
| Homepage copy, experience, skills, certs | [src/index.html](src/index.html) |
| Résumé (mirrors the homepage content) | [src/resume/index.html](src/resume/index.html) |
| Contact page | [src/contact/index.html](src/contact/index.html) |
| Colours, fonts, spacing, the process-panel component | [src/assets/css/site.css](src/assets/css/site.css) |
| Print/PDF layout for the résumé | [src/assets/css/print.css](src/assets/css/print.css) |
| Nav toggle, scroll reveal, email address | [src/assets/js/site.js](src/assets/js/site.js) — see the `CONFIG` block at the top |
| Toolkit panels | [src/index.html](src/index.html), `#toolkit` section |

## Writing a blog post

1. Add a file to `content/posts/`, e.g. `content/posts/my-post.md`:

   ```markdown
   ---
   title: My Post Title
   date: 2026-01-15
   summary: One sentence for the index page and meta description.
   draft: false
   ---

   Body in markdown. Code fences, lists, tables, and blockquotes all work.
   ```

2. Run `npm run build` to preview it locally at `/blog/my-post/`.
3. Commit and push — the deploy workflow runs the same build.

Set `draft: true` to keep a post out of the build entirely (it won't appear in `dist/`
until you flip it back).

## Deploying (GitHub Pages)

The site is served from the **domain root**, which on GitHub Pages requires the repo to
be named `<user>.github.io`.

One-time setup:

1. **Rename the repo to `usamaahmadkhan.github.io`** (Settings → General → Repository
   name). A repo named anything else is a *project* site and is served from
   `/<repo>` instead of `/`. GitHub redirects the old name, so existing clones keep
   working; update your remote with
   `git remote set-url origin git@github.com:usamaahmadkhan/usamaahmadkhan.github.io.git`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   (Not "Deploy from a branch" — the site is built, not committed.)
3. Push to `main`. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds
   and publishes automatically.

Live at **https://usamaahmadkhan.github.io/**.

> Only one `<user>.github.io` repo is allowed per account, so this repo takes that slot.

### Path handling

Because the site sits at the root, no path prefix is applied. The build still supports
one, so nothing breaks if it's ever hosted from a differently-named repo:

| Env var | Default (root) | If served from a subpath |
|---|---|---|
| `BASE_PATH` | `""` | e.g. `/resume` — rewrites every root-absolute URL |
| `SITE_URL` | `https://usamaahmadkhan.github.io` | origin + subpath |

Both are supplied by the workflow from `actions/configure-pages` output rather than
hardcoded, so a rename or a custom domain needs no source change. To reproduce a
subpath build locally:

```bash
BASE_PATH=/resume npm run build   # then serve dist/ under a /resume path
```

### Caveat: `_headers` does nothing on GitHub Pages

`src/_headers` (CSP, `X-Frame-Options`, asset caching) is a **Cloudflare Pages**
feature. GitHub Pages does not let you set response headers, so those protections are
inactive there. The file is kept because it costs nothing and works immediately if you
move to Cloudflare. If the security headers matter, that move is the fix — the site
is otherwise identical on both hosts.

`.nojekyll` is included so Pages skips Jekyll, which would otherwise ignore
underscore-prefixed paths.

## Exporting the résumé as PDF

Open `/resume/` (locally or on the live site) and click **Download PDF**, or press
Ctrl+P / Cmd+P. Destination: Save as PDF · Paper: A4 · Background graphics: on.

## Project structure

```
resume/
├── src/                    # everything that ships as-is
│   ├── index.html          # homepage
│   ├── resume/index.html   # /resume
│   ├── contact/index.html  # /contact
│   ├── 404.html
│   ├── assets/{css,js,fonts,img}/
│   ├── _headers
│   └── robots.txt
├── content/posts/*.md      # blog posts — the only files you touch for writing
├── templates/               # post.html / blog-index.html, filled by build.mjs
├── build.mjs                # the entire build: copies src/, renders posts, writes sitemap.xml
└── PLAN.md                  # design spec, all decisions, and the v2 roadmap
```
