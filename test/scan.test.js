'use strict';

// Run with:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');

const { server } = require('../server');
const D = require('../lib/data');
const { detect } = require('../lib/detect');

let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.closeAllConnections();
  server.close();
});

async function scan(filename, body = 'x = 1\n', headers = {}) {
  const url = filename === null ? `${base}/scan` : `${base}/scan?filename=${encodeURIComponent(filename)}`;
  const res = await fetch(url, { method: 'POST', body, headers });
  return { http: res.status, json: await res.json() };
}

const LANG_SEE = '/unsupported#languages';
const TYPE_SEE = '/unsupported#file-types';

function exeBytes() {
  const b = Buffer.alloc(128);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  return b;
}

// --- the exact rejection contract -------------------------------------------
test('unsupported language: HTTP 200, exact message, fields from the spec', async () => {
  const { http, json } = await scan('thing.swift');
  assert.equal(http, 200);
  assert.equal(json.status, 'unsupported');
  assert.equal(json.detected_language, 'Swift');
  assert.ok(json.reason.length > 0);
  assert.equal(json.see, LANG_SEE);
  assert.equal(json.message, 'VeriScript does not support Swift. See the full list of unsupported languages.');
});

test('unsupported file type: HTTP 200, detected_type, link to #file-types', async () => {
  const { http, json } = await scan('setup.exe', 'whatever');
  assert.equal(http, 200);
  assert.equal(json.status, 'unsupported');
  assert.equal(json.detected_type, '.exe');
  assert.equal(json.see, TYPE_SEE);
  assert.ok(json.reason.length > 0);
});

test('over 2 MB: rejected with HTTP 200, whether uploaded in full or declared', async () => {
  const big = await scan('big.py', Buffer.alloc(D.MAX_BYTES + 1, 0x61));
  assert.equal(big.http, 200);
  assert.equal(big.json.status, 'unsupported');
  assert.equal(big.json.detected_type, 'over 2 MB');
  assert.equal(big.json.see, TYPE_SEE);

  const declared = await scan('big.py', 'tiny', { 'X-File-Size': String(50 * 1024 * 1024) });
  assert.equal(declared.json.detected_type, 'over 2 MB');

  const exactly = await scan('ok.py', Buffer.alloc(D.MAX_BYTES, 0x61));
  assert.equal(exactly.json.status, 'supported');
});

// --- every table entry actually works ---------------------------------------
test('every unsupported-language extension is rejected', () => {
  for (const [ext, name] of D.LANG_BY_EXT) {
    const r = detect({ filename: `file.${ext}`, bytes: Buffer.from('x\n') });
    assert.equal(r.status, 'unsupported', `.${ext}`);
    assert.equal(r.detected_language, D.LANGUAGE_INDEX.get(name).label, `.${ext}`);
    assert.equal(r.see, LANG_SEE);
  }
  for (const [ext, { label }] of D.AMBIGUOUS_BY_EXT) {
    const r = detect({ filename: `file.${ext}`, bytes: Buffer.from('x\n') });
    assert.equal(r.detected_language, label, `.${ext}`);
  }
});

test('every supported extension is accepted', () => {
  for (const [ext, entry] of D.SUPPORTED_BY_EXT) {
    const bytes = entry.binary ? Buffer.from([0x1b, 0x4c, 0x75, 0x61, 0x00, 0x01]) : Buffer.from('x\n');
    const r = detect({ filename: `file.${ext}`, bytes });
    assert.equal(r.status, 'supported', `.${ext}`);
    assert.equal(r.detected_language, entry.language, `.${ext}`);
  }
});

test('every unsupported file type extension is rejected', () => {
  for (const [ext, rule] of D.TYPE_BY_EXT) {
    const r = detect({ filename: `file.${ext}`, bytes: Buffer.from('x') });
    assert.equal(r.status, 'unsupported', `.${ext}`);
    assert.equal(r.detected_type, `.${ext}`);
    assert.equal(r.reason, rule.reason);
    assert.equal(r.see, TYPE_SEE);
  }
});

// --- detection rules --------------------------------------------------------
test('contents beat the extension for known binaries; text that merely starts with MZ is fine', async () => {
  const renamed = await scan('totally_a_script.py', exeBytes());
  assert.equal(renamed.json.status, 'unsupported');
  assert.equal(renamed.json.detected_type, 'Windows executable');

  const zipped = await scan('notes.lua', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
  assert.equal(zipped.json.detected_type, 'zip-format archive');

  const text = await scan('thing.py', 'MZ = 5\nprint(MZ)\n');
  assert.equal(text.json.status, 'supported');
});

test('a "text" language containing NUL bytes is rejected as binary data', async () => {
  const { json } = await scan('weird.py', Buffer.from([0x61, 0x00, 0x62]));
  assert.equal(json.status, 'unsupported');
  assert.equal(json.detected_type, 'binary data');
});

test('#! line decides .sh and extensionless files', async () => {
  const zsh = await scan('run.sh', '#!/bin/zsh\necho hi\n');
  assert.equal(zsh.json.status, 'unsupported');
  assert.equal(zsh.json.detected_language, 'Zsh');
  assert.equal(zsh.json.detected_from, 'shebang');

  const bash = await scan('run.sh', '#!/usr/bin/env bash\necho hi\n');
  assert.equal(bash.json.status, 'supported');
  assert.equal(bash.json.detected_language, 'Bash');
  assert.deepEqual(bash.json.caveats, [D.CAVEATS.bash]);

  const plainSh = await scan('run.sh', 'echo hi\n');
  assert.equal(plainSh.json.detected_language, 'Bash');

  const py = await scan('tool', '#!/usr/bin/env python3.11\nprint(1)\n');
  assert.equal(py.json.detected_language, 'Python');
  assert.equal(py.json.detected_from, 'shebang');

  const perl = await scan('tool', '#!/usr/bin/perl -w\n');
  assert.equal(perl.json.detected_language, 'Perl');

  const ksh = await scan('tool', '#!/bin/ksh93\n');
  assert.equal(ksh.json.detected_language, 'Ksh');

  // A .py file is decided by its extension, not by what its first line says.
  const pyExt = await scan('thing.py', '#!/bin/zsh\n');
  assert.equal(pyExt.json.status, 'supported');
});

test('files we cannot place are rejected, not guessed at', async () => {
  const noExt = await scan('Makefile', 'all:\n\techo hi\n');
  assert.equal(noExt.json.status, 'unsupported');
  assert.equal(noExt.json.detected_type, 'no extension');

  const odd = await scan('notes.qqq', 'hello');
  assert.equal(odd.json.status, 'unsupported');
  assert.equal(odd.json.detected_type, '.qqq');
  assert.equal(odd.json.see, LANG_SEE);
});

test('partial support carries its caveats', async () => {
  assert.deepEqual((await scan('a.jsx')).json.caveats, [D.CAVEATS.jsx]);
  assert.deepEqual((await scan('a.tsx')).json.caveats, [D.CAVEATS.jsx, D.CAVEATS.typescript]);
  assert.deepEqual((await scan('a.ts')).json.caveats, [D.CAVEATS.typescript]);
  assert.equal((await scan('a.py')).json.caveats, undefined);
  const cls = await scan('A.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00]));
  assert.equal(cls.json.status, 'supported');
  assert.deepEqual(cls.json.caveats, [D.CAVEATS.class]);
});

test('a supported answer never claims the script is safe or that anything was analyzed', async () => {
  const { json } = await scan('a.py');
  const text = JSON.stringify(json).toLowerCase();
  assert.ok(!/\bsafe\b|verified|clean|trusted/.test(text), text);
  assert.match(json.note, /nothing was analyzed/);
});

// --- /scan never returns a 4xx or a stack trace ------------------------------
test('POST /scan always answers 200 with JSON, even for odd input', async () => {
  const cases = [
    [null, ''],
    ['', ''],
    ['../../etc/passwd', 'x'],
    ['..\\..\\windows\\system32\\cmd.exe', 'x'],
    ['a'.repeat(5000) + '.py', 'x'],
    ['‮fdp.py', 'x'],
    ['%E0%A4%A', 'x'],
    ['constructor', 'x'],
    ['__proto__.py', 'x'],
    ['x.toString', 'x'],
  ];
  for (const [name, body] of cases) {
    const { http, json } = await scan(name, body);
    assert.equal(http, 200, String(name).slice(0, 40));
    assert.ok(['supported', 'unsupported'].includes(json.status));
    assert.ok(!/\bat .*\.js:\d+/.test(JSON.stringify(json)), 'no stack traces');
  }
});

// --- data hygiene ------------------------------------------------------------
test('language tables: 16 supported, no duplicates, alphabetical, each with a reason', () => {
  assert.equal(D.SUPPORTED.length, 16);
  const names = D.UNSUPPORTED_LANGUAGES.flatMap((c) => c.items.map((i) => i.name));
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.filter((n) => n === 'COBOL').length, 1);
  for (const cat of D.UNSUPPORTED_LANGUAGES) {
    const sorted = [...cat.items].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    assert.deepEqual(cat.items.map((i) => i.name), sorted.map((i) => i.name), cat.title);
    for (const i of cat.items) assert.ok(i.reason, i.name);
  }
  for (const s of D.SUPPORTED) assert.ok(!D.LANGUAGE_INDEX.has(s), `${s} is both supported and rejected`);
  assert.equal(D.ONE_LINER,
    'We read code. We never run it. We support 16 languages — everything else is rejected, not guessed at. A clean result means we found no known patterns, not that the script is safe.');
});

// --- pages ------------------------------------------------------------------
test('/unsupported: languages first, file types second, every language listed, links in nav and footer', async () => {
  const res = await fetch(`${base}/unsupported`);
  assert.equal(res.status, 200);
  const html = await res.text();

  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at('languages') > 0);
  assert.ok(at('languages') < at('file-types'), 'languages before file types');
  for (const id of ['analysis', 'features', 'claims']) {
    assert.ok(at('file-types') < at(id), `file types before ${id}`);
  }
  assert.ok(at('languages') < at('partial') && at('partial') < at('file-types'));

  for (const name of D.LANGUAGE_INDEX.keys()) {
    const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    assert.ok(html.includes(`<th scope="row">${escaped}</th>`), `missing ${name}`);
  }
  for (const t of D.FILE_TYPES) for (const e of t.exts) assert.ok(html.includes(`<code>.${e}</code>`), `missing .${e}`);
  assert.ok(html.includes(D.ONE_LINER), 'one-liner in footer');
  assert.ok(html.includes(D.NO_BADGE), 'no-badge statement');
  assert.ok(/href="\/unsupported"/.test(html.split('<main')[0]), 'nav link');
  assert.ok(/href="\/unsupported"/.test(html.split('</main>')[1]), 'footer link');
});

test('home: one-liner in the hero and footer, supported hint with link, nav and footer links', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.equal(html.split(D.ONE_LINER).length - 1, 2, 'one-liner appears in hero and footer');
  assert.ok(html.includes(
    'Supported: Lua, Luau, Python, JavaScript, TypeScript, Java, C, C++, Rust, Bash, Go, PHP, Ruby, C#, Dart, Scala. ' +
    '<a href="/unsupported#languages">See full list of unsupported languages →</a>'));
  assert.ok(html.split('</main>')[1].includes('href="/unsupported"'), 'footer link');
  assert.ok(html.split('<main')[0].includes('href="/unsupported"'), 'nav link');
});

test('static files, 404s and method handling', async () => {
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/lib/data.js`)).status, 404);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/scan`)).status, 405);
  assert.equal((await fetch(`${base}/`, { method: 'POST', body: 'x' })).status, 405);
});
