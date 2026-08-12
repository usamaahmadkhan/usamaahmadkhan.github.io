/* Pre-paint theme resolution (D55). Loaded as a render-blocking <script src>
   (no async/defer) in <head>, before the stylesheet, so data-theme is set
   before first paint — same effect as an inline script, without needing
   CSP 'unsafe-inline'. Explicit preference wins; a first-ever visit falls
   back to the OS preference and isn't saved until the visitor toggles. */
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* localStorage unavailable — falls back to the CSS media query */ }
})();
