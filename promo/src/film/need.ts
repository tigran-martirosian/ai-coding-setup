import type { Body } from "./script";

/** A shot's words, of the kind its view expects. A shot wired to the wrong view fails here, not on screen. */
export const need = <K extends Body["kind"]>(body: Body, kind: K): Extract<Body, { kind: K }> => {
  if (body.kind !== kind) throw new Error(`Expected a "${kind}" shot, got "${body.kind}".`);
  return body as Extract<Body, { kind: K }>;
};
