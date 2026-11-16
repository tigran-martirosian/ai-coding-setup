// Building the page from elements and text nodes only (pipe design, section 6): no HTML strings anywhere, so text
// from a session can never become markup.
//   el("div.block.steps", { onclick, hidden, ...attributes }, child, "text", [more children])

export function el(spec, props, ...children) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  let kids = children;
  if (
    props === null ||
    typeof props !== "object" ||
    props instanceof Node ||
    Array.isArray(props)
  )
    kids = [props, ...children];
  else
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "hidden" || k === "disabled") node[k] = Boolean(v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
  append(node, kids);
  return node;
}

function append(node, kids) {
  for (const k of kids) {
    if (k === undefined || k === null || k === false) continue;
    if (Array.isArray(k)) append(node, k);
    else
      node.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const SVG = "http://www.w3.org/2000/svg";

// A 24-unit line icon from path data, drawn in the current text colour.
export function icon(paths, size = 22) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.6");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.append(p);
  }
  return svg;
}

// The icons the frame draws (the mock-up's line set).
export const ICONS = {
  home: ["M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"],
  projects: ["M3.5 6.5h6l2 2h9v10h-17z"],
  settings: [
    "M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6",
    "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
    "M12 5.8a6.2 6.2 0 1 0 0 12.4a6.2 6.2 0 1 0 0-12.4z",
  ],
  pc: [
    "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5z",
    "M9 19.5h6M12 15.5v4",
  ],
};
