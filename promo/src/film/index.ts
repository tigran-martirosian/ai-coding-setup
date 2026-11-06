import { totalFrames } from "./script";

export const FILM_FRAMES = totalFrames();

/** The clip the docs show for the checks: a reply with no test run, then a page it never opened. */
export const CHECKS_CLIP = ["verify", "link"];
export const clipFrames = (ids: string[]): number => totalFrames(ids);
