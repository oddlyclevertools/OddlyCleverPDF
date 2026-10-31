const got = [];
const orig = app.deliver; app.deliver = async (b, name) => { got.push([name, b.size]); return "downloaded"; };
app.openPanel("convert"); await new Promise((r) => setTimeout(r, 400));
const cards = [...document.querySelectorAll(".cv-card")];
const docx = cards.find((c) => c.textContent.includes("DOCX"));
docx.querySelector(".cv-main").click();
await new Promise((r) => setTimeout(r, 4000));
// choose "This page" then PNG
[...document.querySelectorAll(".cv-chip")].find((c) => c.textContent === "This page").click();
cards.find((c) => c.textContent.includes("PNG")).querySelector(".cv-main").click();
await new Promise((r) => setTimeout(r, 3000));
// bad range
[...document.querySelectorAll(".cv-chip")].find((c) => c.textContent === "Choose pages").click();
const inp = document.querySelector(".cv-range input"); inp.value = "9"; inp.dispatchEvent(new Event("input"));
cards.find((c) => c.textContent.includes("TXT")).querySelector(".cv-main").click();
await new Promise((r) => setTimeout(r, 500));
const err = !document.querySelector(".cv-error").hidden;
inp.value = "1-2"; inp.dispatchEvent(new Event("input"));
cards.find((c) => c.textContent.includes("TXT")).querySelector(".cv-main").click();
await new Promise((r) => setTimeout(r, 2500));
const txt = got.length;
// commands + tasks
const cmds = [];
const srcs = []; 
return { got, rangeErrorShown: err, afterTxt: txt, tasks: ["pdf-to-word", "pdf-to-excel", "pdf-to-powerpoint", "pdf-to-pictures", "pdf-to-text", "word-to-pdf", "pictures-to-pdf", "excel-to-pdf", "powerpoint-to-pdf", "anything-to-pdf"].map((id) => !!document.querySelector(`[data-task="${id}"]`) || id) };
