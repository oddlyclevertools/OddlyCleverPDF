# Moving things and layers: REA spec (1 Nov 2026)

What people asked for: "drag text around like layers and rearrange the page, like Figma and pro PDF editors."
This is our own spec, written from rivals' public help pages and user complaints. No code, art or look is copied.

## What rivals do

**Figma (design tools).** Press and drag anything to move it. Corner handles resize. Arrow keys nudge 1 px, Shift+arrow 10 px.
Pink guide lines appear when an edge or centre lines up with the frame or another object, and the object snaps there.
Shift+click adds to the selection. Align (left, centre, right, top, middle, bottom) and distribute (even gaps) work on the
selection, or on the parent frame when one thing is picked. A Layers list shows every object top to bottom: drag to reorder,
eye to hide, lock to stop accidental moves, double-click to rename. Ctrl+] / Ctrl+[ bring forward / send backward.

**Acrobat (Edit PDF).** Click PDF text to get a box around it, drag the box to move it. Each box is independent: typing in one
never pushes the next one down.

**Foxit, PDF-XChange, Soda.** An Arrange group: bring to front, bring forward, send backward, send to back. Align to the page or
to the selection. Distribute needs three or more objects.

## What users complain about

- Acrobat cuts one line into many boxes ("15 boxes to move one sentence"), or glues separate lines into one big box. It guesses
  boxes again every time, so people can't predict what will move.
- Moving PDF text needs a mode switch (Edit PDF) and the plain view can't move anything.
- No guides, so moved text ends up a little off the margin and looks wrong.
- Layers and stacking are hidden in menus; hidden things are easy to lose.

## Our spec

1. **Drag the PDF's own words, one gesture.** In Select, press on PDF words and drag: that line lifts into an edited text box
   and follows the pointer. A white patch stays over the old spot. One line = one box, the same line every time (we use the
   Edit text tool's line picking). Hold Alt while dragging to select words for copying instead. Double-click words to change them.
2. **Moving an edited line moves the words, never the patch.** The patch belongs to the old spot. Patches draw under all
   other edits, so two swapped lines never hide each other.
3. **Move, resize, nudge.** Drag to move, corner handles resize, arrows nudge 1 pt, Shift+arrows 10 pt.
4. **Snapping guides.** While moving, edges and centres snap to the page edges and centre, to other edits, and to the PDF's own
   lines (so a moved line lands back on the margin). A thin pink line shows what it snapped to. Hold Ctrl to move freely.
5. **Multi-select.** Shift+click on the page, or Shift/Ctrl+click in Layers. The group moves together.
6. **Align and distribute.** One thing picked: align to the page. Several: align to their shared box. Distribute (even gaps)
   when three or more are picked.
7. **Stacking.** Bring to front, forward one, backward one, send to back (buttons and Ctrl+] / Ctrl+[, with Shift for all the way).
8. **Layers panel.** Lists the page's edits top first with simple names ("Text: Backend Developer…", "Picture", "Box").
   Click to select (Shift/Ctrl to add), drag to reorder, eye to hide, lock to stop moves, double-click to rename.
   Hidden and locked edits can't be picked on the page; pick them in Layers.
9. **Undo and save.** Every move, resize, nudge, align, reorder, hide, lock and rename is one undo step. Saving draws edits in list
   order, so what you see is what you get. Hidden edits are left out of the saved file.

## Not now

Marquee (drag a box to pick many: a drag on the page moves or selects words), spacing numbers between objects, snapping while
resizing, groups and nested layers, rotation.
