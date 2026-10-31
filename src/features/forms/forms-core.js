// Fillable forms: the pure parts (widget geometry, reading pdf.js annotations, writing values
// into a pdf-lib form). No DOM here so the unit tests can run it in node.
import { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from "@cantoo/pdf-lib";

/** A widget rect in PDF user space -> page space (points, top-left origin, y down). */
export function widgetRect(rect, box) {
  const [ax, ay, bx, by] = rect;
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  return { x: x0 - box[0], y: box[3] - y1, w: x1 - x0, h: y1 - y0 };
}

/** What kind of control a pdf.js widget annotation is. */
export function widgetKind(a) {
  if (a.subtype !== "Widget") return null;
  if (a.checkBox) return "checkbox";
  if (a.radioButton) return "radio";
  if (a.pushButton) return "button";
  if (a.fieldType === "Sig") return "signature";
  if (a.fieldType === "Ch") return a.combo ? "dropdown" : "list";
  if (a.fieldType === "Tx") return "text";
  return null;
}

const hiddenFlag = (a) => ((a.annotationFlags || 0) & (2 | 32)) !== 0; // hidden, no-view

/** The widgets of one page as plain objects in page space. */
export function readWidgets(annots, box) {
  const out = [];
  for (const a of annots || []) {
    const kind = widgetKind(a);
    if (!kind || !a.fieldName || hiddenFlag(a) || !a.rect) continue;
    const r = widgetRect(a.rect, box);
    if (r.w < 2 || r.h < 2) continue;
    out.push({
      kind, name: a.fieldName, ...r,
      readOnly: !!a.readOnly,
      multiLine: !!a.multiLine, maxLen: a.maxLen || 0, comb: !!a.comb, password: !!a.password,
      multiSelect: !!a.multiSelect,
      align: ["left", "center", "right"][a.textAlignment || 0] || "left",
      fontSize: a.defaultAppearanceData?.fontSize || 0,
      buttonValue: a.buttonValue ?? a.exportValue ?? "",
      options: (a.options || []).map((o) => ({ value: String(o.exportValue ?? o.displayValue ?? ""), label: String(o.displayValue ?? o.exportValue ?? "") })),
      initial: initialValue(a, kind),
    });
  }
  // reading order, so Tab walks the form like a person would
  return out.sort((p, q) => (Math.abs(p.y - q.y) > 4 ? p.y - q.y : p.x - q.x));
}

function initialValue(a, kind) {
  const v = a.fieldValue;
  if (kind === "checkbox") return !!v && v !== "Off" && v !== "off";
  if (kind === "radio") return v == null ? "" : String(v);
  if (kind === "list") return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  if (kind === "dropdown") return Array.isArray(v) ? String(v[0] ?? "") : v == null ? "" : String(v);
  if (kind === "text") return Array.isArray(v) ? v.join("\n") : v == null ? "" : String(v);
  return "";
}

/** The fields people can fill: one entry per field name (radio groups count once). */
export function fillableFields(widgets) {
  const seen = new Map();
  for (const w of widgets) {
    if (w.readOnly || w.kind === "button" || w.kind === "signature") continue;
    if (!seen.has(w.name)) seen.set(w.name, w);
  }
  return [...seen.values()];
}

/** Is a value "empty" for the Next field helper? */
export const isEmptyValue = (v) => v == null || v === "" || v === false || (Array.isArray(v) && !v.length);

/**
 * Write values into a pdf-lib form. Missing fields and wrong types are skipped.
 * @returns {{ done: string[], skipped: string[] }}
 */
export function applyFormValues(form, values) {
  const done = [], skipped = [];
  for (const [name, value] of Object.entries(values || {})) {
    let f = null;
    try { f = form.getFieldMaybe(name); } catch { f = null; }
    if (!f) { skipped.push(name); continue; }
    try {
      if (f instanceof PDFTextField) { f.setText(value == null || value === "" ? undefined : String(value)); }
      else if (f instanceof PDFCheckBox) { value ? f.check() : f.uncheck(); }
      else if (f instanceof PDFRadioGroup) { if (value === "" || value == null) f.clear(); else f.select(String(value)); }
      else if (f instanceof PDFDropdown) { if (value === "" || value == null) f.clear(); else f.select(String(value)); }
      else if (f instanceof PDFOptionList) { const list = [].concat(value || []).map(String); if (list.length) f.select(list); else f.clear(); }
      else { skipped.push(name); continue; }
      done.push(name);
    } catch (e) { skipped.push(name); }
  }
  return { done, skipped };
}
