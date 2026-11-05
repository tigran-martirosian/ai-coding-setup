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
  minute: 'm',
  title: 'Usage Plan',
  refresh: 'Refresh',
  updating: 'Updating…',
  week: 'This week',
  used: 'used',
  left: (span: string) => `${span} left`,
  resetsAt: (when: string) => `resets ${when}`,
  startsNext: 'Starts with your next message',
  now: 'Now',
  tickWeek: (percent: number) => `Now: ${percent}% of the week has passed`,
  tickFive: (percent: number) => `Now: ${percent}% of the 5 hours has passed`,
  barLabel: (used: number, tick: string) => `${used}% used. ${tick}`,
  todayAsOf: (percent: number, time: string) => `today ${percent}%, as of ${time}`,
  asOf: (time: string) => `As of ${time}`,
  newWeek: 'New week, nothing used yet',
  runsOut: (when: string) => `Runs out ${when} at this pace`,
  beforeReset: (span: string) => `${span} before the reset`,
  endsNear: (percent: number) => `Ends the week near ${percent}% at this pace`,
  lastsUntilReset: 'Lasts until the reset',
  budget: 'Budget',
  budgetWeek: 'to last the week',
  budgetFive: 'to last the window',
  yourPace: 'Your pace',
  unitDay: 'a day',
  unitHour: 'an hour',
  paceFrom: (span: string) => `from ${span} of this week`,
  paceFromFive: 'from this window',
  five: '5-hour window',
  noPlan: 'No plan numbers yet',
  refreshFailed: 'Could not refresh the numbers. Check that the setup is installed, then try again',
  dashboardFailed: 'Could not build the dashboard. Try again',
  retry: 'Try again',
  loading: 'Loading…',
  dashboard: 'Full dashboard',
  building: 'Building the page…',
  opened: 'Opened in browser',
};

type Strings = typeof english;

const russian: Strings = {
  locale: ['ru'],
  day: 'д',
  hour: 'ч',
  minute: 'м',
  title: 'План использования',
  refresh: 'Обновить',
  updating: 'Обновление…',
  week: 'Эта неделя',
  used: 'использовано',
  left: (span) => `осталось ${span}`,
  resetsAt: (when) => `сброс ${when}`,
  startsNext: 'Начнётся со следующего сообщения',
  now: 'Сейчас',
  tickWeek: (percent) => `Сейчас: прошло ${percent}% недели`,
  tickFive: (percent) => `Сейчас: прошло ${percent}% от 5 часов`,
  barLabel: (used, tick) => `Использовано ${used}%. ${tick}`,
  todayAsOf: (percent, time) => `сегодня ${percent}%, на ${time}`,
  asOf: (time) => `На ${time}`,
  newWeek: 'Новая неделя, пока ничего не потрачено',
  runsOut: (when) => `При таком темпе закончится ${when}`,
  beforeReset: (span) => `за ${span} до сброса`,
  endsNear: (percent) => `При таком темпе неделя закончится на ${percent}%`,
  lastsUntilReset: 'Хватит до сброса',
  budget: 'Бюджет',
  budgetWeek: 'чтобы хватило на неделю',
  budgetFive: 'чтобы хватило на окно',
  yourPace: 'Ваш темп',
  unitDay: 'в день',
  unitHour: 'в час',
  paceFrom: (span) => `по данным за ${span} этой недели`,
  paceFromFive: 'по этому окну',
  five: 'Окно в 5 часов',
  noPlan: 'Данных о плане пока нет',
  refreshFailed: 'Не удалось обновить данные. Проверьте, что настройка установлена, и повторите',
  dashboardFailed: 'Не удалось собрать дашборд. Повторите',
  retry: 'Повторить',
  loading: 'Загрузка…',
  dashboard: 'Полный дашборд',
  building: 'Собираю страницу…',
  opened: 'Открыто в браузере',
};

// Unset (as in the plain-node tests) means english.
export const t: Strings = typeof __SETUP_LANGUAGE__ !== 'undefined' && __SETUP_LANGUAGE__ === 'russian' ? russian : english;
