# Free text editing (REA, 1 Nov 2026)

Goal: Edit text should feel like clicking into a word processor, not like hunting for the exact pixel.

## What rivals do (public behaviour and user complaints)

- **Adobe Acrobat (Edit PDF):** shows a box around each detected paragraph. A click anywhere in the box puts the caret at that spot, and typing reflows the lines inside the box. Users complain that it sometimes splits a paragraph into one box per line, and sometimes glues separate items into one big box, with no way to choose. Boxes don't push each other, and text never flows to the next page.
- **Foxit (paragraph editing):** like Acrobat: lines wrap at the box edge as you type. It also has a separate page-wide reflow mode. Users ask for join and split controls when the guess is wrong.
- **Sejda and PDFgear:** you click on text to edit it, and the editor swaps the font when it can't reuse the PDF's own. In practice edits are per line or fragment, and users dislike having to edit a paragraph line by line.
- **Figma text tool:** a click inside a text layer puts the caret at the nearest letter. A click past the end of a line puts it at the end of that line. A click in the layer's empty area still enters that layer. It never says "nothing here" when you clicked inside a box you can see.

## Our spec

1. **A visible box is a target.** A tap anywhere inside an edited text box's frame (not only on its words) reopens that box.
2. **Near is good enough.** If a tap misses the words, use the nearest line or phrase on the same row: a gap between words or columns, or a little past the end of a line (up to about 4 letter-heights). It also catches a tap a little above or below a line (about half a letter-height). Only when nothing is that close do we say "No text right there".
3. **Caret where you tapped.** The caret goes to the letter nearest the tap, on the nearest line of the box. A tap past the end of a line goes to the end of that line. The old caret-always-at-the-end behaviour is gone.
4. **Paragraphs open as one box.** Lines below and above the tapped one join it when all of these are true: same style and size, the same left edge, even line spacing, and the line above really wrapped (its first next word would not have fit). Typing then reflows inside the paragraph's width, keeping its line spacing. Table cells and columns stay separate, because each cell is its own phrase and short rows never "wrap".
5. **Never a duplicate.** If the line we would open is already under an edited box, that box opens instead.
6. **Figma PDFs:** a paragraph only joins lines whose whole width is in the same rebuilt font. A mixed-style line edits on its own, as before.

Not in scope: join and split controls, and text flowing between boxes or pages (Acrobat doesn't do these either).
