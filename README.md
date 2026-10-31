# OddlyClever PDF

A free PDF editor that runs in your browser, on phones and computers alike. Your files never leave your device.

- **Edit:** change the PDF's own words, add text, pictures, drawings, highlights, shapes, notes, whiteout and true redaction.
- **Sign and fill:** fill in forms, sign by drawing, typing or uploading, and add stamps, ticks and dates.
- **Pages:** merge, split, reorder, rotate, delete, crop, compress, watermark, page numbers and passwords.
- **Convert:** PDF to Word, Excel, PowerPoint, pictures, text, Markdown, HTML and more. Word, pictures, spreadsheets, slides, text and more to PDF. Text recognition (OCR) for scans, and camera scanning.
- **Bring your own AI:** connect Claude, OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek, a local model (Ollama, LM Studio), or paste into any chat with no key. The AI can summarise and explain, and it also edits: it fills forms, highlights, redacts, fixes text and reorganises pages. Every change can be undone.
- No sign-up, no watermark, no daily limits. Once installed, it works offline.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5185
npm test           # unit tests
npm run build      # static files in dist/ (host anywhere)
```

`node tools/copy_pdfjs.mjs` copies pdf.js's fonts and decoders into `public/pdfjs` (run it again after updating pdfjs-dist).
`node tools/smoke.mjs <port> <script.js> [fixture] [--phone] [--shot out.png]` runs a headless check in Chrome.

## How it's built

- `src/core`: the document model (`store.js`), pdf.js (`pdf.js`), opening files (`open.js`), saving (`export.js`), fonts and autosave.
- `src/viewer`: the page view and the edits drawn on it.
- `src/tools`: page tools (select, text, edit text, draw, highlight, shapes…).
- `src/ui`: the frame, home screen, style bar, search and theme.
- `src/features/*`: the bigger features, each in its own folder (pages, convert, ai, forms). Each folder's `index.js` is installed automatically.
- `docs/SPEC.md` is what we're building and why. `docs/CONTRACT.md` is the API that features use.

See `THIRD_PARTY.md` for licences.
