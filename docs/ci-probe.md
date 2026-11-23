# A page with a cut label

The words in the "Grows" box get bigger after Mermaid has measured them, as when a reader's browser draws the
label in a wider font than the one Mermaid measured: the box stays the same size and the words are cut off.

```mermaid
%%{init: {"themeCSS": "@keyframes grow { to { font-size: 30px; } } .grow .nodeLabel { animation: grow 0.2s 0.5s forwards; }"}}%%
flowchart TD
  ask[Request] --> fix[Grows]
  ask --> plan[Big plan]
  fix --> test[Test]
  test --> done[Done]
  class fix grow
```
