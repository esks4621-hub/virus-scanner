'use strict';

/**
 * Decides what a file is, using only its name and its bytes. Nothing here
 * runs, fetches or unpacks anything. Returns the JSON body for POST /scan.
 *
 * Order of checks:
 *   1. Over 2 MB                      -> unsupported file type
 *   2. Extension is an unsupported file type (.exe, .zip, ...)
 *   3. Contents are a known binary format (PE, ELF, zip, PDF, ...)
 *   4. Language: #! line for .sh / extensionless files, otherwise the extension
 *   5. Anything we can't place is rejected, not guessed at
 */

const path = require('node:path');
const D = require('./data');

const SEE_LANGUAGES = '/unsupported#languages';
const SEE_FILE_TYPES = '/unsupported#file-types';
const MAX_LABEL = `${D.MAX_BYTES / (1024 * 1024)} MB`;

// What a clean "supported" answer says while the rules engine is not plugged in.
const ENGINE_NOTE =
  'This language is supported, but the rules engine is not connected in this build, ' +
  'so nothing was analyzed.';

function extOf(filename) {
  const base = path.basename(String(filename || '').replace(/\\/g, '/'));
  const i = base.lastIndexOf('.');
  if (i <= 0) return ''; // no extension, or a dotfile like .bashrc
  return base.slice(i + 1).toLowerCase();
}

/** Reads the interpreter named on a #! line, e.g. "#!/usr/bin/env zsh" -> "zsh". */
function shebangInterpreter(bytes) {
  if (!bytes || bytes.length < 3 || bytes[0] !== 0x23 || bytes[1] !== 0x21) return null;
  let end = bytes.indexOf(0x0a);
  if (end === -1 || end > 256) end = Math.min(bytes.length, 256);
  const parts = bytes.toString('latin1', 2, end).trim().split(/\s+/);
  let prog = path.basename(parts[0] || '');
  if (prog === 'env') {
    const rest = parts.slice(1).filter((p) => !p.startsWith('-') && !p.includes('='));
    prog = path.basename(rest[0] || '');
  }
  prog = prog.toLowerCase().replace(/[0-9.]+$/, ''); // python3.11 -> python, ksh93 -> ksh
  return prog || null;
}

// --- binary formats we recognise by content --------------------------------
const starts = (bytes, sig) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

function isWindowsExecutable(bytes) {
  if (bytes.length < 64 || !starts(bytes, [0x4d, 0x5a])) return false;
  const off = bytes.readUInt32LE(0x3c);
  return off + 4 <= bytes.length && bytes.toString('latin1', off, off + 4) === 'PE\0\0';
}

const MAGIC = [
  { label: 'Windows executable', a: 'a Windows executable', plural: 'Windows executables', test: isWindowsExecutable },
  { label: 'ELF binary', a: 'an ELF binary', plural: 'ELF binaries', test: (b) => starts(b, [0x7f, 0x45, 0x4c, 0x46]) },
  {
    label: 'Mach-O binary', a: 'a Mach-O binary', plural: 'Mach-O binaries',
    test: (b) => [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe]].some((s) => starts(b, s)),
  },
  { label: 'zip-format archive', a: 'a zip-format archive', plural: 'zip-format archives', test: (b) => starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06]) },
  { label: 'PDF document', a: 'a PDF document', plural: 'PDF documents', test: (b) => starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  { label: 'gzip archive', a: 'a gzip archive', plural: 'gzip archives', test: (b) => starts(b, [0x1f, 0x8b]) },
];

// --- result builders --------------------------------------------------------
function rejectType({ detectedType, what, reason, extra }) {
  return {
    status: 'unsupported',
    detected_type: detectedType,
    reason,
    see: SEE_FILE_TYPES,
    message: `VeriScript does not support ${what}. See the full list of unsupported file types.`,
    ...extra,
  };
}

function rejectLanguage({ label, reason, from }) {
  return {
    status: 'unsupported',
    detected_language: label,
    reason,
    see: SEE_LANGUAGES,
    message: `VeriScript does not support ${label}. See the full list of unsupported languages.`,
    detected_from: from,
  };
}

function rejectUnknown(ext) {
  return {
    status: 'unsupported',
    detected_type: ext ? `.${ext}` : 'no extension',
    reason: "We couldn't tell which language this is, and we don't guess.",
    see: SEE_LANGUAGES,
    message: "VeriScript does not support this file type. See the full list of unsupported languages.",
  };
}

function accept({ language, from, caveats }) {
  const out = { status: 'supported', detected_language: language, detected_from: from, note: ENGINE_NOTE };
  if (caveats && caveats.length) out.caveats = caveats;
  return out;
}

// --- main -------------------------------------------------------------------
/**
 * @param {{filename?: string, bytes?: Buffer, size?: number}} input
 *   bytes may be only the start of the file when it was too big to read;
 *   size is the full size in bytes.
 */
function detect({ filename, bytes, size } = {}) {
  const head = bytes || Buffer.alloc(0);
  const total = Number.isFinite(size) ? size : head.length;
  const ext = extOf(filename);

  // 1. Size
  if (total > D.MAX_BYTES) {
    return rejectType({
      detectedType: `over ${MAX_LABEL}`,
      what: `files over ${MAX_LABEL}`,
      reason: `Files over ${MAX_LABEL} are not scanned.`,
      extra: { size_bytes: total },
    });
  }

  // 2. Extension is a rejected file type
  const typeRule = D.TYPE_BY_EXT.get(ext);
  if (typeRule) {
    return rejectType({ detectedType: `.${ext}`, what: `.${ext} files`, reason: typeRule.reason });
  }

  // 3. Contents are a rejected binary format, whatever the name says
  const magic = MAGIC.find((m) => m.test(head));
  if (magic) {
    return rejectType({
      detectedType: magic.label,
      what: magic.plural,
      reason: `The contents identify this file as ${magic.a}, not source code.`,
    });
  }

  // 4. Language
  let language = null;
  let from = 'extension';
  const shellish = ext === '' || ext === 'sh' || ext === 'bash';
  if (shellish) {
    const interp = shebangInterpreter(head);
    if (interp && D.SHEBANG_LANGUAGE.has(interp)) {
      language = D.SHEBANG_LANGUAGE.get(interp);
      from = 'shebang';
    }
  }

  if (language) {
    const entry = D.LANGUAGE_INDEX.get(language);
    if (entry) return rejectLanguage({ label: entry.label, reason: entry.reason, from });
    const caveats = language === 'Bash' ? [D.CAVEATS.bash] : [];
    return finish({ language, from, caveats, binary: false, head });
  }

  const ambiguous = D.AMBIGUOUS_BY_EXT.get(ext);
  if (ambiguous) return rejectLanguage({ label: ambiguous.label, reason: ambiguous.reason, from });

  const rejected = D.LANG_BY_EXT.get(ext);
  if (rejected) {
    const entry = D.LANGUAGE_INDEX.get(rejected);
    return rejectLanguage({ label: entry.label, reason: entry.reason, from });
  }

  const supported = D.SUPPORTED_BY_EXT.get(ext);
  if (supported) {
    return finish({ language: supported.language, from, caveats: supported.caveats, binary: !!supported.binary, head });
  }

  // 5. Not placed anywhere: rejected, not guessed at
  return rejectUnknown(ext);
}

/** Last gate before accepting: a "text" language must actually look like text. */
function finish({ language, from, caveats, binary, head }) {
  if (!binary && head.subarray(0, 8000).includes(0)) {
    return rejectType({
      detectedType: 'binary data',
      what: 'binary files',
      reason: 'This file contains binary data, not source code.',
    });
  }
  return accept({ language, from, caveats });
}

module.exports = { detect, extOf, shebangInterpreter, MAX_LABEL };
