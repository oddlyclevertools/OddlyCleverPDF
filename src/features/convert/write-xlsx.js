// Our own minimal XLSX writer (OOXML zipped with fflate) and the CSV writer.
// sheets: [{ name, rows: [[cell]] }] where cell is a string, a number, null, or { v, bold }.
import { zipSync, strToU8 } from "fflate";
import { esc, xmlSafe } from "./ir.js";

const NUM = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
/** "1,234.50" -> 1234.5; anything that isn't clearly a number stays text (zip codes, ids, 007). */
export function asNumber(s) {
  if (typeof s === "number") return s;
  const t = String(s).trim();
  if (!NUM.test(t)) return null;
  const plain = t.replace(/,/g, "");
  if (/^[-+]?0\d/.test(plain)) return null;
  if (plain.replace(/[-+.]/g, "").length > 15) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

const CURRENCY = ["£", "$", "€"];
/** "£1,234.50" -> { n: 1234.5, sym: "£" }; anything else -> null. Money stays a number you can add up. */
export function asMoney(s) {
  if (typeof s !== "string") return null;
  const m = /^(-)?\s*([£$€])\s*(.+)$/.exec(s.trim());
  if (!m) return null;
  const n = asNumber(m[3]);
  return n == null ? null : { n: m[1] ? -n : n, sym: m[2] };
}

export function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

const safeSheetName = (n, used) => {
  let base = String(n || "Sheet").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Sheet";
  let name = base, k = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 25)} ${k++}`;
  used.add(name.toLowerCase());
  return name;
};

export function buildXlsx(sheets) {
  if (!sheets.length) sheets = [{ name: "Sheet1", rows: [[""]] }];
  const strings = [], index = new Map();
  const sst = (s) => { if (!index.has(s)) { index.set(s, strings.length); strings.push(s); } return index.get(s); };
  const used = new Set();
  const files = {};
  const names = sheets.map((s) => safeSheetName(s.name, used));
  sheets.forEach((sh, si) => {
    const widths = [];
    const rows = sh.rows.map((row, ri) => {
      const cells = row.map((c, ci) => {
        if (c == null || c === "") return "";
        const bold = typeof c === "object" && c.bold;
        const v = typeof c === "object" ? c.v : c;
        const ref = `${colName(ci)}${ri + 1}`;
        const style = bold ? ' s="1"' : "";
        const n = asNumber(v), money = n == null ? asMoney(v) : null;
        widths[ci] = Math.max(widths[ci] || 6, Math.min(60, String(v).length + 2));
        if (n != null) return `<c r="${ref}"${style}><v>${n}</v></c>`;
        // styles 2-4: £ $ € money, 5-7: the same in bold (see styles.xml below)
        if (money) return `<c r="${ref}" s="${2 + CURRENCY.indexOf(money.sym) + (bold ? 3 : 0)}"><v>${money.n}</v></c>`;
        return `<c r="${ref}" t="s"${style}><v>${sst(xmlSafe(String(v)))}</v></c>`;
      }).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`);
  });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  files["[Content_Types].xml"] = strToU8(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`);
  files["_rels/.rels"] = strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(`${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n).replace(/"/g, "&quot;")}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(`${head}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;£&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="&quot;€&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`);
  files["xl/sharedStrings.xml"] = strToU8(`${head}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  return zipSync(files, { level: 6 });
}

const csvCell = (c) => {
  const v = c == null ? "" : typeof c === "object" ? c.v : c;
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV with a byte-order mark so Excel reads accents correctly. */
export function buildCsv(rows) {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
