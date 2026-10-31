# OddlyClever PDF: our spec (clean room)

Built with the reverse engineering method. The research is in `../research_notes/PDF_TOOLS_RE_2026-10-31.md`.
We copy what rivals do (the workflows people know). We never copy their code, assets, names or look.

## Promise (the gaps rivals leave)
1. **Free with no catch.** No sign-up, no watermark, no daily task cap, no file-size cap beyond the device, and no paywall at download.
2. **Private.** Files never leave the device. Everything runs in the browser and works offline once loaded (a PWA).
3. **Works anywhere.** Phone, tablet and desktop, with touch first: pinch zoom, a bottom toolbelt and big targets. Scan with the phone camera to PDF.
4. **Bring your own AI.** Any provider: Claude, OpenAI-compatible (OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek…), local (Ollama, LM Studio), or "paste into any chat" with no key. The AI **acts**: it edits text, fills forms, highlights, redacts, reorganises pages, summarises and translates, and every change can be undone.
5. **Honest redaction.** Redacted pages are flattened, and the app re-reads the output to prove the text is gone.
6. **Convert to anything.** PDF to Word, Excel, PowerPoint, text, Markdown, HTML, images and more. Anything to PDF: images, Word, text, Markdown, HTML, spreadsheets and slides. Free OCR in many languages.
7. **Beginner friendly and fun.** Start from "What do you want to do?", plain words, no jargon, a friendly mascot (Sparks), and paper-and-sticker animations.

## Feature list (v0.1)
- **Open:** PDF (with a password if needed), images, DOCX, TXT/MD, HTML, CSV/XLSX, PPTX and SVG. Drop, pick, paste or use the camera. Several files merge into one document.
- **View:** smooth scrolling, lazy rendering, zoom, fit width, pinch, search, thumbnails.
- **Edit:** add text, edit existing text (cover and retype in a matched font), images, draw, highlight, underline, strike, shapes, arrows, whiteout, sticky notes, stamps, checkmarks, signatures (draw, type or upload, then saved), date.
- **Pages:** organise (drag to reorder, rotate, delete, duplicate, insert blank or from file), extract, split, merge, crop.
- **Document:** compress, watermark, page numbers, header/footer, protect with a password, unlock, redact, flatten, metadata.
- **Forms:** fill AcroForm fields, then keep them fillable or flatten them.
- **Convert:** see the promise above.
- **AI:** chat with the PDF, plus edit by asking.
- **Save:** download, share (the phone share sheet), autosave and restore, and recent files (kept on the device).

## Not in v0.1
Cloud sync, e-sign requests to others, true reflow of the original text (we cover and retype instead), and PDF/A validation.
