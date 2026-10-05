// The colour themes. Each one is a short list of base colours; colors() turns it into the full
// set Nimbalyst asks for, so every theme fills the same slots in the same way.
// To add a theme: add an entry here, run `node build.mjs` and `node test.mjs`.

export const EXTENSION_ID = 'com.local.inktheme';

export const THEMES = [
  {
    id: 'ink-aurora', name: 'Ink Aurora', isDark: true,
    about: 'Near-black violet with a deep, muted purple accent.',
    bg: '#14121c', side: '#0f0d16', raised: '#1f1c2c', stripe: '#1a1725', border: '#2a2639',
    text: '#ebe9f3', muted: '#c1bdd1', faint: '#958fa9', disabled: '#625d75',
    primary: '#7a6dc9', primaryHover: '#8d81d6', onPrimary: '#ffffff', focus: '#8f83d8',
    link: '#aaa0e6', linkHover: '#c6bef2', tint: [190, 180, 255],
    thumb: '#3d3854', thumbHover: '#585176',
    success: '#7fd6ae', warning: '#e0c27a', error: '#e8a0a8', info: '#a7b6ee', purple: '#b3a8ea',
  },
  {
    id: 'ink-ivy', name: 'Ink Ivy', isDark: true,
    about: 'Cool grey with a green cast and an ivy green accent.',
    bg: '#171b19', side: '#111513', raised: '#222826', stripe: '#1c211f', border: '#2e3632',
    text: '#e7ece8', muted: '#b9c4bd', faint: '#8d9a92', disabled: '#5c6861',
    primary: '#3f8a5f', primaryHover: '#4b9a6c', onPrimary: '#ffffff', focus: '#62b184',
    link: '#82c79d', linkHover: '#a8dbbb', tint: [190, 235, 210],
    thumb: '#3b4540', thumbHover: '#54615a',
    success: '#8fd6a5', warning: '#dcc47c', error: '#e6a09c', info: '#9fc3e6', purple: '#b8aee6',
  },
  {
    id: 'ink-graphite', name: 'Ink Graphite', isDark: true,
    about: 'Graphite grey panels on a near-black side bar, with a saddle brown accent.',
    bg: '#2b2a29', side: '#191817', raised: '#383634', stripe: '#31302e', border: '#464340',
    text: '#f1ede7', muted: '#c4bdb3', faint: '#aca499', disabled: '#6a645c',
    primary: '#b98452', primaryHover: '#c99563', onPrimary: '#1c140c', focus: '#cf9c6b',
    link: '#dcab7b', linkHover: '#ebc59f', tint: [255, 228, 196],
    thumb: '#4c4844', thumbHover: '#67615a',
    success: '#93cfa2', warning: '#e2c57c', error: '#e89c94', info: '#a3bcd9', purple: '#bcaddb',
  },
  {
    id: 'ink-bone', name: 'Ink Bone', isDark: false,
    about: 'Light: ivory pages, a bone side bar, warm ink text and a terracotta accent.',
    bg: '#f6f1e6', side: '#ebe4d4', raised: '#fdfaf3', stripe: '#f0eadc', border: '#d5cab5',
    text: '#2b2620', muted: '#584f44', faint: '#6f6558', disabled: '#a59c8c',
    primary: '#9a5a3c', primaryHover: '#86492d', onPrimary: '#ffffff', focus: '#b06a48',
    link: '#8a4a2c', linkHover: '#6c3418', tint: [70, 48, 16],
    thumb: '#c9bea8', thumbHover: '#aea28a',
    success: '#2f7850', warning: '#8a600c', error: '#ad3b3a', info: '#2f6396', purple: '#6c52a4',
  },
  {
    id: 'ink-tide', name: 'Ink Tide', isDark: true,
    about: 'Deep sea blue with a sea-glass teal accent.',
    bg: '#111a20', side: '#0c1318', raised: '#1a272f', stripe: '#151f26', border: '#26363f',
    text: '#e6eef1', muted: '#b6c6cd', faint: '#8a9ca4', disabled: '#586870',
    primary: '#26818e', primaryHover: '#3093a1', onPrimary: '#ffffff', focus: '#55b6c3',
    link: '#72c6d2', linkHover: '#9edbe4', tint: [170, 222, 245],
    thumb: '#33454f', thumbHover: '#4a606c',
    success: '#84d6b0', warning: '#e0c27a', error: '#eaa0a4', info: '#9dbcf0', purple: '#b6aaea',
  },
  {
    id: 'ink-ember', name: 'Ink Ember', isDark: true,
    about: 'Dark wine, almost black, with a dusty rose accent.',
    bg: '#1b1517', side: '#141011', raised: '#282023', stripe: '#211a1c', border: '#382d31',
    text: '#f1e9ea', muted: '#cdbfc2', faint: '#a39397', disabled: '#6c5e62',
    primary: '#b0506a', primaryHover: '#c06079', onPrimary: '#ffffff', focus: '#d27f95',
    link: '#e59aae', linkHover: '#f2bcc9', tint: [255, 205, 215],
    thumb: '#4a3c41', thumbHover: '#65545a',
    success: '#8fd3a8', warning: '#e2c47c', error: '#f09a80', info: '#a6bde6', purple: '#c2aee6',
  },
  {
    id: 'ink-frost', name: 'Ink Frost', isDark: false,
    about: 'Light: cool white pages, a pale grey-blue side bar and a slate blue accent.',
    bg: '#f1f4f7', side: '#e3e8ee', raised: '#fbfcfd', stripe: '#e9edf2', border: '#c5cdd8',
    text: '#1c232c', muted: '#444f5d', faint: '#586473', disabled: '#98a2af',
    primary: '#35609a', primaryHover: '#2a4f83', onPrimary: '#ffffff', focus: '#4a78b6',
    link: '#2d5791', linkHover: '#1c3f70', tint: [20, 40, 70],
    thumb: '#b9c2ce', thumbHover: '#9ba6b5',
    success: '#27744c', warning: '#855d0a', error: '#b03a3c', info: '#2a6294', purple: '#6850a6',
  },
  {
    id: 'ink-saffron', name: 'Ink Saffron', isDark: true,
    about: 'Neutral charcoal with a saffron gold accent.',
    bg: '#1a1a17', side: '#121210', raised: '#262622', stripe: '#20201c', border: '#35352f',
    text: '#efede3', muted: '#c8c5b6', faint: '#9d9a8b', disabled: '#66645a',
    primary: '#d2a03c', primaryHover: '#dfb04f', onPrimary: '#1d1503', focus: '#e0b55c',
    link: '#e6c06e', linkHover: '#f2d79b', tint: [255, 236, 190],
    thumb: '#45453d', thumbHover: '#5f5f55',
    success: '#93d1a0', warning: '#eba56a', error: '#ec9c92', info: '#a3c0e0', purple: '#c0afe2',
  },
  {
    id: 'ink-cobalt', name: 'Ink Cobalt', isDark: true,
    about: 'Night blue with a bright cobalt accent.',
    bg: '#12151f', side: '#0d0f17', raised: '#1c2130', stripe: '#171b28', border: '#2a3044',
    text: '#e8ebf5', muted: '#bcc3d8', faint: '#8e96b0', disabled: '#5b627a',
    primary: '#3f6fd8', primaryHover: '#5282e6', onPrimary: '#ffffff', focus: '#6f9bf0',
    link: '#8fb2f5', linkHover: '#b7cdf9', tint: [185, 205, 255],
    thumb: '#373f58', thumbHover: '#505a7a',
    success: '#84d6ae', warning: '#e2c47c', error: '#eca0a6', info: '#8fd0ea', purple: '#b9aaf0',
  },
  {
    id: 'ink-blossom', name: 'Ink Blossom', isDark: false,
    about: 'Light: blush white pages, a pale rose side bar and a berry accent.',
    bg: '#f8f1f2', side: '#eee3e6', raised: '#fefbfb', stripe: '#f3e9eb', border: '#dcc9ce',
    text: '#2a1f23', muted: '#56464c', faint: '#6a585e', disabled: '#a8979c',
    primary: '#a8406a', primaryHover: '#8f3258', onPrimary: '#ffffff', focus: '#bd5680',
    link: '#963660', linkHover: '#74244a', tint: [70, 20, 40],
    thumb: '#d2bfc4', thumbHover: '#b8a3a9',
    success: '#2c7650', warning: '#875d0c', error: '#b43a2e', info: '#2f6396', purple: '#6c52a4',
  },
  {
    id: 'ink-slate', name: 'Ink Slate', isDark: true,
    about: 'Cool slate grey panels on a darker side bar, with a tangerine accent.',
    bg: '#22262b', side: '#16191d', raised: '#2e333a', stripe: '#282c32', border: '#3d434b',
    text: '#eef0f2', muted: '#c2c8cf', faint: '#a3aab3', disabled: '#666d76',
    primary: '#e0823c', primaryHover: '#ec934f', onPrimary: '#1f1005', focus: '#f0a060',
    link: '#f2ab72', linkHover: '#f8c9a2', tint: [225, 235, 250],
    thumb: '#474e57', thumbHover: '#616973',
    success: '#8fd3a4', warning: '#e6c874', error: '#f09a9a', info: '#9cc3ea', purple: '#c0b0e8',
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
