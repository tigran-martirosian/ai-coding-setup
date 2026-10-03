# Promo video

The one-minute video in `docs/img`, drawn with [Remotion](https://www.remotion.dev). Nothing in it is a screen recording: the chat panel, the permission popup, the board and the usage pop-up are redrawn as React components, with made-up projects and numbers.

```
npm install
npm run render
```

`npm run render` writes `promo.mp4`, a small `promo.gif` and `promo-poster.png` to `../docs/img`. Needs Node.js 18 or newer; Remotion downloads its own browser on the first run.

- `npm run studio` opens the Remotion Studio, where each scene can be played on its own.
- `npm run stills` writes one frame of every scene to `out/stills`, to check the text after a change.
- The scenes and their lengths are listed in `src/scenes/index.ts`. Each scene is one file next to it.
