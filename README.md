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
```

`dist/` is generated and gitignored — never edit it directly.

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
3. Commit and push — Cloudflare Pages runs the same build.

Set `draft: true` to keep a post out of the build entirely (it won't appear in `dist/`
until you flip it back).

## Deploying (Cloudflare Pages)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → connect the repo.
3. Build settings:
   - Build command: `npm ci && npm run build`
   - Build output directory: `dist`
   - Node version: 20 or later
4. First deploy publishes to a `*.pages.dev` URL. Add a custom domain under
   **Custom domains** once you've registered one — see PLAN.md for domain candidates.

`_headers` (security headers, asset caching) and `_redirects` are picked up automatically
from `dist/` by Cloudflare Pages; nothing else to configure.

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
