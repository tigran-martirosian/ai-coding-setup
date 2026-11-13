# Promo video

The tour video and the short clips in `docs/img`, drawn with [Remotion](https://www.remotion.dev). Nothing in them is a screen recording: the chat panel, the permission popup, the board, the usage pop-up and the dashboard are redrawn as React components, with made-up projects and numbers.

```
npm install
npm run render
```

`npm run render` writes `promo.mp4`, `promo-poster.png` and one `clip-<name>.gif` per section of `docs/features.md` to `../docs/img`. Needs Node.js 22.18 or newer and ffmpeg; Remotion downloads its own browser on the first run. The film is drawn at 1920x1080 and 60 frames a second into `out/master.mp4`, then cut to 1600x900, and the run fails if the result passes GitHub's 10 MB limit for a video.

- `npm run studio` opens the Remotion Studio, where each scene and each clip can be played on its own.
- `npm run stills` writes the last frame of every film shot to `out/stills`, to check the text after a change.
- `npm run clips` renders only the gifs.
- The film's headlines, lines and figures are in `src/film/script.ts` (the small sample content inside its windows sits in the views), with each shot's length set by hand in ticks (`TICKS` a second). `node check-reading.mjs` prints the pace and fails when the film runs too long.
- `node strip.mjs <shot>` makes a contact sheet of one shot, a picture every few frames, to judge the motion and not only where a shot ends. A frame range such as `0-600` works too.
- The older clips and their scenes are listed in `src/scenes/index.ts`.
