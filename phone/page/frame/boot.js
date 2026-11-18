// The page's first steps, before the frame's files are in (comfort design, sections 2 and 4). index.html loads this
// module beside app.js, as the relay's content policy allows no inline script; it has no imports, so it runs as soon
// as it is here. It sets Telegram's theme colours from the page address, turns the preloaded style files into style sheets where they stand, calls Telegram's ready() the
// moment Telegram's script has run (Telegram hides its own loading view then, and the skeleton shows), and lets the
// skeleton's tab bar move between the tabs' shapes until the frame takes over.
//   stylesLoaded: resolves once every late style sheet is in; telegramLoaded: once Telegram's script has run.
//   shellTab(): the tab whose shapes show now ("home" at first).

const $ = (id) => document.getElementById(id);
const shell = $("shell");

// Telegram puts its theme in the page address (tgWebAppThemeParams). Its script writes the same --tg-theme-*
// variables and the dark class later; set here, a kept screen drawn before that script has run already has
// Telegram's colours. A field that is not a #rrggbb colour is left to Telegram's script.
const themeText = new URLSearchParams(location.hash.slice(1)).get(
  "tgWebAppThemeParams",
);
if (themeText) {
  const theme = JSON.parse(themeText);
  for (const [key, color] of Object.entries(theme))
    if (/^#[0-9a-f]{6}$/i.test(color))
      document.documentElement.style.setProperty(
        `--tg-theme-${key.replaceAll("_", "-")}`,
        color,
      );
  // Telegram's own rule: a page colour of perceived brightness under 120 is a dark theme.
  const bg = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
    theme.bg_color ?? "",
  );
  if (bg) {
    const [r, g, b] = bg.slice(1).map((h) => parseInt(h, 16));
    document.documentElement.classList.toggle(
      "dark-theme",
      Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) < 120,
    );
  }
}

export const stylesLoaded = Promise.all(
  [...document.querySelectorAll("link[data-late]")].map(
    (link) =>
      new Promise((ok, fail) => {
        link.addEventListener("load", ok);
        link.addEventListener("error", () =>
          fail(
            new Error(
              `The style file ${link.getAttribute("href")} did not load.`,
            ),
          ),
        );
        link.rel = "stylesheet";
      }),
  ),
);

export const telegramLoaded = new Promise((ok, fail) => {
  const ran = () => {
    const tg = globalThis.Telegram?.WebApp;
    if (!tg) return fail(new Error("Telegram's script did not load."));
    tg.ready();
    document.documentElement.classList.toggle(
      "dark-theme",
      tg.colorScheme === "dark",
    );
    ok();
  };
  if (globalThis.Telegram?.WebApp) return ran();
  const script = $("tg-script");
  script.addEventListener("load", ran);
  script.addEventListener("error", () =>
    fail(new Error("Telegram's script did not load.")),
  );
});

let tab = "home";
export const shellTab = () => tab;

shell.querySelector(".sk-tabbar").addEventListener("click", (e) => {
  const button = e.target.closest("[data-tab]");
  if (!button) return;
  tab = button.dataset.tab;
  for (const section of shell.querySelectorAll(".sk-tab"))
    section.hidden = section.dataset.tab !== tab;
  for (const b of shell.querySelectorAll(".sk-tabbtn"))
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
});
