# VeriScript

VeriScript reads scripts and reports known patterns. It never runs them.

This build covers the **`/unsupported` page** and the **`POST /scan` rejection behavior** from the spec. The rules engine that actually looks for patterns is not built yet (see "Plugging in the scanner" below).

## What's a "stack"?

The set of tools a website is built with. This one is deliberately tiny:

- **Pages:** plain HTML, CSS and a little JavaScript. No framework.
- **Server:** Node.js, using only the modules that come with it. Nothing to install with `npm`.

## Run it

1. Install Node.js 18 or newer from https://nodejs.org (the "LTS" download is fine).
2. In a terminal, from this folder:

   ```
   node server.js
   ```

3. Open http://127.0.0.1:3000

Use another port with `PORT=8080 node server.js`. To check everything still works: `node --test`.

## What's where

| File | What it does |
| --- | --- |
| `lib/data.js` | Every list in the spec (supported languages, rejected languages, file types, "we don't do this", "we refuse to claim"). The pages and the scanner both read from here, so they can't disagree. **Edit this file to change what's supported.** |
| `lib/detect.js` | Works out what an uploaded file is, from its name and bytes only. Builds the `POST /scan` response. |
| `lib/pages.js` | Builds the home page and `/unsupported` from the data. |
| `server.js` | The web server and the `POST /scan` route. |
| `public/style.css`, `public/app.js` | Look and feel, and the upload box. |
| `test/scan.test.js` | Automated checks. |

## `POST /scan`

Send the raw file as the request body and the name as `?filename=`:

```
curl --data-binary @thing.swift "http://127.0.0.1:3000/scan?filename=thing.swift"
```

It **always** answers HTTP 200 with JSON, never a 4xx and never a stack trace.

```json
{
  "status": "unsupported",
  "detected_language": "Swift",
  "reason": "Outside our parser set",
  "see": "/unsupported#languages",
  "message": "VeriScript does not support Swift. See the full list of unsupported languages."
}
```

- Rejected **languages** carry `detected_language` and `"see": "/unsupported#languages"`.
- Rejected **file types** carry `detected_type` and `"see": "/unsupported#file-types"`, matching the link on the rejection card.
- Supported files answer `"status": "supported"` with `detected_language` and, for partial support, a `caveats` list.

## Decisions made where the spec was silent or inconsistent

- **COBOL** was listed twice; it appears once.
- **Alphabetical order** is applied in code, and a test checks it.
- **Reasons**: each language gets one of the spec's three phrases. Assembly and SQL get "no reliable static patterns". HTML, CSS, XML, JSON, YAML, Markdown, GraphQL and Protocol Buffers get "not a source language". Everything else gets "outside our parser set".
- **Over 2 MB** is rejected as a file type (`detected_type: "over 2 MB"`, link to `#file-types`). The browser doesn't upload the whole file in that case.
- **`.pdf`** was filed under "macro documents" in the spec. It's grouped as "Macro documents and PDFs".
- **`.class` and `.luac`** are accepted (partial support), not rejected, so they are not in the file-type list.
- **Bash vs other shells:** `.sh` files and files with no extension are decided by their `#!` line, so `#!/bin/zsh` in a `.sh` file is rejected as Zsh. Every other extension is decided by the extension.
- **JSX/TSX** are detected by extension, with the caveat from the spec.
- **Shared extensions** (`.m`, `.pl`, `.v`, `.cl`, `.fs`, `.cls`) belong to two unsupported languages each, so they're reported as "X or Y" rather than guessed.
- **Binary files renamed to look like source** (a `.exe` renamed `.py`, a zip renamed `.lua`) are rejected by their contents. Any "text" language containing NUL bytes is rejected as binary data.
- **Files we can't identify** (unknown extension, no extension, no recognised `#!` line) are rejected, not guessed at.

## Plugging in the scanner

Right now a supported file gets this answer: the language is supported, but the rules engine isn't connected, so nothing was analyzed. That is deliberate: the app must not imply a scan happened when it didn't.

To connect a real engine, call it in `server.js` inside `handleScan`, only when `detect()` returns `status: "supported"`. Keep the spec's rules: report only "no known patterns detected" or "checked against our current rule set", never "safe", "clean" or "verified".

Note that `POST /scan` is this site's own endpoint for its upload box. It is not a public API (the spec says none is offered in v1).
