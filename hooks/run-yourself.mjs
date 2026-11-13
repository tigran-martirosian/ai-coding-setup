#!/usr/bin/env node
// run-yourself: Stop hook. Backs the "Do the work yourself, fully" rule in CLAUDE.md. If Claude ends
// a turn by telling the user to run, paste or type a shell command (a code span or block next to
// phrases like "open a terminal and run", "you need to run", "paste this into"), it blocks the stop
// ONCE and says to run it itself. Silent for slash commands the user types (/model, /handoff ...),
// URLs and localhost, commands shown as proof of what was run, a message that says the attempt
// already failed or needs a password / admin rights, and when stop_hook_active is set (no loops).
// A prompt to paste into a session in another project's window is not a shell command, so that check
// skips it; the third check below handles it.
// Second check, for the "Needs you" rule: blocks ONCE when a "Needs you" item tells the user to send,
// paste, type or run something ("send the handoff", "tell it to read the file", "run the login
// command") without the exact text in a code block or code span.
// Third check, for "a yes is the go-ahead": blocks ONCE when the reply hands the user a prompt to paste
// into a session in another project's window, and says to do the work from here if its own tools can.
// Silent when the user's last message asked for a handoff, or the reply says what the work needs a
// session there for (a skill, hook or MCP server that only loads in that project), or the prompt is the
// handoff skill's own ("... continue the work from "Where we are"").
// Fails open. RUN_YOURSELF=off disables it.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";

// Russian twins of the English patterns below (for `--language russian`). \b does not see Cyrillic letters,
// so these use the u flag, and « » stand for "no letter on this side". Each RU_ regex sits next to the
// English one it mirrors and is OR-ed in where the English one is used; the English patterns are untouched.
const ru = (src, flags = "iu") => new RegExp(src.replace(/«/g, "(?<!\\p{L})").replace(/»/g, "(?!\\p{L})"), flags);
const RU_RUN = "(?:запусти|запустите|вставь|вставьте|введи|введите|выполни|выполните|набери|наберите)";
const RU_TERM = String.raw`(?:терминал\p{L}*|powershell|командн\p{L}+\s+строк\p{L}*|cmd|консол\p{L}*|шелл\p{L}*|оболочк\p{L}*)`;
const RU_TRIGGERS = [
  ru(String.raw`«(?:открой|откройте|запусти|запустите|используй|используйте)\s+(?:(?:новый|свой|ваш|любой)\s+)?${RU_TERM}»`),
  ru(String.raw`«${RU_RUN}»[^.\n]{0,60}«(?:в|во|на|из)\s+(?:(?:новом|новой|своём|своем|вашем|любом|отдельном)\s+)?${RU_TERM}»`),
  ru(String.raw`«(?:вам|тебе|вы|ты)\s+(?:(?:нужно|надо|необходимо|следует|стоит|придётся|придется|можно)(?:\s+будет)?|можете|можешь|должны|должен|сможете|сможешь)\s+(?:(?:самим|самому|сами|сам)\s+)?(?:запустить|выполнить|вставить|ввести|набрать)»`),
  ru(String.raw`«(?:пожалуйста|просто|теперь|затем|потом|сначала|тогда)»[\s,]+«${RU_RUN}»`),
  ru(String.raw`«${RU_RUN}\s+(?:это|эту|эти|следующ\p{L}+|вот\s+это|вот\s+эту|вот\s+эти)»`),
  ru(String.raw`«${RU_RUN}\s+(?:его|её|ее|их)\s+сам\p{L}*»`),
  ru(String.raw`«скопиру\p{L}*\s+и\s+вставь\p{L}*»`),
];
const RU_EXEMPT = ru(String.raw`«я\s+(?:уже\s+)?(?:пробовал|пробовала|попробовал|попробовала|запускал|запускала|пытался|пыталась)»|«мо(?:я|ей|ю)\s+(?:собственн\p{L}+\s+)?попытк\p{L}*»|«(?:это|эта|этот|оно|она|он)\s+(?:не\s+сработал\p{L}*|не\s+удал\p{L}*|завершил\p{L}*\s+(?:с\s+)?ошибк\p{L}*|упал\p{L}*|провалил\p{L}*)»|«(?:заблокирован|отклонён|отклонен|запрещён|запрещен)\p{L}*»|«парол\p{L}*»|«от\s+имени\s+администратора»|«права\s+администратора»|«повышенн\p{L}+\s+(?:прав\p{L}*|привилег\p{L}*)»|«отказано\s+в\s+доступе»|«(?:разреши|разрешите|одобри|одобрите|подтверди|подтвердите)\s+(?:его|это|её|ее|эту|этот|запрос|вызов)[^.\n]{0,40}«(?:повтор\p{L}*|ещё\s+раз|еще\s+раз|снова|заново)»`);
const RU_SECRET_NOUN = String.raw`(?:api[ -]?ключ\p{L}*|ключ\p{L}*|секрет\p{L}*|парол\p{L}*|кодов\p{L}+\s+фраз\p{L}*|токен\p{L}*|код\s+подтверждения|одноразов\p{L}+\s+код|2FA(?:\s+код)?|пин-код\p{L}*|учётн\p{L}+\s+данн\p{L}*|учетн\p{L}+\s+данн\p{L}*)`;
const RU_SECRET_VERB = "(?:введи|введите|ввести|вставь|вставьте|вставить|впиши|впишите|вписать|подставь|подставьте|подставить|замени|замените|заменить|укажи|укажите|указать|набери|наберите|предоставь|предоставьте)";
const RU_SECRET_IN_CODE = ru(String.raw`<[^<>\n]*«(?:api[ -]?ключ\p{L}*|ключ\p{L}*|токен\p{L}*|секрет\p{L}*|парол\p{L}*|код|пин)»[^<>\n]*>|«ваш\p{L}*\s+(?:api[-_ ]?)?(?:ключ|токен|секрет|пароль)»`);
const RU_SECRET_BESIDE = ru(String.raw`«${RU_SECRET_VERB}»[^.\n]{0,40}«${RU_SECRET_NOUN}»|«${RU_SECRET_NOUN}»[^.\n]{0,40}«(?:вместо|плейсхолдер\p{L}*|подставьте|подставь|где\s+написано)»`);
const RU_PERSON_NOUN = "(?:друг|друга|другу|другом|друге|друзья|друзей|друзьям|подруга|подруги|подруге|коллега|коллеги|коллеге|коллегам|клиент|клиента|клиенту|заказчик|заказчика|человек|человека|человеку|кто-то|кто-нибудь|напарник|напарника)";
const RU_PLACE = "(?:компьютер|ноутбук|машин|терминал|проект|сесси|окн|чат)";
const RU_OTHER_PERSON = ru([
  String.raw`«(?:он|она)»\s+(?:открыва|запуска|вставля|вводи|набира|использу)\p{L}*»`,
  String.raw`«${RU_PERSON_NOUN}»[\s\S]{0,200}?«они»\s+(?:открыва|запуска|вставля|вводя|набира|использу|смогут|должны|могут|будут)\p{L}*»`,
  String.raw`«(?:отправь|отправьте|попроси|попросите|передай|передайте|перешли|перешлите)»\s+(?:ему|ей)»`,
  String.raw`«(?:друга|подруги|коллеги|клиента|заказчика)»\s+(?:(?:на|в)\s+)?(?:собственн\p{L}+\s+)?${RU_PLACE}\p{L}*»`,
  String.raw`«${RU_PLACE}\p{L}*\s+(?:друга|подруги|коллеги|клиента|заказчика|другого\s+человека)»`,
  String.raw`«(?:ваш\p{L}{0,3}|твой|твоего|твоему|твоим|твоей|твоя)\s+(?:друг|друга|другу|другом|друзья|друзей|друзьям|подруг\p{L}{0,2}|коллег\p{L}{0,2})»`,
].join("|"));
const RU_FOR_THIS_CHAT = ru(String.raw`«(?:в|во|на)\s+(?:этот|этом|этого|этому|эту|текущий|текущем|текущую)\s+(?:чат\p{L}*|сесси\p{L}*|разговор\p{L}*|диалог\p{L}*)[^.\x60]{0,30}$`);
const RU_SHOWN_OUTPUT = ru(String.raw`«(?:увидите|увидишь|видите|покажет|показывает|выведет|выводит|напечатает|печатает|вернёт|вернет|возвращает|выдаст|выдаёт|выдает|вывод|результат|ответ)»\s*:?\s*$`);
const RU_REFUSE = "(?:отклон\\p{L}*|отказ\\p{L}*|заблокир\\p{L}*|запрет\\p{L}*|запрещ\\p{L}*)";
const RU_GATE = "(?:разрешени\\p{L}*|хук(?:и|ов|а|у|ом|е)?|песочниц\\p{L}*|классификатор\\p{L}*|вызов\\p{L}*\\s+инструмент\\p{L}*|автоматическ\\p{L}+\\s+режим\\p{L}*)";
const RU_PERM_REFUSED = ru(`«${RU_GATE}»[^.\\n]{0,80}«${RU_REFUSE}»|«${RU_REFUSE}»[^.\\n]{0,60}«${RU_GATE}»`);
const ruOnlyTheUser = (c, near, before) =>
  RU_SECRET_IN_CODE.test(c.code) || RU_SECRET_BESIDE.test(near) || RU_OTHER_PERSON.test(near) ||
  RU_FOR_THIS_CHAT.test(before) || RU_SHOWN_OUTPUT.test(before) || RU_PERM_REFUSED.test(near);
const RU_SESSION_WORD = String.raw`(?:сесси\p{L}*|чат\p{L}*)`;
const ruForOtherProject = (around) =>
  ru(RU_SESSION_WORD).test(around) && ru(String.raw`«(?:окн\p{L}*|проект\p{L}*|рабоч\p{L}+\s+(?:област\p{L}*|пространств\p{L}*))»`).test(around) &&
  !ru(`«${RU_TERM}»`).test(around);
// "Needs you" items (the section heading in Russian) and what makes one vague
const RU_NEEDS_YOU = ru(String.raw`(?:^|\n)[ \t>]*(?:#{1,6}[ \t]*|[-*][ \t]+)?(?:\*\*|__)?(?:(?:что\s+)?(?:нужно|надо|требуется)\s+от\s+(?:вас|тебя)|от\s+(?:вас|тебя)\s+(?:нужно|требуется|надо))»`);
const RU_VAGUE = [
  { re: ru(String.raw`«(?:скажи|скажите|попроси|попросите|прикажи|укажи|укажите)\s+(?:ей|ему|им|(?:(?:новой|другой|свежей)\s+)?(?:сессии|чату|агенту|модели)|Claude)»`) },
  { re: ru(String.raw`«(?:отправь|отправьте|вставь|вставьте|дай|дайте|передай|передайте|перешли|перешлите)\s+(?:(?:ему|ей)\s+)?(?:(?:этот|эту|это|свой|ваш\p{L}*|следующ\p{L}*)\s+)?(?:\p{L}+\s+)?(?:handoff|хэндофф\p{L}*|хендофф\p{L}*|бриф\p{L}*|промпт\p{L}*|prompt|сообщени\p{L}*|инструкци\p{L}*|текст\p{L}*|команд\p{L}*|заметк\p{L}*)»`) },
  { re: ru(String.raw`«(?:запусти|выполни|введи|набери|используй)(?:те)?\s+(?:(?:эту|эти|ту|вашу|ваш|свою|ее|её|его)\s+)?(?:[\p{L}-]+\s+){0,2}(?:команд|скрипт|запрос|однострочник)\p{L}*»`) },
  { re: ru(String.raw`«(?:введи|вставь|задай|впиши|укажи)(?:те)?\s+(?:(?:это|эту|этот|нужн\p{L}+|своё|свое|свой|следующ\p{L}+)\s+)?(?:[\p{L}-]+\s+){0,2}(?:значени\p{L}*|настройк\p{L}*|поисков\p{L}+\s+(?:запрос|текст|фраз\p{L}*)|запрос\p{L}*|текст\p{L}*|url|адрес\p{L}*|путь|пут[ьи]\p{L}*|имя|имен\p{L}*)»`), anyCode: true },
];
const RU_SECRET = ru(String.raw`«(?:парол\p{L}*|секрет\p{L}*|токен\p{L}*|api[\s-]?ключ\p{L}*|ключ\s+api|код\s+подтверждения|одноразов\p{L}+\s+код|2FA|пин-код\p{L}*)»`);
const RU_RESEND = ru(String.raw`«(?:отправь|отправьте|пришли|пришлите|повтори|повторите|напиши|напишите)»[^.\n]{0,40}«(сообщени\p{L}*|запрос\p{L}*)»[^.\n]{0,30}«(?:ещё\s+раз|еще\s+раз|снова|заново|повторно)»`);
const RU_THEIRS = ru(String.raw`^[\s>*_#\-+\d.)]*[^.\n:;,]{1,60},\s*«(?:когда|если)\s+(?:вы\s+|ты\s+)?(?:захотите|захочешь|хотите|хочешь|решите|решишь|знаете|знаешь|выберете|выберешь)»|«(?:вы|ты)\s+(?:предпочтёте|предпочтете|предпочтешь|предпочитаете|предпочитаешь)»|«только\s+(?:вы|ты)\s+(?:знаете|знаешь|имеете|имеешь)»|«только\s+у\s+(?:вас|тебя)\s+есть»`);
const RU_CLAUDE_WRITES = ru(String.raw`«(?:handoff|хэндофф\p{L}*|хендофф\p{L}*|бриф\p{L}*|промпт\p{L}*|команд\p{L}*|скрипт\p{L}*|запрос\p{L}*|инструкци\p{L}*|сообщени\p{L}*|текст\p{L}*|заметк\p{L}*)»`);
const RU_NEEDS_SESSION = ru(String.raw`«(?:нужн\p{L}*|требу\p{L}*|необходим\p{L}*|работает\s+только|загружается\s+только|запускается\s+только)»[^.\n]{0,100}«(?:сесси\p{L}*|навык\p{L}*|скилл\p{L}*|хук(?:и|ов|а)?|mcp|плагин\p{L}*)»`);
const RU_HAND_VERB = ru(String.raw`«(?:вставь\p{L}*|вставля\p{L}*|введи\p{L}*|набери\p{L}*|отправь\p{L}*|отправля\p{L}*|дай\p{L}*|передай\p{L}*|скопируй\p{L}*)»`);
const RU_ASKED_FOR_HANDOFF = ru(String.raw`«(?:хэндофф|хендофф|хэнд-офф|хенд-офф)\p{L}*»|«(?:что|какой|какую|какие|как)»[^.?!\n]{0,80}«(?:сказать|написать|вставить|отправить|ввести|промпт\p{L}*|передать)»[^.?!\n]{0,60}«(?:нов\p{L}+|друг\p{L}+|отдельн\p{L}+|свеж\p{L}+)\s+(?:сесси\p{L}*|чат\p{L}*|окн\p{L}*|разговор\p{L}*)»`);

const REASON =
  "You told the user to run a command. Run it yourself now; hand it over only if your own attempt failed, or it needs a password only they can type.";
const REASON_VAGUE =
  'A "Needs you" item tells the user to send, paste, type or run something without giving the exact text. If a command can do it, run it yourself now. ' +
  "If the step really is theirs, rewrite the item: the exact text in a code block, where to paste it (which window or field), and what they should see afterwards.";
const REASON_HANDOVER =
  "You are handing the user a prompt to paste into another project's session. If your own tools can do that work from here (edit that project's files, run a command in its folder) " +
  "and the user asked for it or confirmed it, do it now and report what you did. Keep the handover only if the work needs a session inside that project, and then say what it needs that session for.";

const TRIGGERS = [
  /\b(open|launch|start|use)\s+(a|an|the|your)?\s*(new\s+)?(terminal|powershell|command prompt|cmd|shell|console)\b/i,
  /\b(run|paste|type|execute|enter)\b[^.\n]{0,60}\b(in|into|at|on|from)\s+(a|an|the|your)\s+(new\s+)?(terminal|powershell|shell|command prompt|cmd|console)\b/i,
  /\b(you|you'll|you will)\s+(need|have|must|should|can|could)\s+(to\s+)?(run|paste|type|execute)\b/i,
  /\b(please|just|now|then|first)\s+(run|paste|type|execute)\b/i,
  /\b(run|paste|type|execute)\s+(this|these|the following|it yourself)\b/i,
  /\bcopy\s*(and|&)\s*paste\b/i,
];
// The attempt already failed, or only the user can do it
const EXEMPT =
  /\b(I\s+(already\s+)?(tried|ran|attempted)|my\s+(own\s+)?attempt|(it|that|this)\s+(failed|didn'?t work|did not work)|(was|got|is)\s+(blocked|denied)|password|passphrase|as\s+(an\s+)?administrator|elevated|sudo|permission\s+denied|PermissionDenied|(allow|approve)\s+(it|the\s+\w+|this|that)\b[^.\n]{0,40}\b(retry|try\s+again))\b/i;

// Steps only the user can do, judged per code span from the text around it (sampled send-backs, 2026-10-30)
// A secret they hold, typed into their own machine: a placeholder or an assignment in the command itself, or
// the words right beside it ("paste your key in place of ..."). A bare word like "token" in the same
// paragraph is not enough ("Your login token expired. You need to run `gh auth login`"). PIN is upper case only.
const SECRET_IN_CODE = /\bsk-ant-|<[^<>\n]*\b(?:api[ -]?key|key|token|secret|password|passphrase|code|PIN)\b[^<>\n]*>|\bsetx\s+\w+\s+["']|\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE)\s*=|\byour[-_ ](?:api[-_ ]?)?(?:key|token|secret|password)\b/i;
const secretBeside = (noun, flags) => new RegExp(
  String.raw`\b(?:[Ee]nter|[Tt]ype|[Pp]aste|[Pp]ut|[Ii]nsert|[Ff]ill in|[Rr]eplace|[Ss]upply|[Pp]rovide)\b[^.\n]{0,40}\b${noun}\b|\b${noun}\b[^.\n]{0,40}\b(?:placeholder|in place of|goes in|where it says)\b`, flags);
const SECRET_BESIDE = secretBeside("(?:api[ -]?keys?|secrets?|passphrase|password|tokens?|verification code|one-time code|2FA(?: code)?|credentials?)", "i");
const PIN_BESIDE = secretBeside("PIN", "");
// The text is for another person to run on their own computer, not for this user. One regex for both checks.
// A pronoun counts when it is "he"/"she", or "they" with a person named in the 200 characters before it.
const OTHER_PERSON = new RegExp([
  String.raw`\b(?:he|she)\s+(?:opens?|runs?|pastes?|types?|needs?|should|can|will|uses?)\b`,
  String.raw`\b(?:friend|colleague|teammate|coworker|client|customer|maker|person|someone)\b[\s\S]{0,200}?\bthey\s+(?:open|run|paste|type|need|should|can|will|use)\b`,
  String.raw`\b(?:send|ask|tell|give)\s+(?:him|her)\b`,
  String.raw`\b(?:his|her|friend'?s?|other maker'?s?|someone else'?s?|another person'?s?)\s+(?:own\s+)?(?:computer|pc|machine|laptop|terminal|chat|project|session|window)\b`,
  String.raw`\btheir\s+own\s+(?:computer|pc|machine|laptop)\b`,
  String.raw`\b(?:your|the)\s+friend\b`,
].join("|"), "i");
// The code is a message to this chat, not a shell command: only the words just before it say so
const FOR_THIS_CHAT = /\b(?:in|into|to)\s+this\s+(?:chat|session|conversation)\b[^.`]{0,30}$/i;
// The permission system or a tool call refused the command: only the user can approve it (a refused push)
const PERM_REFUSED = /\b(?:permissions?|hook|sandbox|classifier|tool call|auto mode)\b[^.\n]{0,80}\b(?:refus|reject|declin|den)\w*|\b(?:refus|reject|declin)\w*\b[^.\n]{0,60}\b(?:permissions?|tool call|hook|sandbox|classifier)\b/i;
const around = (text, c) => text.slice(Math.max(0, c.at - 300), c.at) + " " + c.code + " " + text.slice(c.at + c.code.length, c.at + c.code.length + 200);
const onlyTheUser = (text, c) => {
  const near = around(text, c);
  const before = text.slice(Math.max(0, c.at - 120), c.at);
  return SECRET_IN_CODE.test(c.code) || SECRET_BESIDE.test(near) || PIN_BESIDE.test(near) || OTHER_PERSON.test(near) ||
    FOR_THIS_CHAT.test(before) || /\b(?:see|shows?|prints?|says?|reads?|returns?|displays?|output)\s*:?\s*$/i.test(before) || // output shown, not a command
    PERM_REFUSED.test(near) || SKILL_PROMPT.test(c.code) || CHAT_REPLY(c.code, near) || ruOnlyTheUser(c, near, before);
};
// A short reply the user types back to Claude ("go", "go, the rule only", "commit the skill edits"),
// not a shell command: the text beside it says type or reply, up to 8 words, no path, pipe, flag or variable,
// and no program name first. Taking one for a command made Claude answer this hook and then refuse the user's
// real "go". Without the type/reply cue, "run `pnpm install`" slipped through.
const SHELL_FIRST = /^(?:git|gh|npm|npx|node|python3?|py|pip|uv|uvx|bash|sh|cd|ls|dir|cat|rm|mv|cp|mkdir|powershell|pwsh|cmd|winget|choco|scoop|brew|curl|wget|claude|code|docker|java|gradle|mvn|cargo|go\s+(?:run|build|get|install|test|mod)|set|setx|export|start|explorer|ssh|tar|unzip)\b/i;
const CHAT_REPLY = (code, near) => {
  const s = code.trim();
  return /\b(?:type|reply|answer|say)\b/i.test(near) && s.length > 0 && s.split(/\s+/).length <= 8 && !/[\/\\|$=<>{}`;]|(?:^|\s)--?\w|\.\w{1,4}\b/.test(s) && !SHELL_FIRST.test(s) &&
    !/\b(?:terminal|powershell|shell|command prompt|cmd|console)\b/i.test(near);
};

const codeCandidates = (text) => {
  const out = [];
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) out.push({ at: m.index, code: m[1].trim() });
  const noBlocks = text.replace(/```[\s\S]*?```/g, (b) => " ".repeat(b.length));
  for (const m of noBlocks.matchAll(/`([^`\n]+)`/g)) out.push({ at: m.index, code: m[1].trim() });
  return out;
};
// A multi-word command the user would type in a shell: not a /slash command, URL, localhost or bare path
const shellLike = (c) =>
  /\s/.test(c) && !/^\/[\w:-]+(\s|$)/.test(c) && !/^https?:/i.test(c) && !/localhost|127\.0\.0\.1/i.test(c) && !/^[A-Za-z]:[\\/][^\s]*$/.test(c);

// The text around the code says it goes into a session or chat in another project's window, not a terminal
const forOtherProject = (text, c) => {
  const around = text.slice(Math.max(0, c.at - 300), c.at) + " " + text.slice(c.at + c.code.length, c.at + c.code.length + 200);
  return (/\b(session|chat)\b/i.test(around) && /\b(window|project|workspace)\b/i.test(around) &&
    !/\b(terminal|powershell|command prompt|cmd|shell|console)\b/i.test(around)) || ruForOtherProject(around);
};

// "Needs you" items that hand over typing or pasting without the text. anyCode: a one-word code span is enough (a value)
const VAGUE = [
  { re: /\b(tell|ask|instruct|point|direct)\s+(it|the\s+(new\s+|other\s+|fresh\s+)?(session|chat|agent|claude|model))\b/i },
  { re: /\b(send|paste|give|hand|pass|forward|submit)\s+(it\s+|over\s+)?(the|this|that|a|your)\s+(\w+\s+)?(handoff|brief|prompt|message|instructions?|text|command|note)\b/i },
  { re: /\b(run|rerun|execute|type|enter|use)\s+(the|a|an|that|this|your|its)\s+([\w-]+\s+){0,2}(command|script|query|one-liner)\b/i },
  { re: /\b(enter|type|paste|set|fill\s+in|put\s+in)\s+(the|a|an|that|this)\s+([\w-]+\s+){0,2}(value|setting|search\s+(text|term|phrase)|query|text|url|path|name)\b/i, anyCode: true },
];
// Only the user has it, so there is no text to give
const SECRET = /\b(password|passphrase|api key|secret|token|verification code|one-time code|2FA|PIN)\b/;
// The item asks for something only the user knows or has ("the address, when you want it on the page"), or to
// send their own earlier message again: the text is theirs, so there is none to give. Not for an item that
// names a handoff, brief, prompt or command, which Claude writes (CLAUDE_WRITES, checked on both).
// THEIRS is anchored: the item opens with the thing asked for ("The server address, when you want it ...");
// a leading timing clause ("When you get a minute, tell the new session ...") is not a value only they hold.
const RESEND = /\b(?:send|resend|retype|repeat)\b[^.\n]{0,40}\b(message|request)\b[^.\n]{0,30}\bagain\b/i;
const THEIRS = /^[\s>*_#\-+\d.)]*(?:the|any|your|an?)\s+[^.\n:;,]{1,60},\s*(?:when|if)\s+you\s+(?:want|have|know|decide|choose|pick)\b|\byou'd\s+rather\b|\bonly\s+you\s+(?:know|have)\b/i;
const CLAUDE_WRITES = /\b(?:handoff|brief|prompt|command|script|query|instructions?|messages?|text|notes?)\b/i;
// Their own earlier message sent again: judged on the sentence it sits in, without the noun it names
const resendIsTheirs = (item) => {
  const m = RESEND.exec(item);
  if (!m) {
    const r = RU_RESEND.exec(item);
    if (!r) return false;
    const beforeRu = item.slice(0, r.index).split(/[.!?\n]/).pop();
    const afterRu = item.slice(r.index + r[0].length).split(/[.!?\n]/)[0];
    return !RU_CLAUDE_WRITES.test(beforeRu + " " + r[0].replace(r[1], " ") + " " + afterRu);
  }
  const before = item.slice(0, m.index).split(/[.!?\n]/).pop();
  const after = item.slice(m.index + m[0].length).split(/[.!?\n]/)[0];
  return !CLAUDE_WRITES.test(before + " " + m[0].replace(new RegExp(`\\b${m[1]}\\b`, "i"), " ") + " " + after);
};

// The "Needs you" section split into its top-level items (text before the first bullet is an item too)
const needsYouItems = (text) => {
  const m = /(?:^|\n)[ \t>]*(?:#{1,6}[ \t]*|[-*][ \t]+)?(?:\*\*|__)?needs you\b/i.exec(text) || RU_NEEDS_YOU.exec(text);
  if (!m) return [];
  let section = text.slice(m.index + m[0].length);
  const end = section.search(/\n#{1,6}[ \t]/);
  if (end >= 0) section = section.slice(0, end);
  const items = [[]];
  let fenced = false;
  for (const line of section.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^ {0,3}([-*+]|\d+[.)])\s+/.test(line)) items.push([]);
    items[items.length - 1].push(line);
  }
  return items.map((i) => i.join("\n")).filter((i) => i.trim());
};

export const vagueNeedsYou = (text) => {
  if (!text) return false;
  return needsYouItems(text).some((item) => {
    if (SECRET.test(item) || RU_SECRET.test(item)) return false;
    if (resendIsTheirs(item) || ((THEIRS.test(item) || RU_THEIRS.test(item)) && !(CLAUDE_WRITES.test(item) || RU_CLAUDE_WRITES.test(item)))) return false;
    const prose = item.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]+`/g, " ");
    const codes = codeCandidates(item).map((c) => c.code).filter(Boolean);
    const exact = codes.some((c) => /\s/.test(c) || c.startsWith("/"));
    return [...VAGUE, ...RU_VAGUE].some((v) => v.re.test(prose) && !(v.anyCode ? codes.length : exact));
  });
};

export const asksUserToRun = (text) => {
  if (!text || EXEMPT.test(text) || RU_EXEMPT.test(text)) return false;
  const codes = codeCandidates(text).filter((c) => shellLike(c.code) && !forOtherProject(text, c) && !onlyTheUser(text, c));
  if (!codes.length) return false;
  for (const re of [...TRIGGERS, ...RU_TRIGGERS]) {
    const m = re.exec(text);
    if (!m) continue;
    const from = m.index - 100, to = m.index + m[0].length + 300;
    if (codes.some((c) => c.at >= from && c.at <= to)) return true;
  }
  return false;
};

// The reply says why the work has to happen in a session of that project
const NEEDS_SESSION =
  /\b(needs?|requires?|has to run in|must run in|only (runs?|works?|loads?) in)\b[^.\n]{0,100}\b(session|skills?|hooks?|MCP|plugins?)\b/i;

// OTHER_PERSON (above) also covers a prompt meant for another person: nothing here can reach their computer
// The prompt the handoff skill itself tells Claude to hand over ("Read <brief> and continue the work from
// "Where we are"..."): a handoff the skill was asked for, not work Claude could do from here
const SKILL_PROMPT = /\bcontinue the work from\s+["“”']?Where we are\b/i;

export const handsOverPrompt = (text) => {
  if (!text || NEEDS_SESSION.test(text) || RU_NEEDS_SESSION.test(text) || OTHER_PERSON.test(text) || RU_OTHER_PERSON.test(text)) return false;
  return codeCandidates(text).some((c) => {
    if (!shellLike(c.code) || !forOtherProject(text, c) || SKILL_PROMPT.test(c.code)) return false;
    const lead = text.slice(Math.max(0, c.at - 300), c.at);
    return /\b(paste|type|send|give)\b/i.test(lead) || RU_HAND_VERB.test(lead);
  });
};

// What the user last typed (not a tool result), to see whether they asked for the handoff themselves
const lastUserText = (transcriptPath) => {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.type !== "user") continue;
    const c = e.message?.content;
    const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
    if (t.trim()) return t;
  }
  return "";
};
// The user asked for the handoff, or asked what exactly to tell or paste into the new session
const ASKED_FOR_TEXT = /\b(?:what|which|how)\b[^.?!\n]{0,80}\b(?:tells?|say|says|paste|send|type|prompt|write)\b[^.?!\n]{0,60}\b(?:new|another|other|fresh|separate)\s+(?:session|chat|window|conversation)\b/i;
export const askedForHandoff = (t) => /\bhand[\s-]?off\b/i.test(t) || ASKED_FOR_TEXT.test(t) || RU_ASKED_FOR_HANDOFF.test(t);
const userAskedForHandoff = (input) => {
  try { return askedForHandoff(lastUserText(input.transcript_path)); } catch { return false; }
};

// The text Claude wrote after its last tool call (the part the user reads as the reply)
const lastReply = (transcriptPath) => {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.type === "user") break;
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    if (e.message.content.some((b) => b.type === "tool_use")) break;
    const t = e.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (t) parts.unshift(t);
  }
  return parts.join("\n");
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if (process.env.RUN_YOURSELF === "off") return;
      const input = JSON.parse(raw);
      if (input.stop_hook_active) return;
      const text = typeof input.last_assistant_message === "string" && input.last_assistant_message
        ? input.last_assistant_message
        : input.transcript_path ? lastReply(input.transcript_path) : "";
      if (asksUserToRun(text)) process.stdout.write(JSON.stringify({ decision: "block", reason: REASON }));
      else if (vagueNeedsYou(text)) process.stdout.write(JSON.stringify({ decision: "block", reason: REASON_VAGUE }));
      else if (handsOverPrompt(text) && !userAskedForHandoff(input)) process.stdout.write(JSON.stringify({ decision: "block", reason: REASON_HANDOVER }));
    } catch (err) {
      crashLog("run-yourself", err);
      // fail open
    }
  });
}
