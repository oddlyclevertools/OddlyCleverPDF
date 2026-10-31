# OddlyClever PDF: the feature contract (v0.1)

Read `docs/SPEC.md` first. The core (`src/core`, `src/viewer`, `src/tools`, `src/ui`, `src/main.js`, `src/styles`) is **locked**: features don't edit it.
If you need a core change, write it in your final report instead.

## Where your code goes
- Your feature lives in **one folder**: `src/features/<name>/`. Its `index.js` must `export function install(app)`.
  `main.js` finds every `src/features/*/index.js` by itself, so don't touch main.js.
- Put CSS in your folder (`import "./x.css"` from index.js). Use the tokens in `src/styles/tokens.css`: `--card --card-2 --edge --text --muted --line --accent --gold --cyan --mint --violet --shadow-hard --shadow-lift --radius`. Never use raw colours for UI chrome. Every CSS class must start with your feature's prefix (for example `.pg-`, `.cv-`, `.ai-`, `.fs-`).
- UI helpers come from `src/ui/kit.js`: `el, icon (Lucide PascalCase), toast, modal, confirmDialog, slider, select, toggle, section, colorRow, popover`. Motion helpers: `src/ui/motion.js` (`stagger, play`) and the `oc-*` classes in `src/styles/motion.css`.
- Use **plain, friendly English** in the UI ("Squash the file size", not "Optimize object streams"). Write it beginner first, with buttons at least 40 px tall on phones and nothing that only works on hover.
- Tests: pure logic goes in `tests/unit/<name>.test.js` (vitest, `npm test`). For browser checks, use `node tools/smoke.mjs <port> <script.js> [fixture|none] [--phone] [--shot out.png]`, which runs your script with `app` in scope in headless system Chrome. Start your own dev server with `npx vite --port <yourport> --strictPort` in the background, and stop it when you're done. Fixtures are in `tests/fixtures/` (`sample.pdf` has 3 pages, text, and form fields name/agree/plan; `locked.pdf` has the password `open123`). Make more with a script in `tools/` if you need them.
- Licences: MIT, Apache-2.0, BSD or ISC only. Already installed: pdfjs-dist, @cantoo/pdf-lib (with encryption), @pdf-lib/fontkit, docx, mammoth, pptxgenjs, fflate, tesseract.js, lucide, @anthropic-ai/sdk. **Ask before adding a package** (put it in your report). Never use GPL, AGPL or LGPL code.
- No secrets in code, and no network calls except the user's own AI provider and the OCR language data download (with the user's OK).

## The model (`app.state`, `app.store`)
- `state.files: Map<fileId, { id, name, bytes: Uint8Array, password, pdf /* pdf.js doc */ }>`
- `state.pages: Page[]`, where `Page = { id, src: { fileId, index }, box: [x0,y0,x1,y1], w, h, rotate, objects: Obj[] }`.
  Page space is points, from the top-left, y going down, **unrotated**. Pdf user space is `(box[0] + x, box[3] - y)`.
- Edits (`Obj`) all have an `id` and a `type`:
  - `text {x,y,w,h,text,font: sans|serif|mono|hand|script,size,color,bold,italic,underline,align,lineHeight,bg?,cover?:{x,y,w,h,color}}`
  - `image {x,y,w,h,imageId,opacity}`, where the picture is `state.images.get(imageId)`, a PNG or JPEG data URL. Add one with `store.putImage(dataUrl)`.
  - `ink {strokes:[[[x,y]...]],color,width,opacity}`, `rect|ellipse {x,y,w,h,stroke,fill,width,opacity}`, `line|arrow {x1,y1,x2,y2,stroke,width}`
  - `highlight {rects:[{x,y,w,h}],color,style: highlight|underline|strike,opacity}`, `whiteout {x,y,w,h,color}`, `redact {x,y,w,h}`, `note {x,y,text,color}`
- `state.form` maps field names to values. `state.meta` holds `{title, author, subject, keywords}`. `state.extras[yourFeature]` is for your saved settings (it is in undo and autosave).
- **Changing the document:** `store.change(label, () => { mutate state })` makes one undo step. For drags, use `store.begin()`, mutate, `store.live(pageIds)`, then `store.end(label)`. Helpers: `addObject(pageId, obj, label)`, `updateObject(id, patch, label)`, `removeObjects(ids)`, `select(ids)`, `pageById`, `findObject(id)`, `shownSize(page)`, `uid()`.
- **Events:** `store.on(fn)` gets `{type}`: `doc` (new document), `change` (`{label, pages, undo}`), `live`, `select`, `tool`, `zoom`, `page` (the current page changed), `pages-built`, `exporters`.
- **Page order or rotation:** change `state.pages` inside `store.change(...)`. The viewer rebuilds by itself. New source files: `await app.addPdfBytes(bytes, name)` gives a file record, then `await app.pagesOf(rec)` gives Page[].

## Reading the document
- `app.pageLines(pageId)`: lines `{text, x,y,w,h, size, runs:[{str,x,y,w,h,size,family,bold,italic}]}` in page space.
- `app.pageString(pageId)`: the plain text.
- `app.pdf.pageToCanvas(pdfjsDoc, index, {width})`: a canvas of the original page, without our edits.
- `await app.outputPdf()` gives `{bytes, pdf}`: **exactly what Save makes** (with the edits, no password), opened in pdf.js and cached until the next change. Use it for page images, conversions and the AI's pictures.
- `app.currentPageId()`, `app.currentPageIndex()`, `app.viewer.scrollToPage(i)`, `app.viewer.viewOf(pageId)` (gives `{outer, sheet, canvas, objects}` on screen), `app.viewer.toPage(pageId, clientX, clientY)`.

## Plugging in
- `app.registerTask({ id, title, blurb, icon, color: pink|gold|cyan|mint|violet|orange, group: edit|pages|convert|secure|ai, popular?, order?, files: "none"|"one"|"many", accept?, usesOpenDoc?, run(app, files) })`: a card on the home screen and in Ctrl+K.
- `app.registerPanel({ id, title, label, icon, order, belt: true, accent?, render(box, opts) })`: a side panel (a bottom sheet on phones). Use `belt: true` to give it a button on the tool belt. Open it with `app.openPanel(id, opts)`.
- `app.registerTool({ id, label, icon, mode: "drag"|"tap", group: "edit", order, key, hint, down/move/up/cancel or tap })`: a page tool. `app.placeNext({ label, ghost?, make({pageId, pt}) })` places the next tap.
- `app.registerExportStep({ id, label, order, run(ctx) })` runs on every Save. `ctx = { doc /* pdf-lib PDFDocument */, pages: [{page, pdfPage}], font(family,bold,italic), lib /* pdf-lib exports */, opts, redactions: [{pageId, rect}], notes: string[] }`. Orders: 100 forms, 200 page content (watermark, numbers), 500 redaction, 900 security (id **must** be `"security"`). Push plain-English messages for the user into `ctx.notes`.
- `app.registerExporter({ id, label, ext, icon, group: "Documents"|"Spreadsheets"|"Slides"|"Images"|"Text & web"|"PDF", blurb, order, run(app, {progress, signal}) => {blob, filename} | [...] })`: a "Convert to" target. `app.exporters()` lists them.
- `app.registerImporter({ id, label, exts, mimes?, toPdf(file, {progress}) => Uint8Array })` opens a file type (the converter must make PDF bytes). Picture importing is in core (one picture becomes one page). You may register a better `image-basic` replacement.
- `app.registerLayer((page, view) => node | null)` adds a layer to every page sheet, sized to the sheet. Position children with `page space × state.zoom` px, and redraw on the `zoom` event.
- `app.registerStyleControls(({obj, tool, row}) => node | null)` adds controls to the style bar.
- `app.registerHomeSection({ id, order, render(app) => node })` adds a block to the home screen (order < 50 above the task cards, otherwise below).
- `app.registerCommands((app) => [{id,label,group,icon,keywords,run}])` adds Ctrl+K entries. `app.registerTopAction({id, order, render})` adds a top-bar button (use sparingly).
- **Long jobs:** `const b = app.busy("Squashing your PDF")`, then `b.set(0.5, "Pictures…")`, `b.done("Saved 2.1 MB")` (confetti) or `b.fail(err)`. `b.signal` is the Cancel signal.
- **Saving files for the user:** `app.deliver(bytesOrBlob, filename, {type, share})` and `app.outName(ext, suffix)`.
- `app.chooseFiles({multiple, accept})` resolves with File[]. `app.open(files, mode)` opens them (mode: "replace" | "append" | index).
