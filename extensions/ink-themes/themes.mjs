// The five colour themes. Each one is a short list of base colours; colors() turns it into the full
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
