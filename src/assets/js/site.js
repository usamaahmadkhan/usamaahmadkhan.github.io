/* ==========================================================================
   Usama Ahmad — personal site
   Nav, scroll-reveal, email/copy — no dependencies.
   ========================================================================== */

/* Single config block (D22) — one place to change contact details / feature flags */
const CONFIG = {
  email: { user: 'usama.ahmad.khan', domain: 'hotmail.com' },
  audio: true,
  // Off until a data source is chosen — the Caliber path was dropped because
  // it needs OAuth. Flip to true once a snapshot is being written again.
  // See PLAN.md V2-A.
  training: false,
};

document.documentElement.classList.remove('no-js');

/* --------------------------------------------------------------------------
   Email — assembled at runtime, never present as a string in HTML source
   -------------------------------------------------------------------------- */

function wireEmail() {
  const address = `${CONFIG.email.user}@${CONFIG.email.domain}`;

  // Address shown as the visible text (résumé's contact line)
  document.querySelectorAll('[data-email-link]').forEach((el) => {
    el.href = `mailto:${address}`;
    el.textContent = address;
  });

  // href only — visible content (icon + "Email") stays as authored (contact page CTA)
  document.querySelectorAll('[data-email-href]').forEach((el) => {
    el.href = `mailto:${address}`;
  });
}

/* --------------------------------------------------------------------------
   Footer year + resume print button
   -------------------------------------------------------------------------- */

function wireMisc() {
  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  const printBtn = document.querySelector('[data-print]');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}

/* --------------------------------------------------------------------------
   Mobile nav toggle
   -------------------------------------------------------------------------- */

function wireNavToggle() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const links = document.querySelector('[data-nav-links]');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    const open = links.getAttribute('data-open') === 'true';
    links.setAttribute('data-open', String(!open));
    toggle.setAttribute('aria-expanded', String(!open));
  });

  links.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      links.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

/* --------------------------------------------------------------------------
   Scroll progress + active section highlighting
   -------------------------------------------------------------------------- */

function wireScrollProgress() {
  const bar = document.querySelector('[data-scroll-progress]');
  const sections = [...document.querySelectorAll('main section[id]')];
  const links = [...document.querySelectorAll('[data-nav-links] a')];

  const linkFor = (id) => links.find((a) => a.getAttribute('href') === `#${id}`);

  const onScroll = () => {
    if (bar) {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
      bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }

    if (!sections.length) return;
    const probe = window.scrollY + window.innerHeight * 0.3;
    let current = sections[0];
    for (const s of sections) {
      if (s.offsetTop <= probe) current = s;
    }
    links.forEach((a) => a.removeAttribute('aria-current'));
    const active = linkFor(current.id);
    if (active) active.setAttribute('aria-current', 'true');
  };

  document.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
}

/* --------------------------------------------------------------------------
   Scroll reveal — IntersectionObserver, skipped under reduced-motion (D9)
   -------------------------------------------------------------------------- */

function wireReveal() {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  if (prefersReduced || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
  );

  targets.forEach((el) => io.observe(el));
}

/* --------------------------------------------------------------------------
   Impact counters (D54) — count 0 -> target on scroll into view. New,
   explicit exception to D9's minimal-motion default, alongside D10/D26/D32.
   Every number is real (D24) — this only changes how it's revealed.
   -------------------------------------------------------------------------- */

function wireImpactCounters() {
  const counters = document.querySelectorAll('[data-count-to]');
  if (!counters.length) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const finalText = (el) => {
    const to = Number(el.dataset.countTo);
    const prefix = el.dataset.countPrefix || '';
    const suffix = el.dataset.countSuffix || '';
    return `${prefix}${to}${suffix}`;
  };

  const animate = (el) => {
    if (el.dataset.done) return;
    el.dataset.done = 'true';

    if (prefersReduced) {
      el.textContent = finalText(el);
      return;
    }

    const to = Number(el.dataset.countTo);
    const prefix = el.dataset.countPrefix || '';
    const suffix = el.dataset.countSuffix || '';
    const duration = 1200;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      el.textContent = `${prefix}${Math.round(to * eased)}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = finalText(el);
    };
    requestAnimationFrame(tick);
  };

  if (!('IntersectionObserver' in window)) {
    counters.forEach(animate);
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.4 },
  );

  counters.forEach((el) => io.observe(el));
}

/* --------------------------------------------------------------------------
   Training section (D25) — fetches a curated activity snapshot and reveals
   the section only if the data exists and is fresh. Missing/stale/404 -> the
   section stays hidden, so a broken sync degrades silently rather than lying.
   No body-composition data is ever published (privacy, see PLAN.md V2-A).
   -------------------------------------------------------------------------- */

const TRAINING_MAX_AGE_DAYS = 10;

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function wireTraining() {
  if (!CONFIG.training) return;

  const section = document.querySelector('#training');
  if (!section) return;

  let data;
  try {
    const res = await fetch('/assets/data/training.json', { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return; // no data yet — leave hidden
  }

  if (!data || !data.updated) return; // placeholder / no snapshot — leave hidden

  const ageDays = (Date.now() - new Date(data.updated).getTime()) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays > TRAINING_MAX_AGE_DAYS) return; // stale — leave hidden

  const set = (sel, text) => { const el = section.querySelector(sel); if (el) el.textContent = text; };
  set('[data-train-id]', data.session_id || '—');
  set('[data-train-day]', data.day || '');
  set('[data-train-target]', data.target || '');
  set('[data-train-focus]', data.focus || '');
  set('[data-train-sets]', `${Number(data.total_sets) || 0} TOTAL SETS`);

  const grid = section.querySelector('[data-train-grid]');
  if (grid && Array.isArray(data.exercises)) {
    grid.innerHTML = data.exercises.map((ex, i) => {
      const sets = Number(ex.sets) || 0;
      return `<div class="train__card">
        <div class="train__num">${String(i + 1).padStart(2, '0')}</div>
        <div class="train__name">${esc(ex.name)}</div>
        <div class="train__sets"><span class="train__setbar"></span>${sets} SETS</div>
      </div>`;
    }).join('');
  }

  // light up worked muscle groups on the body map
  if (Array.isArray(data.muscles)) {
    for (const m of data.muscles) {
      section.querySelectorAll(`[data-muscle="${CSS.escape(String(m))}"]`).forEach((el) => el.classList.add('is-active'));
    }
  }

  const updated = section.querySelector('[data-training-updated]');
  if (updated) {
    const d = Math.round(ageDays);
    updated.textContent = d <= 0 ? 'updated today' : `updated ${d}d ago`;
  }

  section.hidden = false;
}

/* --------------------------------------------------------------------------
   Theme toggle (D55) — data-theme attribute already resolved pre-paint by
   theme-init.js; this just handles the click and persists the choice.
   -------------------------------------------------------------------------- */

function wireThemeToggle() {
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* localStorage unavailable — toggle still works for this page view */
    }
  });
}

/* --------------------------------------------------------------------------
   Background audio (V2-C) — generative drone, opt-in only.
   The Web Audio engine lives in audio.js and is dynamic-imported on first
   toggle, so it costs nothing on a normal page load. Volume is remembered
   across visits; playback never auto-resumes — every session starts silent
   and needs a deliberate click, by design.
   -------------------------------------------------------------------------- */

function wireAudio() {
  if (!CONFIG.audio) return;

  const widget = document.querySelector('[data-audio-widget]');
  const toggle = document.querySelector('[data-audio-toggle]');
  const volumeSlider = document.querySelector('[data-audio-volume]');
  if (!widget || !toggle || !volumeSlider) return;

  const stored = Number(localStorage.getItem('audio-volume'));
  const initialVolume = Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : 35;
  volumeSlider.value = String(initialVolume);

  let engine = null;
  let playing = false;
  const volumeFraction = () => Number(volumeSlider.value) / 100;

  toggle.addEventListener('click', async () => {
    if (!engine) {
      engine = await import('/assets/js/audio.js');
      engine.initAudio();
    }
    playing = !playing;
    toggle.setAttribute('aria-pressed', String(playing));
    if (playing) {
      engine.resume();
      engine.setVolume(volumeFraction());
    } else {
      engine.setVolume(0);
    }
  });

  volumeSlider.addEventListener('input', () => {
    localStorage.setItem('audio-volume', volumeSlider.value);
    if (playing && engine) engine.setVolume(volumeFraction(), true);
  });

  document.addEventListener('visibilitychange', () => {
    if (!engine) return;
    if (document.hidden) engine.suspend();
    else if (playing) engine.resume();
  });
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */

wireEmail();
wireMisc();
wireNavToggle();
wireScrollProgress();
wireReveal();
wireImpactCounters();
wireThemeToggle();
wireTraining();
wireAudio();
