# Promo video

The tour video and the short clips in `docs/img`, drawn with [Remotion](https://www.remotion.dev). Nothing in them is a screen recording: the chat panel, the permission popup, the board, the usage pop-up and the dashboard are redrawn as React components, with made-up projects and numbers.

```
npm install
npm run render
```

`npm run render` writes `promo.mp4`, `promo-poster.png` and one `clip-<name>.gif` per README section to `../docs/img`. Needs Node.js 18 or newer; Remotion downloads its own browser on the first run.

- `npm run studio` opens the Remotion Studio, where each scene and each clip can be played on its own.
- `npm run stills` writes one late frame of every scene to `out/stills`, to check the text after a change.
- `npm run clips` renders only the gifs.
- The scenes, their lengths and the clips they belong to are listed in `src/scenes/index.ts`. Each scene is one file next to it.
