// Make the test PDFs: a 3-page letter with text, a fillable form, and a locked copy.
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { writeFileSync } from "node:fs";
const d = await PDFDocument.create();
const f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold), t = await d.embedFont(StandardFonts.TimesRoman);
for (let i = 1; i <= 3; i++) {
  const p = d.addPage([595.28, 841.89]);
  p.drawText(`Invoice number 10${i}`, { x: 60, y: 770, size: 24, font: b, color: rgb(0.1, 0.1, 0.3) });
  p.drawText("Dear customer, thank you for your order.", { x: 60, y: 730, size: 12, font: f });
  p.drawText("The total amount due is 250.00 GBP by 30 November 2026.", { x: 60, y: 712, size: 12, font: f });
  p.drawText("Item        Qty     Price", { x: 60, y: 670, size: 12, font: t });
  p.drawText("Widget      2       100.00", { x: 60, y: 652, size: 12, font: t });
  p.drawText("Gadget      1       50.00", { x: 60, y: 634, size: 12, font: t });
  p.drawText(`Page ${i} of 3`, { x: 270, y: 40, size: 10, font: f, color: rgb(0.4, 0.4, 0.4) });
}
const form = d.getForm();
const p1 = d.getPage(0);
p1.drawText("Your name:", { x: 60, y: 560, size: 12, font: f });
form.createTextField("name").addToPage(p1, { x: 140, y: 552, width: 200, height: 22 });
p1.drawText("Agree:", { x: 60, y: 520, size: 12, font: f });
form.createCheckBox("agree").addToPage(p1, { x: 140, y: 516, width: 16, height: 16 });
const dd = form.createDropdown("plan"); dd.addOptions(["Basic", "Pro", "Team"]); dd.addToPage(p1, { x: 140, y: 480, width: 120, height: 22 });
writeFileSync("tests/fixtures/sample.pdf", await d.save());
const locked = await PDFDocument.load(await d.save());
locked.encrypt({ userPassword: "open123", ownerPassword: "owner" });
writeFileSync("tests/fixtures/locked.pdf", await locked.save());
console.log("samples written");
