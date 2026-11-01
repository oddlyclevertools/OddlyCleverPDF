# Lift pictures and shapes (REA spec)

Goal: people can pick up the PDF's own pictures and drawn shapes (icons, logos, lines, boxes) and move,
resize or reorder them, like in a design tool.

## What rivals do (public docs and user posts, Nov 2026)

- **Acrobat, Edit PDF**: click an image or drawn object to get a box with handles; drag, resize, arrange.
  Users complain that drawn lines often can't be picked at all, or that one click grabs a huge box
  (the whole drawing as one blob), in a random place. People fall back on marquee-dragging, nudging with
  arrow keys, or opening the art in Illustrator. Users also report that editing can blur vector art.
- **Foxit (Pro only)**: separate "Edit Object" modes for images and for shapes; drag to move, handles to
  resize. Paid tier only.
- **PDFgear**: "Edit Text & Image" mode; click a picture and drag. No word on drawn shapes.
- **Sejda**: move and resize pictures you add; nothing clear about shapes already in the file.

Common gaps: shapes are second-class or paid; you can't see what is pickable; one click grabs too much
or too little; quality loss.

## Our version

- One tool, **Move pictures and shapes** (key `M`). While it's on, every picture and shape on the page
  gets a faint dashed outline, so you can see what can be moved. The one under the pointer lights up.
- **Press and drag** a picture or shape: it comes off the page and lands where you let go. A tap picks
  it up in place. Either way it becomes a normal edit, selected, so the Select tool can move, resize,
  reorder, hide or delete it (that's the Layers work).
- **What counts as one item**: each picture; each separately drawn shape; small shapes drawn one after
  another that touch (the parts of one icon) join into one item while they stay icon-sized (under 1 in).
  Big shapes never swallow the small things on top of them.
- **Skipped**: the full-page background, text (including Figma letters drawn as shapes), and shapes
  that draw nothing (clipping).
- **Quality**: on screen the item shows as a sharp picture made from the page itself. When you save,
  we put the item's original drawing back in its new place: pictures keep their real pixels and shapes
  stay vector, so nothing blurs.
- **No hidden copy**: the old item is taken out of the page's drawing instructions, not covered up.
  The saved PDF has it only in the new place. Undo puts it back.
- Locked (password) PDFs: we say we can't pick things up in them.

## How it works

- `src/core/lift.js` reads a page's content stream with the shared tokenizer (`contentOps` in
  `type3.js`), tracks where each instruction starts and ends, and lists the pictures and shapes with
  their boxes. `without()` writes the stream with an item's instructions cut out; `only()` writes it
  with just that item (keeping colour, transform and clipping set-up).
- Picking up saves a copy of the file with the item cut out and points the pages at that copy, so the
  screen redraws without it and Save starts from it. The page list is part of undo, so undo brings the
  old copy back.
- The edit is an `image` object with a `lift` note (`fileId`, `index`, instruction ranges, box).
  `export.js` turns that note into a Form XObject holding only the item, drawn at the edit's box.
