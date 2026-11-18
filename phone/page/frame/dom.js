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
  reload: ["M19 12a7 7 0 1 1-2.05-4.95", "M19.5 4.5v3.5H16"],
  files: [
    "M9 3.5h6l4 4v9a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 16.5V5A1.5 1.5 0 0 1 9 3.5z",
    "M15 3.5v4h4",
    "M4.5 7.5v11A2 2 0 0 0 6.5 20.5H15",
  ],
  folder: [
    "M3.5 7A1.5 1.5 0 0 1 5 5.5h4.5l2 2H19A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z",
  ],
  copy: [
    "M10 9h8.5a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 19v-8.5A1.5 1.5 0 0 1 10 9z",
    "M15.5 9V5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5v8.5A1.5 1.5 0 0 0 5.5 15h3",
  ],
  "select-text": ["M4 7h9M4 12h7M4 17h9", "M17.5 5v14M15.5 5h4M15.5 19h4"],
  "full-screen": ["M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"],
  download: ["M12 4v11", "M7.5 10.5 12 15l4.5-4.5", "M5 19.5h14"],
  send: ["M20.5 3.5 10.5 13.5", "M20.5 3.5 14 20.5l-3.5-7-7-3.5z"],
  "arrow-down": ["M12 5v14", "M6 13l6 6 6-6"],
  trash: [
    "M4.5 7h15",
    "M9.5 7V4.5h5V7",
    "M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5",
    "M10.5 11v6M13.5 11v6",
  ],
  plus: ["M12 5v14M5 12h14"],
};
