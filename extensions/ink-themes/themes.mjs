// The colour themes. Each one is a short list of base colours; colors() turns it into the full
// set Nimbalyst asks for, so every theme fills the same slots in the same way.
// To add a theme: add an entry here, run `node build.mjs` and `node test.mjs`.

export const EXTENSION_ID = 'com.local.inktheme';

export const THEMES = [
  {
    id: 'ink-aurora', name: 'Ink Aurora', isDark: true,
    about: 'Near-black with a violet lean and a muted purple accent',
    bg: '#16151a', side: '#100f13', raised: '#211f27', stripe: '#1b1a20', border: '#2c2a36',
    text: '#ebe9f3', muted: '#c1bdd1', faint: '#958fa9', disabled: '#625d75',
    primary: '#6d60bd', primaryHover: '#7d71cc', onPrimary: '#ffffff', focus: '#8f83d8',
    link: '#aaa0e6', linkHover: '#c6bef2', tint: [190, 180, 255],
    thumb: '#3d3854', thumbHover: '#585176',
    success: '#7fd6ae', warning: '#e0c27a', error: '#e8a0a8', info: '#a7b6ee', purple: '#b3a8ea',
  },
  {
    id: 'ink-ivy', name: 'Ink Ivy', isDark: true,
    about: 'Cool grey with a green cast and an ivy green accent',
    bg: '#181b1a', side: '#121514', raised: '#232826', stripe: '#1d211f', border: '#2f3633',
    text: '#e7ece8', muted: '#b9c4bd', faint: '#8d9a92', disabled: '#5c6861',
    primary: '#5aa97c', primaryHover: '#6bb98c', onPrimary: '#0d1712', focus: '#62b184',
    link: '#82c79d', linkHover: '#a8dbbb', tint: [190, 235, 210],
    thumb: '#3b4540', thumbHover: '#54615a',
    success: '#8fd6a5', warning: '#dcc47c', error: '#e6a09c', info: '#9fc3e6', purple: '#b8aee6',
  },
  {
    id: 'ink-graphite', name: 'Ink Graphite', isDark: true,
    about: 'Graphite grey panels on a near-black side bar, with a saddle brown accent',
    bg: '#2b2a29', side: '#191817', raised: '#383634', stripe: '#31302e', border: '#464340',
    text: '#f1ede7', muted: '#c4bdb3', faint: '#aca499', disabled: '#6a645c',
    primary: '#b98452', primaryHover: '#c99563', onPrimary: '#1c140c', focus: '#cf9c6b',
    link: '#dcab7b', linkHover: '#ebc59f', tint: [255, 228, 196],
    thumb: '#4c4844', thumbHover: '#67615a',
    success: '#93cfa2', warning: '#e2c57c', error: '#e89c94', info: '#a3bcd9', purple: '#bcaddb',
  },
  {
    id: 'ink-bone', name: 'Ink Bone', isDark: false,
    about: 'Light: warm stone pages, a bone side bar and a bronze accent',
    bg: '#f3f2f0', side: '#e8e6e2', raised: '#fdfdfd', stripe: '#eeece9', border: '#d3d0ca',
    text: '#2a2622', muted: '#54504a', faint: '#67625a', disabled: '#a39f97',
    primary: '#77601a', primaryHover: '#665114', onPrimary: '#ffffff', focus: '#94791f',
    link: '#6a5516', linkHover: '#52410d', tint: [60, 50, 30],
    thumb: '#cac6be', thumbHover: '#aea99f',
    success: '#2f7850', warning: '#8a600c', error: '#ad3b3a', info: '#2f6396', purple: '#6c52a4',
  },
  {
    id: 'ink-tide', name: 'Ink Tide', isDark: true,
    about: 'Deep sea grey with a sea-glass teal accent',
    bg: '#161a1b', side: '#101213', raised: '#1f2426', stripe: '#1a1f21', border: '#2b3437',
    text: '#e6eef1', muted: '#b6c6cd', faint: '#8a9ca4', disabled: '#586870',
    primary: '#26818e', primaryHover: '#3093a1', onPrimary: '#ffffff', focus: '#55b6c3',
    link: '#72c6d2', linkHover: '#9edbe4', tint: [170, 222, 245],
    thumb: '#38454a', thumbHover: '#4e6067',
    success: '#84d6b0', warning: '#e0c27a', error: '#eaa0a4', info: '#9dbcf0', purple: '#b6aaea',
  },
  {
    id: 'ink-ember', name: 'Ink Ember', isDark: true,
    about: 'Dark wine, almost black, with a dusty rose accent',
    bg: '#1a1516', side: '#131010', raised: '#271f21', stripe: '#201a1b', border: '#382d30',
    text: '#f1e9ea', muted: '#cdbfc2', faint: '#a39397', disabled: '#6c5e62',
    primary: '#b0506a', primaryHover: '#c06079', onPrimary: '#ffffff', focus: '#d27f95',
    link: '#e59aae', linkHover: '#f2bcc9', tint: [255, 205, 215],
    thumb: '#4a3c41', thumbHover: '#65545a',
    success: '#8fd3a8', warning: '#e2c47c', error: '#f09a80', info: '#a6bde6', purple: '#c2aee6',
  },
  {
    id: 'ink-frost', name: 'Ink Frost', isDark: false,
    about: 'Light: cool grey pages, a pale grey-blue side bar and a clear blue accent',
    bg: '#ecedf0', side: '#e0e2e5', raised: '#ffffff', stripe: '#e4e7ea', border: '#c6cbd2',
    text: '#1c2026', muted: '#4b5058', faint: '#5f656e', disabled: '#9a9fa7',
    primary: '#35609a', primaryHover: '#2a4f83', onPrimary: '#ffffff', focus: '#4a78b6',
    link: '#1a5cb0', linkHover: '#0f438a', tint: [20, 40, 70],
    thumb: '#bbc0c8', thumbHover: '#9ea4ae',
    success: '#27744c', warning: '#855d0a', error: '#a62f33', info: '#2a6294', purple: '#6850a6',
  },
  {
    id: 'ink-noir', name: 'Ink Noir', isDark: true,
    about: 'Black and white only: black panels, grey text and a white button',
    bg: '#101010', side: '#080808', raised: '#1c1c1c', stripe: '#161616', border: '#2c2c2c',
    text: '#e6e6e6', muted: '#bdbdbd', faint: '#8f8f8f', disabled: '#5e5e5e',
    primary: '#ececec', primaryHover: '#ffffff', onPrimary: '#111111', focus: '#d0d0d0',
    link: '#ffffff', linkHover: '#ffffff', tint: [255, 255, 255],
    thumb: '#3a3a3a', thumbHover: '#555555',
    success: '#8fd6a5', warning: '#e0c27a', error: '#ee9a9a', info: '#9fc3e6', purple: '#b8aee6',
  },
  {
    id: 'ink-cobalt', name: 'Ink Cobalt', isDark: true,
    about: 'Near-black with a cool lean and a bright cobalt accent',
    bg: '#16171b', side: '#0f1013', raised: '#202226', stripe: '#1b1d21', border: '#2d3037',
    text: '#e8ebf5', muted: '#a9b1c8', faint: '#8189a2', disabled: '#5b627a',
    primary: '#3f6fd8', primaryHover: '#5282e6', onPrimary: '#ffffff', focus: '#6f9bf0',
    link: '#8fb2f5', linkHover: '#b7cdf9', tint: [185, 205, 255],
    thumb: '#383c48', thumbHover: '#50566a',
    success: '#84d6ae', warning: '#e2c47c', error: '#eca0a6', info: '#8fd0ea', purple: '#b9aaf0',
  },
  {
    id: 'ink-blossom', name: 'Ink Blossom', isDark: false,
    about: 'Light: blush grey pages, a pale rose side bar and a berry accent',
    bg: '#f2efef', side: '#e7e2e3', raised: '#fdfdfd', stripe: '#ece8e9', border: '#d6cccf',
    text: '#2a1f23', muted: '#56464c', faint: '#6a585e', disabled: '#a8979c',
    primary: '#a8406a', primaryHover: '#8f3258', onPrimary: '#ffffff', focus: '#bd5680',
    link: '#963660', linkHover: '#74244a', tint: [70, 20, 40],
    thumb: '#d2bfc4', thumbHover: '#b8a3a9',
    success: '#2c7650', warning: '#875d0c', error: '#b43a2e', info: '#2f6396', purple: '#6c52a4',
  },
  {
    id: 'ink-neon', name: 'Ink Neon', isDark: true,
    about: 'Plum black with a hot magenta accent',
    bg: '#19151a', side: '#111012', raised: '#262028', stripe: '#1f1b20', border: '#3a3039',
    text: '#f4ecf6', muted: '#cdbfd2', faint: '#a08fa6', disabled: '#6a5a70',
    primary: '#d6249f', primaryHover: '#e53fb0', onPrimary: '#ffffff', focus: '#ff5cc8',
    link: '#ff7fd4', linkHover: '#ffa8e2', tint: [255, 190, 240],
    thumb: '#49364f', thumbHover: '#65506c',
    success: '#6ee7a8', warning: '#f0d070', error: '#ff8f8f', info: '#6fc8ff', purple: '#c4a6ff',
  },
];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (c, a) => `rgba(${(Array.isArray(c) ? c : rgb(c)).join(', ')}, ${a})`;

/** The full colour set for one theme, in the names Nimbalyst's manifest uses. */
export function colors(t) {
  return {
    'bg': t.bg, 'bg-secondary': t.side, 'bg-tertiary': t.raised,
    'bg-hover': rgba(t.tint, 0.06), 'bg-selected': rgba(t.primary, 0.22), 'bg-active': rgba(t.primary, 0.32),
    'text': t.text, 'text-muted': t.muted, 'text-faint': t.faint, 'text-disabled': t.disabled,
    'border': t.border, 'border-focus': t.focus,
    'primary': t.primary, 'primary-hover': t.primaryHover, 'on-primary': t.onPrimary, 'accent-subtle': rgba(t.primary, 0.12),
    'code-bg': t.side, 'code-text': t.text, 'code-border': t.border, 'code-gutter': t.raised,
    'table-border': t.border, 'table-header': t.side, 'table-cell': t.bg, 'table-stripe': t.stripe,
    'toolbar-bg': t.bg, 'toolbar-border': t.border, 'toolbar-hover': rgba(t.tint, 0.06), 'toolbar-active': rgba(t.primary, 0.24),
    'quote-text': t.muted, 'quote-border': t.border,
    'scrollbar-thumb': t.thumb, 'scrollbar-thumb-hover': t.thumbHover,
    'link': t.link, 'link-hover': t.linkHover,
    'success': t.success, 'warning': t.warning, 'error': t.error, 'info': t.info, 'purple': t.purple,
  };
}

/** How strongly two colours differ in lightness, from 1 (the same) to 21 (black on white). */
export function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
