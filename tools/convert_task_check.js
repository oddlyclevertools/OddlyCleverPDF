const grab = async (name, type = "") => new File([await fetch(`/tests/fixtures/convert/${name}`).then((r) => r.arrayBuffer())], name, { type });
const out = {};
const got = []; app.deliver = async (b, name) => { got.push(name); return "downloaded"; };
await app.runTask("pdf-to-word"); out.afterPdfToWord = got.slice();
const n = await app.open([await grab("sample.png", "image/png"), await grab("sample.svg", "image/svg+xml"), await grab("sample.docx"), await grab("sample.xlsx")]);
out.mergedPages = app.state.pages.length; out.opened = n;
await new Promise((r) => setTimeout(r, 600));
document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
const inp = document.querySelector("input[type=search], .palette input, input[placeholder*='Find' i]");
if (inp) { inp.value = "convert to word"; inp.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); }
out.paletteHit = [...document.querySelectorAll("[role=option], .palette-item, .pal-item, .cmd")].map((e) => e.textContent.trim().slice(0, 40)).slice(0, 4);
return out;
