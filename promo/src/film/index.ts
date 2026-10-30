import { totalFrames } from "./script";

export const FILM_FRAMES = totalFrames();

/** The clip the docs show for the checks: one catch, then what else goes back. */
export const CHECKS_CLIP = ["catch", "sentback"];
export const clipFrames = (ids: string[]): number => totalFrames(ids);
