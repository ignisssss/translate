import './style.css';
import { Dictionary } from './core/search.js';
import { DIRECTIONS, translateText } from './core/translator.js';
import { mountKeyboard } from './ui/keyboard.js';
import { renderCard } from './ui/card.js';

const $ = (id) => document.getElementById(id);
const els = {
  src: $('src'), out: $('out'), suggest: $('suggest'), entry: $('entry-body'), status: $('status'),
  srcLabel: $('src-label'), dstLabel: $('dst-label'), kbdWrap: $('kbd-wrap'), kbd: $('kbd'),
  kbdToggle: $('kbd-toggle'), font: $('font'), stats: $('stats'),
};

const state = {
  dict: null,
  dir: DIRECTIONS.CU_RU,
  translation: null,
  selected: null, // индекс слова в предложении
  active: 0, // выбранное совпадение в карточке
  override: null, // статья, открытая по ссылке «связанные слова»
  suggestions: [],
  suggestIndex: -1,
};

// ───── хранилище настроек (может быть недоступно) ─────
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (_) { /* приватный режим */ }
  return null;
}

// ───── шрифт ─────
function applyFont(v) {
  const font = ['standard', 'monomakh', 'ponomar'].includes(v) ? v : 'standard';
  document.documentElement.dataset.font = font;
  els.font.value = font;
  store('ocs.font', font);
}
els.font.addEventListener('change', () => applyFont(els.font.value));
applyFont(store('ocs.font'));

// ───── клавиатура ─────
mountKeyboard(els.kbd, els.src, () => schedule(0));
function setKeyboardOpen(open) {
  els.kbd.hidden = !open;
  els.kbdToggle.setAttribute('aria-expanded', String(open));
  els.kbdWrap.classList.toggle('collapsed', !open);
  store('ocs.kbd', open ? '1' : '0');
}
els.kbdToggle.addEventListener('click', () => setKeyboardOpen(els.kbd.hidden));
setKeyboardOpen(store('ocs.kbd') !== '0');

// ───── направление ─────
function applyDirection() {
  const cuToRu = state.dir === DIRECTIONS.CU_RU;
  els.srcLabel.textContent = cuToRu ? 'Старославянский' : 'Русский';
  els.dstLabel.textContent = cuToRu ? 'Русский' : 'Старославянский';
  els.src.classList.toggle('cu', cuToRu);
  els.out.classList.toggle('cu-out', !cuToRu);
  els.kbdWrap.hidden = !cuToRu;
  els.src.placeholder = cuToRu
    ? 'Введите старославянское слово или предложение'
    : 'Введите русское слово или предложение';
}

$('swap').addEventListener('click', () => {
  const plain = state.translation && state.translation.plain.trim();
  state.dir = state.dir === DIRECTIONS.CU_RU ? DIRECTIONS.RU_CU : DIRECTIONS.CU_RU;
  if (plain) els.src.value = plain;
  state.selected = null;
  state.override = null;
  applyDirection();
  schedule(0);
  els.src.focus();
});

$('clear').addEventListener('click', () => {
  els.src.value = '';
  state.selected = null;
  state.override = null;
  schedule(0);
  els.src.focus();
});

$('copy').addEventListener('click', async () => {
  const text = state.translation ? state.translation.plain : '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (__) { /* нет доступа */ }
    ta.remove();
  }
  flash('Скопировано');
});

let flashTimer;
function flash(msg) {
  els.status.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { els.status.textContent = ''; }, 1600);
}

// ───── вывод ─────
function span(cls, text) {
  const n = document.createElement('span');
  if (cls) n.className = cls;
  n.textContent = text;
  return n;
}

function renderOutput() {
  const t = state.translation;
  els.out.textContent = '';
  if (!t || !t.tokens.some((x) => x.word)) {
    els.out.appendChild(span('placeholder', 'Перевод'));
    return;
  }
  const outIsCu = state.dir === DIRECTIONS.RU_CU;

  if (t.mode === 'word') {
    const tok = t.tokens.find((x) => x.word);
    if (!tok.found) {
      els.out.appendChild(span('nf', 'Слово не найдено в словаре'));
      return;
    }
    const main = span('word-main' + (outIsCu ? ' cu' : ''), tok.out);
    els.out.appendChild(main);
    const list = document.createElement('ul');
    list.className = 'alts';
    for (const m of tok.result.matches.slice(0, 5)) {
      const li = document.createElement('li');
      if (state.dir === DIRECTIONS.CU_RU) {
        li.append(span('cu', m.entry.headword), span('pos', m.entry.pos),
          span(null, m.entry.ru.join('; ') || (m.entry.en || []).join('; ')));
      } else {
        li.append(span('cu', m.entry.headword), span('pos', m.entry.pos), span(null, m.entry.ru.join('; ')));
      }
      list.appendChild(li);
    }
    els.out.appendChild(list);
    return;
  }

  const box = document.createElement('div');
  box.className = 'sentence' + (outIsCu ? ' cu' : '');
  for (const tok of t.tokens) {
    if (!tok.word) { box.appendChild(document.createTextNode(tok.text)); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    const approx = tok.kind === 'stem' || tok.kind === 'fuzzy';
    b.className = 'tok ' + (!tok.found ? 'tok-unk' : approx ? 'tok-approx' : 'tok-ok')
      + (state.selected === tok.index ? ' tok-sel' : '');
    b.textContent = tok.out;
    b.title = tok.found ? `${tok.text} → ${tok.out}` : `${tok.text}: нет в словаре`;
    b.addEventListener('click', () => {
      state.selected = tok.index;
      state.active = 0;
      state.override = null;
      renderOutput();
      renderEntry();
      document.getElementById('entry-title').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    box.appendChild(b);
  }
  els.out.appendChild(box);
}

function currentResult() {
  const t = state.translation;
  if (!t) return null;
  if (state.override) {
    return { query: state.override.headword, normalized: state.override.headword, matches: [{ entry: state.override, kind: 'exact' }] };
  }
  const words = t.tokens.filter((x) => x.word);
  if (t.mode === 'word') return words[0] ? words[0].result : null;
  const sel = words.find((x) => x.index === state.selected);
  return sel ? sel.result : null;
}

function renderEntry() {
  const t = state.translation;
  const result = currentResult();
  const sentenceNoSel = t && t.mode === 'sentence' && !result && !state.override;
  if (sentenceNoSel) {
    els.entry.textContent = '';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Нажмите на слово в переводе, чтобы открыть его словарную статью. Подчёркнутые сплошной линией слова найдены точно, пунктиром — приблизительно, серым выделены неизвестные.';
    els.entry.appendChild(p);
    return;
  }
  renderCard(els.entry, {
    dir: state.dir,
    result,
    active: state.active,
    onSelectMatch: (i) => { state.active = i; renderEntry(); },
    onOpenHeadword: (h) => {
      const e = state.dict.getByHeadword(h);
      if (!e) return;
      state.override = e;
      state.active = 0;
      renderEntry();
    },
  });
}

// ───── подсказки ─────
function renderSuggest() {
  const ul = els.suggest;
  ul.textContent = '';
  const items = state.suggestions;
  ul.hidden = !items.length;
  items.forEach((s, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.className = 'sg' + (i === state.suggestIndex ? ' sg-active' : '');
    if (state.dir === DIRECTIONS.CU_RU) {
      li.append(span('cu sg-main', s.entry.headword), span('sg-sub', s.entry.ru[0] || ''));
    } else {
      li.append(span('sg-main', s.via), span('sg-sub cu', s.entry.headword));
    }
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickSuggestion(i);
    });
    ul.appendChild(li);
  });
}

function pickSuggestion(i) {
  const s = state.suggestions[i];
  if (!s) return;
  els.src.value = state.dir === DIRECTIONS.CU_RU ? s.entry.headword : s.via;
  state.suggestions = [];
  state.suggestIndex = -1;
  renderSuggest();
  schedule(0);
}

function updateSuggestions() {
  const text = els.src.value.trim();
  const oneWord = text && !/\s/.test(text);
  if (!oneWord || document.activeElement !== els.src) {
    state.suggestions = [];
  } else {
    const list = state.dir === DIRECTIONS.CU_RU ? state.dict.suggestCu(text, 7) : state.dict.suggestRu(text, 7);
    // не предлагаем то, что уже введено целиком
    state.suggestions = list.filter((s) => {
      const label = state.dir === DIRECTIONS.CU_RU ? s.entry.headword : s.via;
      return label !== text;
    });
  }
  state.suggestIndex = -1;
  renderSuggest();
}

els.src.addEventListener('keydown', (e) => {
  const n = state.suggestions.length;
  if (!n || els.suggest.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); state.suggestIndex = (state.suggestIndex + 1) % n; renderSuggest(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); state.suggestIndex = (state.suggestIndex - 1 + n) % n; renderSuggest(); }
  else if (e.key === 'Enter' && state.suggestIndex >= 0) { e.preventDefault(); pickSuggestion(state.suggestIndex); }
  else if (e.key === 'Escape') { state.suggestions = []; renderSuggest(); }
});
els.src.addEventListener('blur', () => { state.suggestions = []; renderSuggest(); });
els.src.addEventListener('focus', updateSuggestions);

// ───── основной цикл ─────
let timer;
function schedule(delay = 120) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run() {
  if (!state.dict) return;
  const text = els.src.value;
  const prevMode = state.translation && state.translation.mode;
  state.translation = text.trim() ? translateText(state.dict, text, state.dir) : null;
  if (!state.translation || state.translation.mode !== prevMode) state.selected = null;
  state.override = null;
  state.active = 0;
  renderOutput();
  renderEntry();
  updateSuggestions();
  saveHash();
}

els.src.addEventListener('input', () => schedule());

function saveHash() {
  try {
    const p = new URLSearchParams();
    if (els.src.value.trim()) p.set('q', els.src.value.trim());
    if (state.dir !== DIRECTIONS.CU_RU) p.set('d', state.dir);
    const h = p.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  } catch (_) { /* file:// и т. п. */ }
}

function loadHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (p.get('d') === DIRECTIONS.RU_CU) state.dir = DIRECTIONS.RU_CU;
  if (p.get('q')) els.src.value = p.get('q');
}

// ───── запуск ─────
async function init() {
  applyDirection();
  renderOutput();
  renderEntry();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/dictionary.json`);
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const data = await res.json();
    state.dict = new Dictionary(data.entries);
  } catch (err) {
    els.out.textContent = '';
    els.out.appendChild(span('nf', 'Не удалось загрузить словарь: ' + err.message));
    return;
  }
  els.stats.textContent = `В словаре ${state.dict.size} статей`;
  loadHash();
  applyDirection();
  run();
}
init();
