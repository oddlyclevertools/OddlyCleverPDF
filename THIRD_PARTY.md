# Third-party parts

OddlyClever PDF uses these open-source parts. All of them allow commercial use.

| Part | Use | Licence |
|---|---|---|
| pdf.js (`pdfjs-dist`), with its cmaps, standard fonts, ICC profiles and wasm decoders (OpenJPEG, JBIG2, QCMS, QuickJS) | showing PDFs and reading their text | Apache-2.0 (the decoders' own BSD/MIT/Apache licences are in `public/pdfjs/wasm/LICENSE_*`) |
| `@cantoo/pdf-lib` (a pdf-lib fork with encryption) | writing PDFs | MIT |
| `@pdf-lib/fontkit` | embedding fonts, and reading Inter when rebuilding a PDF's own font | MIT |
| `docx` | Word export | MIT |
| `mammoth` | Word import | BSD-2-Clause |
| `pptxgenjs` | PowerPoint export | MIT |
| `fflate` | zip files | MIT |
| `tesseract.js` | reading text in scans (OCR) | Apache-2.0 |
| `@anthropic-ai/sdk` | Claude connection (bring your own key) | MIT |
| `lucide` | icons | ISC |
| Inter, Merriweather, Roboto Mono, Caveat, Dancing Script (TTF files from `@expo-google-fonts/*`) | text in the app and in saved PDFs | SIL Open Font License 1.1 |
| `vite`, `vitest`, `@playwright/test` | building and testing | MIT / Apache-2.0 |

The Oddly Clever brand art in `public/brand/` (Sparks and the avatar) belongs to its owner, all rights reserved. It is not covered by the project licence. Forks must remove or replace it.
