'use strict';

/**
 * Single source of truth for everything VeriScript refuses to do.
 * The /unsupported page, the hint under the upload zone, and POST /scan all
 * read from this file, so the three can never drift apart.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// ---------------------------------------------------------------------------
// What we DO analyze (order as given in the spec)
// ---------------------------------------------------------------------------
const SUPPORTED = [
  'Lua', 'Luau', 'Python', 'JavaScript', 'TypeScript', 'Java', 'C', 'C++',
  'Rust', 'Bash', 'Go', 'PHP', 'Ruby', 'C#', 'Dart', 'Scala',
];

const ONE_LINER =
  `We read code. We never run it. We support ${SUPPORTED.length} languages — ` +
  'everything else is rejected, not guessed at. A clean result means we found ' +
  'no known patterns, not that the script is safe.';

// ---------------------------------------------------------------------------
// Unsupported languages, by category. Each gets a one-line reason.
// ---------------------------------------------------------------------------
const REASON = {
  parser: 'Outside our parser set',
  patterns: 'No reliable static patterns',
  notSource: 'Not a source language',
};

// L(name, reasonKey, labelUsedInRejectionMessage?)
const L = (name, reason, label) => ({ name, reason: REASON[reason], label: label || name });

const UNSUPPORTED_LANGUAGES = [
  {
    id: 'systems',
    title: 'Systems / native',
    items: [
      L('Swift', 'parser'), L('Kotlin', 'parser'), L('Objective-C', 'parser'),
      L('Zig', 'parser'), L('Nim', 'parser'), L('Crystal', 'parser'),
      L('V', 'parser'), L('D', 'parser'),
      L('Assembly (any ISA)', 'patterns', 'Assembly'),
      L('GLSL', 'parser'), L('HLSL', 'parser'), L('ShaderLab', 'parser'),
      L('CUDA', 'parser'), L('OpenCL C', 'parser'),
    ],
  },
  {
    id: 'functional',
    title: 'Functional',
    items: [
      L('Haskell', 'parser'), L('OCaml', 'parser'), L('F#', 'parser'),
      L('Clojure', 'parser'), L('ClojureScript', 'parser'), L('Elixir', 'parser'),
      L('Erlang', 'parser'), L('Scheme', 'parser'), L('Common Lisp', 'parser'),
      L('Racket', 'parser'), L('Elm', 'parser'), L('PureScript', 'parser'),
      L('ReasonML', 'parser'), L('Gleam', 'parser'), L('Idris', 'parser'),
    ],
  },
  {
    id: 'data',
    title: 'Data / scientific',
    items: [
      L('R', 'parser'), L('Julia', 'parser'), L('MATLAB', 'parser'),
      L('Octave', 'parser'), L('SAS', 'parser'), L('Stata', 'parser'),
      L('Mathematica', 'parser'), L('Wolfram Language', 'parser'),
    ],
  },
  {
    id: 'legacy',
    title: 'Legacy / enterprise',
    items: [
      L('Visual Basic', 'parser'), L('VB.NET', 'parser'), L('Delphi', 'parser'),
      L('Object Pascal', 'parser'), L('Ada', 'parser'), L('Fortran', 'parser'),
      L('COBOL', 'parser'), // listed twice in the source spec; kept once here
      L('PL/SQL', 'parser'), L('T-SQL', 'parser'), L('ABAP', 'parser'),
      L('Apex', 'parser'),
    ],
  },
  {
    id: 'scripting',
    title: 'Scripting (beyond Bash)',
    items: [
      L('PowerShell', 'parser'), L('Batch/CMD', 'parser'), L('Fish', 'parser'),
      L('Zsh', 'parser'), L('Ksh', 'parser'), L('Tcl', 'parser'),
      L('Awk', 'parser'), L('Sed', 'parser'), L('Perl', 'parser'),
      L('Groovy', 'parser'),
    ],
  },
  {
    id: 'other',
    title: 'Web / query / other',
    items: [
      L('SQL (any dialect)', 'patterns', 'SQL'),
      L('Solidity', 'parser'), L('Vyper', 'parser'), L('Move', 'parser'),
      L('Cairo', 'parser'), L('Prolog', 'parser'), L('Smalltalk', 'parser'),
      L('Forth', 'parser'),
      L('HTML', 'notSource'), L('CSS', 'notSource'), L('XML', 'notSource'),
      L('JSON', 'notSource'), L('YAML', 'notSource'), L('Markdown', 'notSource'),
      L('GraphQL', 'notSource'), L('Protocol Buffers', 'notSource'),
    ],
  },
];

// Alphabetical inside every category, as the spec requires.
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
for (const cat of UNSUPPORTED_LANGUAGES) cat.items.sort(byName);

// name -> entry. Throws on duplicates so a repeat like COBOL can't sneak back in.
const LANGUAGE_INDEX = new Map();
for (const cat of UNSUPPORTED_LANGUAGES) {
  for (const item of cat.items) {
    if (LANGUAGE_INDEX.has(item.name)) throw new Error(`Duplicate language: ${item.name}`);
    LANGUAGE_INDEX.set(item.name, { ...item, category: cat.title });
  }
}

// ---------------------------------------------------------------------------
// Extension -> language. Detection is by extension, except that .sh files and
// files with no extension are decided by their #! line (see SHEBANG_LANGUAGE).
// ---------------------------------------------------------------------------
const langByExt = {
  // Systems / native
  swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', mm: 'Objective-C', zig: 'Zig',
  nim: 'Nim', nims: 'Nim', cr: 'Crystal', d: 'D',
  asm: 'Assembly (any ISA)', s: 'Assembly (any ISA)',
  glsl: 'GLSL', vert: 'GLSL', frag: 'GLSL', geom: 'GLSL', comp: 'GLSL',
  hlsl: 'HLSL', fx: 'HLSL', shader: 'ShaderLab', cu: 'CUDA', cuh: 'CUDA',
  // Functional
  hs: 'Haskell', lhs: 'Haskell', ml: 'OCaml', mli: 'OCaml', fsx: 'F#', fsi: 'F#',
  clj: 'Clojure', cljc: 'Clojure', cljs: 'ClojureScript', ex: 'Elixir', exs: 'Elixir',
  erl: 'Erlang', hrl: 'Erlang', scm: 'Scheme', ss: 'Scheme',
  lisp: 'Common Lisp', lsp: 'Common Lisp', asd: 'Common Lisp', rkt: 'Racket',
  elm: 'Elm', purs: 'PureScript', re: 'ReasonML', rei: 'ReasonML',
  gleam: 'Gleam', idr: 'Idris',
  // Data / scientific
  r: 'R', jl: 'Julia', sas: 'SAS', ado: 'Stata', do: 'Stata',
  nb: 'Mathematica', wl: 'Wolfram Language', wls: 'Wolfram Language',
  // Legacy / enterprise
  vb: 'VB.NET', bas: 'Visual Basic', frm: 'Visual Basic', pas: 'Object Pascal',
  dpr: 'Delphi', adb: 'Ada', ads: 'Ada', f: 'Fortran', for: 'Fortran',
  f90: 'Fortran', f95: 'Fortran', f03: 'Fortran', cbl: 'COBOL', cob: 'COBOL',
  cobol: 'COBOL', pls: 'PL/SQL', plb: 'PL/SQL', pck: 'PL/SQL', abap: 'ABAP',
  trigger: 'Apex',
  // Scripting (beyond Bash)
  ps1: 'PowerShell', psm1: 'PowerShell', psd1: 'PowerShell', bat: 'Batch/CMD',
  cmd: 'Batch/CMD', fish: 'Fish', zsh: 'Zsh', ksh: 'Ksh', tcl: 'Tcl',
  awk: 'Awk', sed: 'Sed', pm: 'Perl', groovy: 'Groovy', gradle: 'Groovy',
  // Web / query / other
  sql: 'SQL (any dialect)', sol: 'Solidity', vy: 'Vyper', move: 'Move',
  cairo: 'Cairo', pro: 'Prolog', st: 'Smalltalk', fth: 'Forth', '4th': 'Forth',
  forth: 'Forth', html: 'HTML', htm: 'HTML', css: 'CSS', xml: 'XML',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown',
  graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protocol Buffers',
};

// Extensions shared by two or more unsupported languages. We say so instead of guessing.
const ambiguousByExt = {
  m: 'Objective-C or MATLAB',
  pl: 'Perl or Prolog',
  v: 'V or Verilog',
  cl: 'OpenCL C or Common Lisp',
  fs: 'F# or GLSL',
  cls: 'Apex or Visual Basic',
};

const LANG_BY_EXT = new Map(Object.entries(langByExt));
const AMBIGUOUS_BY_EXT = new Map(
  Object.entries(ambiguousByExt).map(([ext, label]) => [ext, { label, reason: REASON.parser }]),
);

// Interpreter named in a #! line -> language (only consulted for .sh and extensionless files)
const SHEBANG_LANGUAGE = new Map(Object.entries({
  sh: 'Bash', bash: 'Bash', zsh: 'Zsh', fish: 'Fish', ksh: 'Ksh', mksh: 'Ksh', pdksh: 'Ksh',
  python: 'Python', node: 'JavaScript', nodejs: 'JavaScript', ruby: 'Ruby', php: 'PHP',
  lua: 'Lua', luajit: 'Lua', perl: 'Perl', pwsh: 'PowerShell', powershell: 'PowerShell',
  awk: 'Awk', gawk: 'Awk', mawk: 'Awk', nawk: 'Awk', sed: 'Sed',
  tclsh: 'Tcl', wish: 'Tcl', groovy: 'Groovy',
}));

// ---------------------------------------------------------------------------
// Supported extensions, with caveats where support is partial
// ---------------------------------------------------------------------------
const CAVEATS = {
  typescript: 'Heavily generic or conditional types may reduce rule accuracy.',
  jsx: 'Parsed as JavaScript; JSX-specific patterns are not checked.',
  bash: 'Supported for Semgrep patterns only; not a full shell parser.',
  class: 'Metadata and embedded strings only; no decompilation.',
  luac: 'Header and embedded strings only; no disassembly.',
};

const supportedByExt = {
  lua: { language: 'Lua' },
  luau: { language: 'Luau' },
  luac: { language: 'Lua', caveats: [CAVEATS.luac], binary: true },
  py: { language: 'Python' }, pyw: { language: 'Python' },
  js: { language: 'JavaScript' }, mjs: { language: 'JavaScript' }, cjs: { language: 'JavaScript' },
  jsx: { language: 'JavaScript', caveats: [CAVEATS.jsx] },
  ts: { language: 'TypeScript', caveats: [CAVEATS.typescript] },
  mts: { language: 'TypeScript', caveats: [CAVEATS.typescript] },
  cts: { language: 'TypeScript', caveats: [CAVEATS.typescript] },
  tsx: { language: 'TypeScript', caveats: [CAVEATS.jsx, CAVEATS.typescript] },
  java: { language: 'Java' },
  class: { language: 'Java', caveats: [CAVEATS.class], binary: true },
  c: { language: 'C' },
  h: { language: 'C or C++' },
  cpp: { language: 'C++' }, cc: { language: 'C++' }, cxx: { language: 'C++' },
  hpp: { language: 'C++' }, hh: { language: 'C++' }, hxx: { language: 'C++' },
  rs: { language: 'Rust' },
  sh: { language: 'Bash', caveats: [CAVEATS.bash] },
  bash: { language: 'Bash', caveats: [CAVEATS.bash] },
  go: { language: 'Go' },
  php: { language: 'PHP' },
  rb: { language: 'Ruby' },
  cs: { language: 'C#' },
  dart: { language: 'Dart' },
  scala: { language: 'Scala' }, sc: { language: 'Scala' },
};
const SUPPORTED_BY_EXT = new Map(Object.entries(supportedByExt));

// Shown on /unsupported under "Partially supported"
const PARTIAL = [
  { name: 'TypeScript', note: 'Supported, but heavily generic or conditional types may reduce rule accuracy.' },
  { name: 'JSX / TSX', note: 'Parsed as JavaScript; JSX-specific patterns are not checked.' },
  {
    name: 'Bash',
    note:
      'Supported for Semgrep patterns only; not a full shell parser. We read the #! line of .sh ' +
      'files and of files with no extension, so a script that starts with #!/bin/zsh is rejected ' +
      'as Zsh even if it is named .sh.',
  },
  { name: 'Java .class', note: 'Metadata and embedded strings only; no decompilation.' },
  { name: '.luac / LuaJIT', note: 'Header and embedded strings only; no disassembly.' },
];

// ---------------------------------------------------------------------------
// Unsupported file types
// ---------------------------------------------------------------------------
const FILE_TYPES = [
  {
    id: 'executables', title: 'Executables and libraries',
    exts: ['exe', 'dll', 'so', 'dylib', 'msi', 'elf', 'bin'],
    reason: 'Compiled machine code. We do not analyze native binaries.',
  },
  {
    id: 'archives', title: 'Archives',
    exts: ['zip', 'rar', '7z', 'tar', 'gz', 'iso'],
    reason: 'We do not unpack archives. Upload the source file inside instead.',
  },
  {
    id: 'packages', title: 'Mobile and platform packages',
    exts: ['apk', 'ipa', 'xapk', 'aab', 'dex'],
    reason: 'Packaged apps are not unpacked, decompiled or disassembled.',
  },
  {
    id: 'python-bytecode', title: 'Compiled Python',
    exts: ['pyc', 'pyo'],
    reason: 'Bytecode. We do not disassemble or decompile.',
  },
  {
    id: 'roblox-places', title: 'Compiled Roblox places',
    exts: ['rbxl', 'rbxlx'],
    reason: 'Version 1 does not unpack places.',
  },
  {
    id: 'documents', title: 'Macro documents and PDFs',
    exts: ['docm', 'xlsm', 'pdf'],
    reason: 'Not a source file. We do not extract macros or document contents.',
  },
];
for (const t of FILE_TYPES) t.exts.sort();

const TYPE_BY_EXT = new Map();
for (const t of FILE_TYPES) for (const ext of t.exts) TYPE_BY_EXT.set(ext, t);

// ---------------------------------------------------------------------------
// The rest of /unsupported
// ---------------------------------------------------------------------------
const ANALYSIS_NOT_PERFORMED = [
  { title: 'No execution', text: 'No running, interpreting, emulating, sandboxing or debugging. No dynamic analysis. No API simulation. Ever.' },
  { title: 'No fetching', text: 'URLs in code are reported as strings. We never request them.' },
  { title: 'No deobfuscation', text: 'Obfuscated code is reported as “obfuscated — cannot be reviewed”, never unpacked.' },
  { title: 'No bundle reconstruction', text: 'Minified files are flagged as low-reviewability, not beautified and audited.' },
  { title: 'No bytecode disassembly or decompilation', text: 'Compiled code is never turned back into source.' },
  { title: 'No native binary analysis', text: 'PE and ELF imports, packing and similar checks are out of scope.' },
  { title: 'No Minecraft client scanning', text: 'The Java checklist is human instructions linking to third-party tools.' },
  { title: 'No Roblox platform integration', text: 'No Studio automation, no Roblox API calls, no game joining.' },
  { title: 'No ToS or “will I get banned” answers', text: 'We report code patterns only.' },
  { title: 'No malware-family attribution', text: 'Patterns, not campaigns.' },
];

const FEATURES_NOT_OFFERED = [
  'Batch upload', 'Public API', 'Accounts', 'History', 'File hosting',
  'Sharing links', 'Script library', 'Real-time monitoring', 'Browser extension',
];

const NO_BADGE =
  'No “verified clean” badge, certification or safety guarantee — in any form, at any tier, ever.';

const REFUSE_TO_CLAIM = [
  { claim: 'That a script is safe', instead: 'We only say “no known patterns detected”.' },
  { claim: 'That a scan is complete', instead: 'We only say “checked against our current rule set”.' },
  { claim: 'That a clean result means the script is trustworthy', instead: 'A clean result is the absence of known patterns, nothing more.' },
  { claim: 'That our rules are exhaustive', instead: 'Static patterns are evadable by design.' },
  { claim: 'That we can identify intent', instead: 'We only report observable code patterns.' },
];

// ---------------------------------------------------------------------------
// Load-time sanity checks (cheap, and they catch typos in the tables above)
// ---------------------------------------------------------------------------
for (const [ext, name] of LANG_BY_EXT) {
  if (!LANGUAGE_INDEX.has(name)) throw new Error(`.${ext} maps to unknown language "${name}"`);
  if (SUPPORTED_BY_EXT.has(ext) || AMBIGUOUS_BY_EXT.has(ext) || TYPE_BY_EXT.has(ext)) {
    throw new Error(`.${ext} is claimed by more than one table`);
  }
}
for (const [ext] of AMBIGUOUS_BY_EXT) {
  if (SUPPORTED_BY_EXT.has(ext) || TYPE_BY_EXT.has(ext)) throw new Error(`.${ext} is claimed twice`);
}
for (const [interp, name] of SHEBANG_LANGUAGE) {
  if (!SUPPORTED.includes(name) && !LANGUAGE_INDEX.has(name)) {
    throw new Error(`#! "${interp}" maps to unknown language "${name}"`);
  }
}

module.exports = {
  MAX_BYTES,
  SUPPORTED,
  ONE_LINER,
  UNSUPPORTED_LANGUAGES,
  LANGUAGE_INDEX,
  LANG_BY_EXT,
  AMBIGUOUS_BY_EXT,
  SHEBANG_LANGUAGE,
  SUPPORTED_BY_EXT,
  CAVEATS,
  PARTIAL,
  FILE_TYPES,
  TYPE_BY_EXT,
  ANALYSIS_NOT_PERFORMED,
  FEATURES_NOT_OFFERED,
  NO_BADGE,
  REFUSE_TO_CLAIM,
};
