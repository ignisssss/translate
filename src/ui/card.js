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

function row(dl, label, node) {
  dl.appendChild(el('dt', null, label));
  const dd = el('dd');
  dd.appendChild(node);
  dl.appendChild(dd);
}

function chips(items, { cuFont = true, onClick } = {}) {
  const box = el('div', 'chips');
  for (const it of items) {
    const c = onClick ? el('button', 'chip chip-btn') : el('span', 'chip');
    if (onClick) { c.type = 'button'; c.addEventListener('click', () => onClick(it)); }
    c.textContent = it;
    if (cuFont) c.classList.add('cu');
    box.appendChild(c);
  }
  return box;
}

/**
 * ctx: { dir, result, active, query, onSelectMatch(i), onOpenHeadword(h) }
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
  const e = m.entry;

  if (matches.length > 1) {
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    matches.forEach((x, i) => {
      const b = el('button', 'tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === active));
      b.append(cu(x.entry.headword), ' ');
      b.appendChild(el('small', null, x.entry.pos));
      b.addEventListener('click', () => ctx.onSelectMatch(i));
      tabs.appendChild(b);
    });
    root.appendChild(tabs);
  }

  const head = el('div', 'entry-head');
  head.appendChild(cu(e.headword, 'span')).classList.add('hw');
  head.appendChild(el('span', 'translit', `[${transliterate(e.headword)}]`));
  head.appendChild(el('span', 'pos', e.pos));
  const badge = el('span', 'badge badge-' + m.kind, (KIND_LABEL[dir] || {})[m.kind] || m.kind);
  head.appendChild(badge);
  root.appendChild(head);

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
  } else if (e.en && e.en.length) {
    mean.appendChild(el('p', 'muted', 'Русский перевод пока не добавлен. По-английски: ' + e.en.join('; ')));
  }
  if (e.gloss) mean.appendChild(el('p', 'gloss', e.gloss));
  row(dl, 'Толкование', mean);

  const gram = el('div');
  gram.appendChild(el('p', null, e.grammar || e.pos));
  if (e.forms.length) {
    gram.appendChild(el('p', 'sub', 'Формы слова'));
    gram.appendChild(chips(e.forms));
  }
  row(dl, 'Грамматика', gram);

  if (e.titlo.length) {
    row(dl, 'Под титлом', chips(e.titlo));
  }

  if (e.related.length) {
    row(dl, 'Однокоренные и связанные слова', chips(e.related, { onClick: ctx.onOpenHeadword }));
  }
  if (e.greek) row(dl, 'Греческий', el('span', 'greek', e.greek));
  if (e.etymology) row(dl, 'Этимология', el('span', null, e.etymology));
  if (e.note) row(dl, 'Примечание', el('span', null, e.note));

  const ex = el('div');
  if (e.examples.length) {
    for (const x of e.examples) {
      const q = el('blockquote', 'example');
      q.appendChild(cu(x.cu, 'div')).classList.add('example-cu');
      q.appendChild(el('div', 'example-ru', x.ru));
      if (x.source) q.appendChild(el('div', 'example-src', x.source));
      ex.appendChild(q);
    }
  } else {
    ex.appendChild(el('p', 'muted', 'Для этой статьи пример употребления пока не добавлен.'));
  }
  row(dl, 'Пример', ex);

  root.appendChild(dl);
}
