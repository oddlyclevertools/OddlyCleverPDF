// Layout maths for moving and arranging edits: snapping, align, distribute, stacking order and
// layer names. Pure functions (no DOM, no store), so they're easy to test. Boxes are { x, y, w, h }
// in page points.

/** The box around several boxes. */
export function unionBox(boxes) {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Lines a moving box can snap to: the page's edges and centre, other boxes' edges and centres, extra x lines (text margins). */
export function snapTargets(page, boxes = [], extraXs = []) {
  const xs = [0, page.w / 2, page.w, ...extraXs], ys = [0, page.h / 2, page.h];
  for (const b of boxes) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  return { xs, ys };
}

function nearest(values, targets, tol) {
  let r = null;
  for (const v of values) for (const t of targets) {
    const d = t - v;
    if (Math.abs(d) <= tol && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, t };
  }
  return r;
}

/** Snap a box's left/centre/right and top/middle/bottom to the nearest target within tol. gx/gy: the guide line, or null. */
export function snapBox(b, { xs, ys }, tol) {
  const sx = nearest([b.x, b.x + b.w / 2, b.x + b.w], xs, tol);
  const sy = nearest([b.y, b.y + b.h / 2, b.y + b.h], ys, tol);
  return { dx: sx ? sx.d : 0, dy: sy ? sy.d : 0, gx: sx ? sx.t : null, gy: sy ? sy.t : null };
}

/**
 * How far to move each box to line them up. how: left | center | right | top | middle | bottom.
 * frame: what to line up with (the page when one thing is picked, else the boxes' shared box).
 */
export function alignDeltas(boxes, how, frame = unionBox(boxes)) {
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  return boxes.map((b) => {
    switch (how) {
      case "left": return { dx: frame.x - b.x, dy: 0 };
      case "center": return { dx: cx - (b.x + b.w / 2), dy: 0 };
      case "right": return { dx: frame.x + frame.w - (b.x + b.w), dy: 0 };
      case "top": return { dx: 0, dy: frame.y - b.y };
      case "middle": return { dx: 0, dy: cy - (b.y + b.h / 2) };
      case "bottom": return { dx: 0, dy: frame.y + frame.h - (b.y + b.h) };
      default: throw new Error(`Unknown alignment: ${how}`);
    }
  });
}

/** How far to move each box so the gaps between them are equal (axis "x" or "y"). The first and last stay put. */
export function distributeDeltas(boxes, axis) {
  const [p, s, d] = axis === "x" ? ["x", "w", "dx"] : ["y", "h", "dy"];
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return out;
  const order = boxes.map((_, i) => i).sort((i, j) => boxes[i][p] - boxes[j][p]);
  const start = boxes[order[0]][p], stop = Math.max(...boxes.map((b) => b[p] + b[s]));
  const gap = (stop - start - boxes.reduce((n, b) => n + b[s], 0)) / (boxes.length - 1);
  let pos = start;
  for (const i of order) { out[i][d] = pos - boxes[i][p]; pos += boxes[i][s] + gap; }
  return out;
}

/**
 * A new stacking order (array order = bottom to top) with the picked ids moved.
 * where: front | back (all the way), forward | backward (one step past the next unpicked item).
 */
export function restack(list, ids, where) {
  const picked = new Set(ids), a = [...list];
  if (where === "front") return [...a.filter((o) => !picked.has(o.id)), ...a.filter((o) => picked.has(o.id))];
  if (where === "back") return [...a.filter((o) => picked.has(o.id)), ...a.filter((o) => !picked.has(o.id))];
  if (where === "forward") {
    for (let i = a.length - 2; i >= 0; i--) if (picked.has(a[i].id) && !picked.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
  } else if (where === "backward") {
    for (let i = 1; i < a.length; i++) if (picked.has(a[i].id) && !picked.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
  } else throw new Error(`Unknown stacking move: ${where}`);
  return a;
}

/** Move one item to a new index (the index it ends up at). */
export function moveItem(list, from, to) {
  const a = [...list];
  const [it] = a.splice(from, 1);
  a.splice(Math.max(0, Math.min(a.length, to)), 0, it);
  return a;
}

const TYPE_NAMES = {
  image: "Picture", rect: "Box", ellipse: "Circle", line: "Line", arrow: "Arrow", ink: "Drawing", whiteout: "White patch",
  redact: "Black out", note: "Note",
};

/** The topmost edit whose white cover hides the PDF's words at a point (edited words, wherever the edit now sits). */
export function coveringEdit(objects, pt) {
  return [...objects].reverse().find((o) => o.type === "text" && o.cover && !o.hidden && !o.locked
    && pt.x >= o.cover.x && pt.x <= o.cover.x + o.cover.w && pt.y >= o.cover.y && pt.y <= o.cover.y + o.cover.h) || null;
}

/** A short, plain name for a layer. */
export function layerName(o) {
  if (o.name) return o.name;
  if (o.type === "text") {
    const t = String(o.text || "").replace(/\s+/g, " ").trim();
    return t ? (t.length > 32 ? `${t.slice(0, 31)}…` : t) : "Empty text";
  }
  if (o.type === "highlight") return { underline: "Underline", strike: "Strikethrough" }[o.style] || "Highlight";
  return TYPE_NAMES[o.type] || o.type.charAt(0).toUpperCase() + o.type.slice(1);
}
