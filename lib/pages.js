'use strict';

/** Server-rendered pages. Home and /unsupported share one layout, so the nav and footer never differ. */

const D = require('./data');
const { MAX_LABEL } = require('./detect');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E" +
  "%3Crect width='32' height='32' rx='6' fill='%2316201B'/%3E" +
  "%3Cpath d='M9 11h14M9 16h14M9 21h8' stroke='%23E8EBE4' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E";

function layout({ title, description, active, body, script }) {
  const cur = (name) => (active === name ? ' aria-current="page"' : '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <a class="brand" href="/">VeriScript</a>
  <nav aria-label="Main">
    <a href="/"${cur('home')}>Scan</a>
    <a href="/unsupported"${cur('unsupported')}>Unsupported</a>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="site">
  <p class="oneliner oneliner--small">${esc(D.ONE_LINER)}</p>
  <nav aria-label="Footer">
    <a href="/">Scan a script</a>
    <a href="/unsupported">Unsupported languages and file types</a>
  </nav>
</footer>
${script ? `<script src="${script}" defer></script>` : ''}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
function home() {
  const supported = D.SUPPORTED.map(esc).join(', ');
  return layout({
    title: 'VeriScript — read-only script scanning',
    description: 'VeriScript reads scripts and reports known patterns. It never runs them.',
    active: 'home',
    script: '/app.js',
    body: `
<section class="hero">
  <h1 class="oneliner">${esc(D.ONE_LINER)}</h1>
</section>

<section class="scan" aria-labelledby="scan-title">
  <h2 id="scan-title" class="sr-only">Scan a script</h2>
  <label class="slot" for="file" id="slot">
    <span class="slot__main">Drop a script here, or choose a file</span>
    <span class="slot__sub">One file, up to ${esc(MAX_LABEL)}. It is read, never run.</span>
    <input type="file" id="file" class="sr-only">
  </label>
  <p class="hint">Supported: ${supported}. <a href="/unsupported#languages">See full list of unsupported languages →</a></p>
  <div id="result" class="result" aria-live="polite"></div>
  <noscript><p class="hint">Scanning needs JavaScript. The <a href="/unsupported">list of what we don't support</a> works without it.</p></noscript>
</section>`,
  });
}

// ---------------------------------------------------------------------------
function unsupported() {
  const chips = D.SUPPORTED.map((n) => `<li>${esc(n)}</li>`).join('');
  const rejectedCount = D.LANGUAGE_INDEX.size;

  const langTables = D.UNSUPPORTED_LANGUAGES.map(
    (cat) => `
    <table class="lang" id="lang-${esc(cat.id)}">
      <caption>${esc(cat.title)}</caption>
      <thead><tr><th scope="col">Language</th><th scope="col">Why we don't support it</th></tr></thead>
      <tbody>
${cat.items.map((i) => `        <tr><th scope="row">${esc(i.name)}</th><td>${esc(i.reason)}</td></tr>`).join('\n')}
      </tbody>
    </table>`,
  ).join('\n');

  const partial = D.PARTIAL.map((p) => `<div class="pair"><dt>${esc(p.name)}</dt><dd>${esc(p.note)}</dd></div>`).join('\n');

  const fileTypes = D.FILE_TYPES.map(
    (t) => `
    <div class="ftype" id="type-${esc(t.id)}">
      <h3>${esc(t.title)}</h3>
      <ul class="exts">${t.exts.map((e) => `<li><code>.${esc(e)}</code></li>`).join('')}</ul>
      <p>${esc(t.reason)}</p>
    </div>`,
  ).join('\n');

  const analysis = D.ANALYSIS_NOT_PERFORMED.map(
    (a) => `<div class="pair"><dt>${esc(a.title)}</dt><dd>${esc(a.text)}</dd></div>`,
  ).join('\n');

  const features = D.FEATURES_NOT_OFFERED.map((f) => `<li>${esc(f)}</li>`).join('');

  const claims = D.REFUSE_TO_CLAIM.map(
    (c) => `<div class="pair"><dt>${esc(c.claim)}</dt><dd>${esc(c.instead)}</dd></div>`,
  ).join('\n');

  return layout({
    title: 'What VeriScript does not support',
    description: 'The full list of languages, file types, analysis and claims VeriScript does not support.',
    active: 'unsupported',
    body: `
<header class="page-head">
  <h1>What VeriScript does not support</h1>
  <p class="lede">This page is part of the product. It lists what we reject, so a rejection is never a surprise.</p>
  <nav class="toc" aria-label="On this page">
    <ul>
      <li><a href="#languages">Languages</a></li>
      <li><a href="#partial">Partial support</a></li>
      <li><a href="#file-types">File types</a></li>
      <li><a href="#analysis">Analysis we do not perform</a></li>
      <li><a href="#features">Features not offered</a></li>
      <li><a href="#claims">What we refuse to claim</a></li>
    </ul>
  </nav>
</header>

<section class="section section--lead" id="languages" aria-labelledby="languages-h">
  <h2 id="languages-h">Languages</h2>
  <p class="lede">We analyze these ${D.SUPPORTED.length} languages and nothing else.</p>
  <ul class="chips" aria-label="Supported languages">${chips}</ul>

  <h3>Languages we reject (${rejectedCount})</h3>
  <p>If a file is detected as one of these, it is rejected with a neutral card and this message:
  “VeriScript does not support [language]. See the full list of unsupported languages.”</p>
  <p>We detect language from the file extension. For <code>.sh</code> files and files with no extension we read the
  <code>#!</code> line instead. A few extensions belong to two unsupported languages
  (<code>.m</code>, <code>.pl</code>, <code>.v</code>, <code>.cl</code>, <code>.fs</code>, <code>.cls</code>); those are reported as “X or Y”.
  If we can't place a file, we reject it. We don't guess.</p>
${langTables}

  <div class="partial" id="partial">
    <h3>Partially supported</h3>
    <p>These work, with limits.</p>
    <dl class="pairs">
${partial}
    </dl>
  </div>
</section>

<section class="section" id="file-types" aria-labelledby="file-types-h">
  <h2 id="file-types-h">File types</h2>
  <p>These are rejected whatever they contain. We check the extension and, for common binary formats, the contents too,
  so renaming a program to <code>.py</code> does not get it through.</p>
${fileTypes}
  <div class="ftype" id="type-size">
    <h3>Anything over ${esc(MAX_LABEL)}</h3>
    <p>Larger files are not scanned.</p>
  </div>
</section>

<section class="section" id="analysis" aria-labelledby="analysis-h">
  <h2 id="analysis-h">Analysis we do not perform</h2>
  <dl class="pairs">
${analysis}
  </dl>
</section>

<section class="section" id="features" aria-labelledby="features-h">
  <h2 id="features-h">Features not offered (version 1)</h2>
  <ul class="plain">${features}</ul>
  <p class="callout">${esc(D.NO_BADGE)}</p>
</section>

<section class="section" id="claims" aria-labelledby="claims-h">
  <h2 id="claims-h">What we refuse to claim</h2>
  <dl class="pairs">
${claims}
  </dl>
</section>`,
  });
}

function notFound() {
  return layout({
    title: 'Page not found — VeriScript',
    description: 'Page not found.',
    active: '',
    body: `
<header class="page-head">
  <h1>Page not found</h1>
  <p class="lede"><a href="/">Scan a script</a> or <a href="/unsupported">see what we don't support</a>.</p>
</header>`,
  });
}

module.exports = { home, unsupported, notFound };
