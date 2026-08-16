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

One-time setup:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   (Not "Deploy from a branch" — the site is built, not committed.)
2. Push to `main`. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds
   and publishes automatically.

Live at **https://usamaahmadkhan.github.io/resume/**.

### Why the build takes a base path

This is a *project* page, so the site is served from `/resume`, not the domain root.
Every root-absolute URL in `src/` (`/assets/…`, `/blog/`, `/contact/`) has to gain that
prefix or it 404s. `build.mjs` does the rewrite, driven by two env vars the workflow
supplies from the Pages config:

| Env var | Local default | On GitHub Pages |
|---|---|---|
| `BASE_PATH` | `""` (serves at `/`) | `/resume` |
| `SITE_URL` | `https://usamaahmadkhan.github.io/resume` | same, from Pages config |

Nothing is hardcoded to the repo name, so this keeps working if you rename the repo,
move to `usamaahmadkhan.github.io`, or attach a custom domain — `BASE_PATH` just
becomes empty again.

To reproduce a production build locally:

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
