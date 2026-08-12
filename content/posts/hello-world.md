---
title: Hello, world
date: 2026-08-02
summary: The first post on this site, and why it exists.
draft: false
---

This is the first entry in `/blog`. The pipeline behind it is intentionally boring:
drop a markdown file in `content/posts/`, commit, push. A tiny Node script turns it into
a static HTML page at build time — no CMS, no database, no client-side rendering.

## How it works

1. Write a post as markdown with a small frontmatter block (title, date, summary).
2. `npm run build` renders every post into `dist/blog/<slug>/index.html`.
3. Cloudflare Pages runs that same build on every push.

That's the whole system. Code blocks work too:

```bash
npm run build
```

Draft posts (`draft: true` in frontmatter) are skipped entirely — they never reach `dist/`.
