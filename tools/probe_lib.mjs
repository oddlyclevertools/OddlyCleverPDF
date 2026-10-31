import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
const d = await PDFDocument.create();
const p = d.addPage([300, 200]);
p.drawText("Hello secret", { x: 20, y: 100, font: await d.embedFont(StandardFonts.Helvetica) });
console.log("encrypt fn:", typeof d.encrypt);
d.encrypt({ userPassword: "abc", ownerPassword: "own", permissions: { printing: "highResolution" } });
const bytes = await d.save();
console.log("saved", bytes.length);
try { await PDFDocument.load(bytes); console.log("loaded without pw (no error)"); } catch (e) { console.log("no-pw load error:", e.message.slice(0, 80)); }
try { const r = await PDFDocument.load(bytes, { password: "abc" }); console.log("pw load ok pages", r.getPageCount(), "encrypted?", r.isEncrypted); const out = await r.save(); console.log("resave", out.length); } catch (e) { console.log("pw load error:", e.message.slice(0, 120)); }
