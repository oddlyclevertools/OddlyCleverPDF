app.openPanel("convert"); await new Promise(r=>setTimeout(r,800));
const pb = document.querySelector(".panel-body");
const r = { cards: document.querySelectorAll(".cv-card").length, vw: innerWidth, bodyW: pb.getBoundingClientRect().width, scrollW: pb.scrollWidth, introW: document.querySelector(".cv-intro").getBoundingClientRect().right, minH: Math.min(...[...document.querySelectorAll(".cv-main,.cv-chip,.cv-opt .sel")].map((e) => e.getBoundingClientRect().height)) };
if (location.search.includes("x") || true) pb.scrollTop = 330;
await new Promise(r=>setTimeout(r,300));
return r;
