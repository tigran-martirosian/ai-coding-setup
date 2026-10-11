// Every text a person reads in this extension, in two full sets.
//
// The language is fixed when the extension is built: the installer sets SETUP_LANGUAGE to `english` or
// `russian` (see vite.config.ts). The set that is not chosen is dropped from the built file.
// `russian` has the type of `english`, so a missing key is a compile error.

declare const __SETUP_LANGUAGE__: 'english' | 'russian' | undefined;

const english = {
  /** Passed to toLocaleString: [] = the computer's own language. */
  locale: [] as string[],
  day: 'd',
  hour: 'h',
  weekShort: 'wk',
  whoUsed: 'Who used it',
  sharedHint: '5-hour and weekly share, counted by ccpool',
  you: 'you',
  notCounted: 'Not counted',
  minute: 'm',
  title: 'Usage Plan',
  refresh: 'Refresh',
  used: 'used',
  startsNext: 'Starts with your next message',
  resetsIn: (span: string) => `Resets in ${span}`,
  yourPace: 'Your pace',
  newWeek: 'New week',
  nothingUsed: 'Nothing used yet',
  runsOut: (when: string) => `Runs out ${when}`,
  beforeReset: (span: string) => `${span} before the reset`,
  endsNear: (percent: number) => `Ends near ${percent}%`,
  lastsUntilReset: 'Lasts until the reset',
  weekly: 'Weekly',
  window7: '7-day window',
  window7Today: (percent: number) => `7-day window · ${percent}% today`,
  session: 'Session',
  window5: '5-hour window',
  dailyBudget: 'Daily budget',
  hourlyBudget: 'Hourly budget',
  unitDay: 'a day',
  unitHour: 'an hour',
  noPlan: 'No plan numbers recorded yet.',
  loading: 'Loading…',
  opening: 'Opening…',
  fullDashboard: 'Full dashboard',
  updated: (clock: string) => `Updated ${clock}`,
  weekUsed: (percent: number, span: string) => `Week: ${percent}% used (resets ${span})`,
  todayOfWeek: (percent: number) => `Today: ${percent}% of the week`,
  runsOutAtPace: (when: string) => `Runs out ${when} at this pace`,
  endsNearAtPace: (percent: number) => `Ends near ${percent}% at this pace`,
  sessionUsed: (percent: number) => `Session: ${percent}% used`,
};

type Strings = typeof english;

const russian: Strings = {
  locale: ['ru'],
  day: 'д',
  hour: 'ч',
  weekShort: 'нед',
  whoUsed: 'Кто сколько потратил',
  sharedHint: 'Доля за 5 часов и за неделю, считает ccpool',
  you: 'вы',
  notCounted: 'Не посчитано',
  minute: 'м',
  title: 'План использования',
  refresh: 'Обновить',
  used: 'использовано',
  startsNext: 'Начнётся со следующего сообщения',
  resetsIn: (span) => `Сброс через ${span}`,
  yourPace: 'Текущий темп',
  newWeek: 'Новая неделя',
  nothingUsed: 'Пока ничего не потрачено',
  runsOut: (when) => `Закончится ${when}`,
  beforeReset: (span) => `за ${span} до сброса`,
  endsNear: (percent) => `Итог: около ${percent}%`,
  lastsUntilReset: 'Хватит до сброса',
  weekly: 'Неделя',
  window7: 'Окно в 7 дней',
  window7Today: (percent) => `Окно в 7 дней · сегодня ${percent}%`,
  session: 'Сессия',
  window5: 'Окно в 5 часов',
  dailyBudget: 'Бюджет на день',
  hourlyBudget: 'Бюджет на час',
  unitDay: 'в день',
  unitHour: 'в час',
  noPlan: 'Данных о плане пока нет.',
  loading: 'Загрузка…',
  opening: 'Открывается…',
  fullDashboard: 'Полный дашборд',
  updated: (clock) => `Обновлено ${clock}`,
  weekUsed: (percent, span) => `Неделя: использовано ${percent}% (сброс через ${span})`,
  todayOfWeek: (percent) => `Сегодня: ${percent}% недели`,
  runsOutAtPace: (when) => `При таком темпе закончится ${when}`,
  endsNearAtPace: (percent) => `При таком темпе итог: около ${percent}%`,
  sessionUsed: (percent) => `Сессия: использовано ${percent}%`,
};

// Unset (as in the plain-node tests) means english.
export const t: Strings = typeof __SETUP_LANGUAGE__ !== 'undefined' && __SETUP_LANGUAGE__ === 'russian' ? russian : english;
