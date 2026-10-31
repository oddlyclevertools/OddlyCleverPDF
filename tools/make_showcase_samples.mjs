// Made-up documents for the showcase clips (fictional businesses, names and numbers).
//   node tools/make_showcase_samples.mjs   -> showcase/samples/
import { PDFDocument, rgb, degrees } from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "showcase/samples";
mkdirSync(OUT, { recursive: true });
const A4 = [595.28, 841.89];
const INK = rgb(0.11, 0.1, 0.16), GREY = rgb(0.42, 0.4, 0.46), LINE = rgb(0.85, 0.84, 0.88);

async function newDoc() {
  const d = await PDFDocument.create();
  d.registerFontkit(fontkit);
  const font = (f) => d.embedFont(readFileSync(`public/fonts/${f}.ttf`), { subset: false });
  const f = { r: await font("Inter_400Regular"), b: await font("Inter_700Bold"), s: await font("Merriweather_400Regular"), sb: await font("Merriweather_700Bold") };
  return { d, f };
}
const text = (p, s, x, y, size, font, color = INK) => p.drawText(s, { x, y, size, font, color });
const right = (p, s, xr, y, size, font, color = INK) => p.drawText(s, { x: xr - font.widthOfTextAtSize(s, size), y, size, font, color });
const rule = (p, y, x1 = 50, x2 = 545) => p.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 1, color: LINE });

// ---- 1. the plumber's invoice (the total is wrong: 405 + VAT 81 = 486, it says 468) --------------
{
  const { d, f } = await newDoc();
  const p = d.addPage(A4);
  p.drawRectangle({ x: 0, y: 770, width: A4[0], height: 72, color: rgb(0.09, 0.27, 0.45) });
  text(p, "Harbour Lane Plumbing", 50, 805, 20, f.b, rgb(1, 1, 1));
  text(p, "Boilers · Bathrooms · Leaks fixed fast", 50, 787, 10, f.r, rgb(0.8, 0.88, 0.96));
  right(p, "INVOICE", 545, 800, 22, f.b, rgb(1, 1, 1));
  text(p, "Bill to", 50, 735, 9, f.b, GREY);
  ["Mr Tom Ashby", "14 Mill Road", "Whitby YO21 3HQ"].forEach((s, i) => text(p, s, 50, 718 - i * 15, 11, f.r));
  [["Invoice no.", "HLP-2291"], ["Date", "2 November 2026"], ["Due date", "30 November 2026"]].forEach(([k, v], i) => {
    text(p, k, 360, 735 - i * 17, 10, f.r, GREY); right(p, v, 545, 735 - i * 17, 10, f.b);
  });
  let y = 640;
  p.drawRectangle({ x: 50, y: y - 6, width: 495, height: 22, color: rgb(0.95, 0.95, 0.97) });
  text(p, "Description", 58, y, 10, f.b); right(p, "Qty", 380, y, 10, f.b); right(p, "Price", 460, y, 10, f.b); right(p, "Amount", 540, y, 10, f.b);
  const items = [["Call-out and diagnosis", 1, 65], ["Replace kitchen tap (mixer)", 1, 120], ["Fit new radiator valve", 2, 45], ["Labour (hours)", 2.5, 52]];
  y -= 28;
  for (const [desc, q, pr] of items) {
    text(p, desc, 58, y, 11, f.r); right(p, String(q), 380, y, 11, f.r); right(p, `£${pr.toFixed(2)}`, 460, y, 11, f.r); right(p, `£${(q * pr).toFixed(2)}`, 540, y, 11, f.r);
    rule(p, y - 9); y -= 26;
  }
  y -= 10;
  [["Subtotal", "£405.00"], ["VAT (20%)", "£81.00"]].forEach(([k, v]) => { text(p, k, 360, y, 11, f.r, GREY); right(p, v, 540, y, 11, f.r); y -= 20; });
  text(p, "Total due", 360, y - 4, 13, f.b); right(p, "£468.00", 540, y - 4, 13, f.b);
  y -= 60;
  text(p, "Please pay by 30 November 2026.", 50, y, 11, f.r);
  text(p, "Bank transfer to Harbour Lane Plumbing, sort code 00-00-00, account 12345678.", 50, y - 16, 10, f.r, GREY);
  text(p, "Thank you for your business. Any questions, ring Sam on 01947 000 000.", 50, y - 46, 10, f.r, GREY);
  writeFileSync(`${OUT}/invoice.pdf`, await d.save());
}

// ---- 2. the flat rental form (fillable) ---------------------------------------------------------
{
  const { d, f } = await newDoc();
  const p = d.addPage(A4);
  text(p, "Kestrel Court Lettings", 50, 790, 11, f.b, rgb(0.55, 0.2, 0.35));
  text(p, "Flat application form", 50, 760, 24, f.sb);
  text(p, "Flat 3, Kestrel Court, York. Fill this in and send it back to us.", 50, 738, 11, f.r, GREY);
  const form = d.getForm();
  const field = (label, name, y, w = 300) => {
    text(p, label, 50, y + 6, 11, f.r);
    form.createTextField(name).addToPage(p, { x: 200, y, width: w, height: 22, borderColor: LINE });
  };
  field("Full name", "full_name", 680);
  field("Current address", "address", 645);
  field("Phone", "phone", 610, 180);
  field("Move-in date", "move_in", 575, 180);
  text(p, "Do you have pets?", 50, 546, 11, f.r);
  form.createCheckBox("pets").addToPage(p, { x: 200, y: 542, width: 16, height: 16 });
  text(p, "Yes", 222, 546, 11, f.r, GREY);
  text(p, "Rent paid", 50, 511, 11, f.r);
  const dd = form.createDropdown("rent_period"); dd.addOptions(["Monthly", "Every 4 weeks", "Weekly"]); dd.addToPage(p, { x: 200, y: 505, width: 150, height: 22 });
  rule(p, 470);
  text(p, "Declaration", 50, 445, 13, f.b);
  text(p, "I confirm the details above are true.", 50, 425, 11, f.r);
  text(p, "Signature", 50, 360, 11, f.r); rule(p, 355, 130, 330);
  text(p, "Date", 360, 360, 11, f.r); rule(p, 355, 395, 545);
  writeFileSync(`${OUT}/rental_form.pdf`, await d.save());
}

// ---- 3. the tenancy agreement (page 2 scanned upside down) + an inventory page to add ----------
{
  const { d, f } = await newDoc();
  const titles = ["Tenancy agreement", "2. Rent and deposit", "3. Looking after the flat", "4. Ending the tenancy"];
  const body = [
    ["This agreement is between Kestrel Court Lettings (the landlord) and", "the tenant named on page 4, for Flat 3, Kestrel Court, York.", "", "1. The term", "The tenancy starts on 1 December 2026 and runs for twelve months."],
    ["The rent is £825 a month, paid on the first day of each month.", "", "The deposit is £950. It is held in a government-backed scheme", "and paid back within ten days of the tenancy ending."],
    ["The tenant keeps the flat clean and tells the landlord about any", "repairs needed as soon as they notice them.", "", "No smoking inside the flat. Pets only with written permission."],
    ["Either side can end the tenancy with two months' notice after", "the first six months.", "", "Signed for the landlord: ____________________", "", "Signed by the tenant: ____________________"],
  ];
  titles.forEach((t, i) => {
    const p = d.addPage(A4);
    text(p, t, 60, 770, i ? 16 : 24, f.sb);
    body[i].forEach((s, k) => text(p, s, 60, 730 - k * 18, 11.5, f.s));
    right(p, `Page ${i + 1} of 4`, 535, 40, 9, f.r, GREY);
    if (i === 1) p.setRotation(degrees(180));
  });
  writeFileSync(`${OUT}/tenancy_agreement.pdf`, await d.save());

  const inv = await newDoc();
  const p = inv.d.addPage(A4);
  text(p, "Inventory", 60, 770, 24, inv.f.sb);
  ["Living room: grey sofa, oak table, two chairs, curtains", "Kitchen: fridge freezer, washing machine, kettle", "Bedroom: double bed, wardrobe, chest of drawers", "Bathroom: mirror cabinet, shower curtain"].forEach((s, k) => text(p, s, 60, 730 - k * 22, 11.5, inv.f.s));
  writeFileSync(`${OUT}/inventory.pdf`, await inv.d.save());
}

// ---- 4. the bank letter (with an account number to black out) -----------------------------------
{
  const { d, f } = await newDoc();
  const p = d.addPage(A4);
  text(p, "Fernlea Savings", 50, 790, 20, f.sb, rgb(0.1, 0.35, 0.3));
  right(p, "3 November 2026", 545, 795, 10, f.r, GREY);
  ["Mr Daniel Hart", "22 Orchard Lane", "Harrogate HG1 2PL"].forEach((s, i) => text(p, s, 50, 735 - i * 15, 11, f.r));
  text(p, "Your new savings account", 50, 650, 16, f.b);
  text(p, "Dear Mr Hart,", 50, 615, 11, f.r);
  text(p, "Thank you for opening an Easy Saver account with us. Here are your details:", 50, 595, 11, f.r);
  p.drawRectangle({ x: 50, y: 520, width: 495, height: 58, color: rgb(0.95, 0.97, 0.96) });
  text(p, "Account number", 66, 556, 11, f.r, GREY); text(p, "4417 2093 8810", 200, 556, 12, f.b);
  text(p, "Sort code", 66, 533, 11, f.r, GREY); text(p, "40-12-77", 200, 533, 12, f.b);
  text(p, "Interest is paid monthly at 3.85% AER (variable).", 50, 490, 11, f.r);
  text(p, "Yours sincerely,", 50, 450, 11, f.r);
  text(p, "The Fernlea Savings team", 50, 432, 11, f.r);
  writeFileSync(`${OUT}/bank_letter.pdf`, await d.save());
}

// ---- 5. a Word file to turn into a PDF ----------------------------------------------------------
{
  const cell = (s, bold) => new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: s, bold })] })] });
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: "Allotment club: November jobs", heading: HeadingLevel.HEADING_1 }),
    new Paragraph("Here's who's doing what before the frost. Swap with someone if you can't make your day."),
    new Table({ rows: [["Job", "Who", "When"], ["Clear bed 4", "Margaret", "Sat 7th"], ["Mend the shed door", "Pete", "Sun 8th"], ["Order seed potatoes", "Raj", "by the 15th"]]
      .map((r, i) => new TableRow({ children: r.map((s) => cell(s, i === 0)) })) }),
    new Paragraph(""),
    new Paragraph("Tea and biscuits in the shed after, as always."),
  ] }] });
  writeFileSync(`${OUT}/allotment_jobs.docx`, await Packer.toBuffer(doc));
}
console.log("showcase samples written to", OUT);
