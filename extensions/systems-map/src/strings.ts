// Every text a person reads in this extension, in two full sets.
//
// The language is fixed when the extension is built: the installer sets SETUP_LANGUAGE to `english` or
// `russian` (see vite.config.ts). The set that is not chosen is dropped from the built file.
// `russian` has the type of `english`, so a missing key is a compile error.

declare const __SETUP_LANGUAGE__: 'english' | 'russian' | undefined;

const english = {
  title: 'Systems map',
  parts: (n: number) => `${n} ${n === 1 ? 'part' : 'parts'}`,
  links: (n: number) => `${n} ${n === 1 ? 'link' : 'links'}`,
  pathsFound: 'All paths found',
  checkUnavailable: 'Path check unavailable',
  pathsGone: (n: number) => `${n} ${n === 1 ? 'path' : 'paths'} gone`,
  mistakes: (n: number) => `${n} ${n === 1 ? 'mistake' : 'mistakes'} in the file`,
  linksChanged: (n: number) => `${n} ${n === 1 ? "link's" : "links'"} code changed`,
  banner: (changed: number, gone: number) =>
    [`${changed} ${changed === 1 ? 'link whose' : 'links whose'} code changed`, gone > 0 ? `${gone} ${gone === 1 ? 'path' : 'paths'} gone` : ''].filter(Boolean).join(', '),
  codeChanged: 'code changed',
  lacks: (token: string) => `no longer has: ${token}`,
  /** `type` is '' for a link the file gives no type. */
  linkOut: (type: string, name: string) => (type ? `${type} → ${name}` : `to ${name}`),
  linkIn: (type: string, name: string) => (type ? `${type} ← ${name}` : `from ${name}`),
  legend: 'Groups',
  refresh: 'Refresh',
  reading: 'Reading the map…',
  search: 'Search parts',
  clearSearch: 'Clear search',
  noMatch: (q: string) => `Nothing matches “${q}”`,
  graph: 'Map of the project: parts and their links',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Show everything',
  partLabel: (name: string, links: number) => `${name}, ${links} ${links === 1 ? 'link' : 'links'}`,
  noMapTitle: 'No map for this project yet',
  noMapBody: 'A map lists the parts of the project and how they connect. Claude builds it from the code.',
  build: 'Build a map',
  buildSession: 'Build a map',
  buildStarted: 'Building in a new session. The map shows here once it is saved.',
  buildFailed: (why: string) => `Could not start the session: ${why}`,
  elsewhere: (by: string) => `This project's map is kept by ${by}`,
  errorTitle: 'Could not read the map',
  tryAgain: 'Try again',
  badJson: (why: string) => `.claude/systems-map.json is not valid JSON: ${why}`,
  notObject: '.claude/systems-map.json must hold one JSON object',
  noNodes: '.claude/systems-map.json has no "nodes" list',
  noLinks: '.claude/systems-map.json: "links" must be a list',
  noId: (n: number) => `Part ${n} has no id`,
  twoIds: (id: string) => `Two parts share the id "${id}"`,
  close: 'Close',
  files: 'Files',
  notes: 'Notes',
  linksHeading: 'Links',
  noFiles: 'No files listed',
  noLinkRows: 'No links',
  evidence: (n: number) => `${n} ${n === 1 ? 'file' : 'files'} as evidence`,
  fileGone: 'not found',
  openFile: (p: string) => `Open ${p}`,
};

type Strings = typeof english;

const russian: Strings = {
  title: 'Карта системы',
  parts: (n) => `${n} ${plural(n, 'часть', 'части', 'частей')}`,
  links: (n) => `${n} ${plural(n, 'связь', 'связи', 'связей')}`,
  pathsFound: 'Все пути найдены',
  checkUnavailable: 'Проверка путей недоступна',
  pathsGone: (n) => `Нет на месте: ${n} ${plural(n, 'путь', 'пути', 'путей')}`,
  mistakes: (n) => `Ошибок в файле: ${n}`,
  linksChanged: (n) => `Код изменился у ${n} ${plural(n, 'связи', 'связей', 'связей')}`,
  banner: (changed, gone) =>
    [`Код изменился у ${changed} ${plural(changed, 'связи', 'связей', 'связей')}`, gone > 0 ? `нет на месте: ${gone} ${plural(gone, 'путь', 'пути', 'путей')}` : ''].filter(Boolean).join(', '),
  codeChanged: 'код изменился',
  lacks: (token) => `больше нет: ${token}`,
  linkOut: (type, name) => (type ? `${RU_TYPES[type] ?? type} → ${name}` : `→ ${name}`),
  linkIn: (type, name) => (type ? `${RU_TYPES[type] ?? type} ← ${name}` : `← ${name}`),
  legend: 'Группы',
  refresh: 'Обновить',
  reading: 'Читаю карту…',
  search: 'Поиск по частям',
  clearSearch: 'Очистить поиск',
  noMatch: (q) => `Ничего не нашлось по «${q}»`,
  graph: 'Карта проекта: части и связи между ними',
  zoomIn: 'Приблизить',
  zoomOut: 'Отдалить',
  fit: 'Показать всё',
  partLabel: (name, links) => `${name}, ${links} ${plural(links, 'связь', 'связи', 'связей')}`,
  noMapTitle: 'У этого проекта пока нет карты',
  noMapBody: 'Карта перечисляет части проекта и то, как они связаны. Claude строит её по коду.',
  build: 'Построить карту',
  buildSession: 'Построить карту',
  buildStarted: 'Строится в новой сессии. Когда карта сохранится, она появится здесь.',
  buildFailed: (why) => `Не удалось начать сессию: ${why}`,
  elsewhere: (by) => `Карту этого проекта ведёт ${by}`,
  errorTitle: 'Не удалось прочитать карту',
  tryAgain: 'Повторить',
  badJson: (why) => `.claude/systems-map.json не является верным JSON: ${why}`,
  notObject: '.claude/systems-map.json должен содержать один объект JSON',
  noNodes: 'В .claude/systems-map.json нет списка "nodes"',
  noLinks: '.claude/systems-map.json: "links" должен быть списком',
  noId: (n) => `У части ${n} нет id`,
  twoIds: (id) => `У двух частей один id: «${id}»`,
  close: 'Закрыть',
  files: 'Файлы',
  notes: 'Заметки',
  linksHeading: 'Связи',
  noFiles: 'Файлов нет',
  noLinkRows: 'Связей нет',
  evidence: (n) => `${n} ${plural(n, 'файл', 'файла', 'файлов')} в подтверждение`,
  fileGone: 'не найден',
  openFile: (p) => `Открыть ${p}`,
};

// The six link types of `map.mjs`, as a Russian reader sees them in a card.
const RU_TYPES: Record<string, string> = {
  uses: 'использует',
  feeds: 'питает',
  spends: 'тратит',
  opens: 'открывает',
  boosts: 'усиливает',
  limits: 'ограничивает',
};

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Unset (as in the plain-node tests) means english.
export const t: Strings = typeof __SETUP_LANGUAGE__ !== 'undefined' && __SETUP_LANGUAGE__ === 'russian' ? russian : english;
