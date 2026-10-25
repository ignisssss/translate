// Словарная карточка («Словарная статья и грамматика»).
import { transliterate } from '../core/normalizer.js';
import { DIRECTIONS } from '../core/translator.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function cu(text, tag = 'span') {
  return el(tag, 'cu', text);
}

const KIND_LABEL = {
  [DIRECTIONS.CU_RU]: {
    exact: 'Точное совпадение',
    form: 'Известная форма слова',
    titlo: 'Слово под титлом',
    loose: 'Совпадение по нормализованному написанию',
    stem: 'Приблизительно: форма слова с неизвестным окончанием',
    fuzzy: 'Похожее написание, возможна опечатка',
  },
  [DIRECTIONS.RU_CU]: {
    exact: 'Точное совпадение по значению',
    stem: 'Совпадение по основе слова',
    fuzzy: 'Похожее написание, возможна опечатка',
  },
};

export const LANG_LABEL = { chu: 'Старославянский', cs: 'Церковнославянский', orv: 'Древнерусский' };
export const LANG_SHORT = { chu: 'ст.-слав.', cs: 'церк.-слав.', orv: 'др.-рус.' };

const SOURCE_LABEL = {
  manual: 'словарь проекта', dyachenko: 'Дьяченко (Большой церковно-славянский словарь)',
  kcs: 'Краткий церковнославянский словарь', 'chu-dict': 'Old Church Slavonic Dictionary',
  'chu-gloss': 'Old Church Slavonic Glossary', 'pitt-chu': 'Pitt (chu–eng)', 'pitt-orv': 'Pitt (древнерусско-русский)',
  lexicon: 'church-slavonic (грамматика, ударения)', syntacticus: 'Syntacticus (формы, частоты)',
  kaikki: 'Викисловарь',
};

const MAX_CHIPS = 40;

/** Статья вместе с полными данными из чанка (если они уже загружены). */
export function entryView(e) {
  const d = e.detail || {};
  return {
    ...e,
    ru: d.ru || e.ru,
    en: d.en || e.en,
    gloss: d.gloss || e.gloss || '',
    grammar: d.grammar || e.grammar || '',
    etymology: d.etymology || e.etymology || '',
    greek: d.greek || e.greek || '',
    note: d.note || e.note || '',
    stress: d.stress || e.stress || '',
    examples: d.examples || e.examples || [],
    related: d.related || e.related || [],
    variants: d.variants || e.variants || [],
    forms: d.forms || e.forms || [],
    titlo: d.titlo || e.titlo || [],
    sources: d.sources || e.sources || [],
    attested: d.attested || [],
    freq: d.freq || 0,
  };
}

function row(dl, label, node) {
  dl.appendChild(el('dt', null, label));
  const dd = el('dd');
  dd.appendChild(node);
  dl.appendChild(dd);
}

function chips(items, { cuFont = true, onClick, max = MAX_CHIPS } = {}) {
  const box = el('div', 'chips');
  for (const it of items.slice(0, max)) {
    const c = onClick ? el('button', 'chip chip-btn') : el('span', 'chip');
    if (onClick) { c.type = 'button'; c.addEventListener('click', () => onClick(it)); }
    c.textContent = it;
    if (cuFont) c.classList.add('cu');
    box.appendChild(c);
  }
  if (items.length > max) box.appendChild(el('span', 'chip chip-more', `и ещё ${items.length - max}`));
  return box;
}

/**
 * ctx: { dir, result, active, onSelectMatch(i), onOpenHeadword(h) }
 */
export function renderCard(root, ctx) {
  root.textContent = '';
  const { result, dir } = ctx;
  if (!result || !result.query) {
    root.appendChild(el('p', 'hint', 'Введите слово или предложение. Здесь появятся часть речи, раскрытие титла, толкование, родственные слова и пример употребления. В предложении нажмите на слово, чтобы открыть его статью.'));
    return;
  }
  if (!result.matches.length) {
    const p = el('p', 'hint');
    p.append('Слово «', result.query, '» не найдено в словаре. ');
    p.append(dir === DIRECTIONS.CU_RU
      ? 'Попробуйте другое написание (ѣ можно заменить на е, ъ и ь не обязательны) или введите слово латиницей, например bogŭ.'
      : 'Попробуйте другую форму слова или синоним.');
    root.appendChild(p);
    return;
  }

  const matches = result.matches;
  const active = Math.min(ctx.active || 0, matches.length - 1);
  const m = matches[active];
  const e = entryView(m.entry);

  if (matches.length > 1) {
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    matches.forEach((x, i) => {
      const b = el('button', 'tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === active));
      b.append(cu(x.entry.headword), ' ');
      b.appendChild(el('small', null, LANG_SHORT[x.entry.lang] || ''));
      b.addEventListener('click', () => ctx.onSelectMatch(i));
      tabs.appendChild(b);
    });
    root.appendChild(tabs);
  }

  const head = el('div', 'entry-head');
  head.appendChild(cu(e.headword, 'span')).classList.add('hw');
  head.appendChild(el('span', 'translit', `[${transliterate(e.headword)}]`));
  if (e.pos) head.appendChild(el('span', 'pos', e.pos));
  head.appendChild(el('span', 'badge badge-lang', LANG_LABEL[e.lang] || ''));
  head.appendChild(el('span', 'badge badge-' + m.kind, (KIND_LABEL[dir] || {})[m.kind] || m.kind));
  root.appendChild(head);

  if (e.stress) {
    const s = el('p', 'via');
    s.append('С ударением: ', cu(e.stress));
    root.appendChild(s);
  }

  if (m.kind === 'titlo') {
    const t = el('div', 'titlo-box');
    t.appendChild(el('span', 'titlo-label', 'Раскрытие титла'));
    t.appendChild(cu(m.abbr, 'span')).classList.add('titlo-from');
    t.appendChild(el('span', 'titlo-arrow', '→'));
    t.appendChild(cu(m.full, 'span')).classList.add('titlo-to');
    root.appendChild(t);
  } else if (m.kind === 'form' || m.kind === 'stem' || m.kind === 'loose' || m.kind === 'fuzzy') {
    if (dir === DIRECTIONS.CU_RU && result.query.toLowerCase() !== e.headword.toLowerCase()) {
      const p = el('p', 'via');
      p.append('Запрос ', cu(result.query), ' → слово ', cu(e.headword));
      root.appendChild(p);
    }
  }

  const dl = el('dl', 'meta');

  const mean = el('div');
  if (e.ru.length) {
    const ol = el('ol', 'meanings');
    e.ru.forEach((r) => ol.appendChild(el('li', null, r)));
    mean.appendChild(ol);
  }
  if (e.en.length) {
    mean.appendChild(el('p', e.ru.length ? 'sub' : 'muted',
      (e.ru.length ? 'По-английски: ' : 'Русский перевод пока не добавлен. По-английски: ') + e.en.join('; ')));
  }
  if (e.gloss) mean.appendChild(el('p', 'gloss', e.gloss));
  row(dl, 'Толкование', mean);

  const gram = el('div');
  gram.appendChild(el('p', null, e.grammar || e.pos || 'Грамматические сведения не указаны'));
  const forms = [...e.forms];
  if (forms.length) {
    gram.appendChild(el('p', 'sub', 'Формы слова'));
    gram.appendChild(chips(forms));
  }
  row(dl, 'Грамматика', gram);

  if (e.variants.length) row(dl, 'Другие написания', chips(e.variants, { max: 20 }));
  if (e.titlo.length) row(dl, 'Под титлом', chips(e.titlo));
  if (e.related.length) {
    row(dl, 'Однокоренные и связанные слова', chips(e.related, { onClick: ctx.onOpenHeadword }));
  }
  if (e.greek) row(dl, 'Греческий', el('span', 'greek', e.greek));
  if (e.etymology) row(dl, 'Этимология', el('span', null, e.etymology));
  if (e.note) row(dl, 'Примечание', el('span', null, e.note));
  if (e.attested.length) {
    row(dl, 'Засвидетельствовано', el('span', null, e.attested.join(', ') + (e.freq ? ` (всего употреблений: ${e.freq})` : '')));
  }

  const ex = el('div');
  if (e.examples.length) {
    for (const x of e.examples) {
      const q = el('blockquote', 'example');
      q.appendChild(cu(x.cu, 'div')).classList.add('example-cu');
      if (x.ru) q.appendChild(el('div', 'example-ru', x.ru));
      if (x.en) q.appendChild(el('div', 'example-ru muted-i', x.en));
      if (x.source) q.appendChild(el('div', 'example-src', x.source));
      ex.appendChild(q);
    }
  } else {
    ex.appendChild(el('p', 'muted', 'Для этой статьи пример употребления пока не добавлен.'));
  }
  row(dl, 'Пример', ex);

  if (e.sources.length) {
    row(dl, 'Источники', el('span', 'sub', e.sources.map((s) => SOURCE_LABEL[s] || s).join('; ')));
  }

  root.appendChild(dl);

  if (m.entry.chunk && !m.entry.detail) {
    root.appendChild(el('p', 'loading', 'Загружается полная статья…'));
  }
}
