/* Upload zone for the home page. Sends one file to POST /scan and shows the answer.
   The file is only read by the server; nothing here runs, opens or fetches its contents. */
(() => {
  'use strict';

  const MAX_BYTES = 2 * 1024 * 1024;
  const slot = document.getElementById('slot');
  const input = document.getElementById('file');
  const out = document.getElementById('result');
  if (!slot || !input || !out) return;

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };

  const show = (node) => out.replaceChildren(node);

  function messageNode(result) {
    const p = el('p', { className: 'card__msg' });
    const parts = /^(.*?)\s*(See the full list of unsupported [a-z ]+\.)$/.exec(result.message || '');
    if (parts && result.see) {
      p.append(parts[1] + ' ', el('a', { href: result.see, textContent: parts[2] }));
    } else {
      p.textContent = result.message || '';
    }
    return p;
  }

  function rows(pairs) {
    const dl = el('dl');
    for (const [label, value, mono] of pairs) {
      dl.append(el('dt', { textContent: label }), el('dd', { textContent: value, className: mono ? 'mono' : '' }));
    }
    return dl;
  }

  function neutralCard(title, ...children) {
    return el('article', { className: 'card' }, el('h3', { textContent: title }), ...children);
  }

  function renderResult(r) {
    if (r.status === 'unsupported') {
      const pairs = [['Detected', r.detected_language || r.detected_type, true], ['Why', r.reason]];
      if (r.detected_from === 'shebang') pairs.splice(1, 0, ['Read from', 'The #! line at the top of the file']);
      return neutralCard('Not scanned', messageNode(r), rows(pairs));
    }

    if (r.status === 'supported') {
      const pairs = [['Detected', r.detected_language, true]];
      if (r.detected_from === 'shebang') pairs.push(['Read from', 'The #! line at the top of the file']);
      for (const c of r.caveats || []) pairs.push(['Limit', c]);
      pairs.push(['Status', r.note]);
      const card = el('article', { className: 'card card--ok' },
        el('h3', { textContent: 'Supported language' }),
        el('p', { className: 'card__msg', textContent: `${r.detected_language} is supported.` }),
        rows(pairs));
      if (r.caveats && r.caveats.length) {
        card.append(el('p', {}, el('a', { href: '/unsupported#partial', textContent: 'See how partial support works.' })));
      }
      return card;
    }

    return neutralCard('Could not scan',
      el('p', { className: 'card__msg', textContent: r.reason || 'Something went wrong. Try again.' }));
  }

  async function scan(file) {
    slot.classList.add('is-reading');
    show(el('p', { className: 'hint', textContent: `Reading ${file.name}…` }));
    try {
      // A file over the limit is not uploaded in full: we send its first few KB and its size.
      const body = file.size > MAX_BYTES ? file.slice(0, 4096) : file;
      const res = await fetch(`/scan?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Size': String(file.size) },
        body,
      });
      show(renderResult(await res.json()));
    } catch {
      show(neutralCard('Could not reach the scanner',
        el('p', { className: 'card__msg', textContent: 'Check that the server is running, then try again.' })));
    } finally {
      slot.classList.remove('is-reading');
      input.value = '';
    }
  }

  function handleFiles(files) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      show(neutralCard('One file at a time',
        el('p', { className: 'card__msg', textContent: 'Batch upload is not offered. Drop a single file.' })));
      return;
    }
    scan(files[0]);
  }

  input.addEventListener('change', () => handleFiles(input.files));

  for (const type of ['dragenter', 'dragover']) {
    slot.addEventListener(type, (e) => { e.preventDefault(); slot.classList.add('is-over'); });
  }
  for (const type of ['dragleave', 'dragend']) {
    slot.addEventListener(type, () => slot.classList.remove('is-over'));
  }
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    slot.classList.remove('is-over');
    handleFiles(e.dataTransfer && e.dataTransfer.files);
  });

  // A file dropped just outside the zone shouldn't make the browser open it.
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => { if (!slot.contains(e.target)) e.preventDefault(); });
  }
})();
