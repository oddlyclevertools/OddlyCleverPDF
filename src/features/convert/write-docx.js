// Blocks -> .docx with the `docx` package (loaded on demand by the caller).
import { runsText } from "./ir.js";

const FONT = { sans: "Arial", serif: "Times New Roman", mono: "Courier New", hand: "Comic Sans MS", script: "Brush Script MT" };
const pxOf = (pt) => Math.max(1, Math.round((pt * 96) / 72));
const png = (data) => (data[0] === 0x89 ? "png" : data[0] === 0xff ? "jpg" : data[0] === 0x47 ? "gif" : "png");

/**
 * pages: [{ w, h, margin?, blocks }]  (one Word section per PDF page, so page breaks stay put)
 * opts: { title }
 */
export async function buildDocx(pages, { title = "Document", body = 11 } = {}) {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, LevelFormat, ImageRun } = d;
  const numbering = [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }];
  let numN = 0;
  const HEAD = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  const runsOf = (runs, extra = {}) => runs.filter((r) => r.t).flatMap((r) => {
    const o = {
      bold: !!r.b, italics: !!r.i, font: r.code ? "Courier New" : FONT[r.fam] || undefined,
      size: r.sz ? Math.max(2, Math.round(r.sz * 2)) : undefined, color: r.color, ...extra,
    };
    return String(r.t).split("\n").flatMap((part, i) => [new TextRun({ ...o, text: part, break: i ? 1 : 0 })]);
  });

  const sections = pages.map((pg) => {
    const margin = Math.round((pg.margin ?? 54) * 20);
    const innerW = Math.max(100, pg.w - 2 * (pg.margin ?? 54));
    const children = [];
    for (const b of pg.blocks) {
      if (b.type === "heading") children.push(new Paragraph({ heading: HEAD[Math.min(6, b.level)], alignment: b.align === "center" ? AlignmentType.CENTER : undefined, children: runsOf(b.runs) }));
      else if (b.type === "p") children.push(new Paragraph({ alignment: b.align === "center" ? AlignmentType.CENTER : undefined, spacing: { after: 120 }, children: runsOf(b.runs) }));
      else if (b.type === "list") {
        let ref = "bul";
        if (b.ordered) { ref = `num${++numN}`; numbering.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }); }
        for (const it of b.items) children.push(new Paragraph({ numbering: { reference: ref, level: 0 }, children: runsOf(it) }));
      } else if (b.type === "code") {
        for (const l of String(b.text).split("\n")) children.push(new Paragraph({ children: [new TextRun({ text: l, font: "Courier New", size: 20 })] }));
      } else if (b.type === "table" && b.rows.length) {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const edge = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
        const borders = { top: edge, bottom: edge, left: edge, right: edge };
        const cw = Math.floor((innerW * 20) / cols);
        children.push(new Table({
          width: { size: cw * cols, type: WidthType.DXA }, columnWidths: Array(cols).fill(cw),
          rows: b.rows.map((r, ri) => new TableRow({
            tableHeader: ri === 0 && !!b.header,
            children: Array.from({ length: cols }, (_, ci) => new TableCell({
              borders, width: { size: cw, type: WidthType.DXA },
              children: [new Paragraph({ children: runsOf(r[ci] || [], ri === 0 && b.header ? { bold: true } : {}) })],
            })),
          })),
        }));
        children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
      } else if (b.type === "image") {
        const k = Math.min(1, innerW / b.w);
        children.push(new Paragraph({ children: [new ImageRun({ type: png(b.data), data: b.data, transformation: { width: pxOf(b.w * k), height: pxOf(b.h * k) } })] }));
      }
    }
    if (!children.length) children.push(new Paragraph({ children: [] }));
    return { properties: { page: { size: { width: Math.round(pg.w * 20), height: Math.round(pg.h * 20) }, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children };
  });
  const doc = new Document({ title, creator: "OddlyClever PDF", numbering: { config: numbering }, sections, styles: { default: { document: { run: { font: "Arial", size: Math.round(body * 2) } } } } });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

/**
 * "Exact look": each page is a picture behind the text. The text is kept as real, 1 pt white
 * words, so Word's search and copy still find it.
 * pages: [{ w, h, png: Uint8Array, text: string }]
 */
export async function buildDocxExact(pages, { title = "Document" } = {}) {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, ImageRun, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType } = d;
  const sections = pages.map((pg) => {
    const children = [new Paragraph({
      spacing: { after: 0, line: 20 },
      children: [new ImageRun({
        type: "png", data: pg.png, transformation: { width: pxOf(pg.w), height: pxOf(pg.h) },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
          behindDocument: true, allowOverlap: true, wrap: { type: TextWrappingType.NONE },
        },
      })],
    })];
    for (const line of String(pg.text || "").split("\n")) {
      if (line.trim()) children.push(new Paragraph({ spacing: { after: 0, before: 0, line: 20 }, children: [new TextRun({ text: line, size: 2, color: "FFFFFF" })] }));
    }
    return { properties: { page: { size: { width: Math.round(pg.w * 20), height: Math.round(pg.h * 20) }, margin: { top: 0, bottom: 0, left: 0, right: 0 } } }, children };
  });
  const doc = new Document({ title, creator: "OddlyClever PDF", sections });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
export { runsText };
