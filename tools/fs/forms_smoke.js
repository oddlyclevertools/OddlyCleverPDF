// forms: fill name/agree/plan in the live inputs, Save, re-open with pdf-lib.
await new Promise((r) => setTimeout(r, 1200));
const out = {};
const q = (n) => document.querySelector(`.fs-box[data-field="${n}"] input, .fs-box[data-field="${n}"] select`);
out.layers = document.querySelectorAll(".fs-box").length;
out.banner = document.querySelector(".fs-banner")?.textContent.trim().slice(0, 60);
const name = q("name"), agree = q("agree"), plan = q("plan");
out.found = [!!name, !!agree, !!plan];
const r = name.getBoundingClientRect();
out.nameBox = [Math.round(r.width), Math.round(r.height)];
name.focus(); name.value = "Ada Lovelace"; name.dispatchEvent(new Event("input", { bubbles: true })); name.dispatchEvent(new Event("change", { bubbles: true })); name.blur();
agree.click();
plan.value = "Pro"; plan.dispatchEvent(new Event("change", { bubbles: true }));
out.form = JSON.stringify(app.state.form);
// zoom change keeps position
app.viewer.zoomBy(1.5);
await new Promise((r) => setTimeout(r, 300));
const r2 = q("name").getBoundingClientRect();
out.zoomRatio = +(r2.width / r.width).toFixed(2);
// undo steps: 3 edits -> undo once removes the plan only
app.store.undo();
out.afterUndo = JSON.stringify(app.state.form);
app.store.redo();
const { bytes } = await app.buildPdf();
const doc = await app.pdfLib.PDFDocument.load(bytes);
const f = doc.getForm();
out.saved = { name: f.getTextField("name").getText(), agree: f.getCheckBox("agree").isChecked(), plan: f.getDropdown("plan").getSelected() };
app.state.extras.forms = { flatten: true };
const flat = await app.buildPdf();
out.flatFields = (await app.pdfLib.PDFDocument.load(flat.bytes)).getForm().getFields().length;
return out;
