// Клавиатура со спецсимволами старославянской кириллицы: основной ряд и раскрывающийся дополнительный.

// знаки, которые ставятся над предыдущей буквой (на кнопке рисуются с пунктирным кружком)
const COMBINING = new Set(['҃', '҇', '҆', '́', '̀', '҄']);

export const MAIN_KEYS = [
  ['ѣ', 'ять'], ['ѧ', 'малый юс'], ['ѫ', 'большой юс'], ['ѩ', 'йотированный малый юс'], ['ѭ', 'йотированный большой юс'],
  ['ѡ', 'омега'], ['ѱ', 'пси'], ['ѯ', 'кси'], ['ѳ', 'фита'], ['ѵ', 'ижица'], ['ѕ', 'зело'], ['і', 'и десятеричное'],
  ['ъ', 'ер'], ['ь', 'ерь'], ['҃', 'титло (над предыдущей буквой)'], ['҇', 'покрытие (над предыдущей буквой)'],
  ['ѥ', 'йотированное е'], ['ꙗ', 'йотированное а'], ['ꙑ', 'еры'], ['ѹ', 'ук'], ['ꙋ', 'ук (монограф)'],
  ['ꙁ', 'земля'], ['ꙃ', 'зело (вариант)'], ['ї', 'и с двумя точками'], ['ꙇ', 'иота'], ['ѿ', 'от'], ['ѻ', 'круглое о'],
  ['ꙿ', 'паерок'],
];

export const EXTRA_KEYS = [
  ['ꙙ', 'замкнутый малый юс'], ['ꙝ', 'йотированный замкнутый малый юс'], ['ꙉ', 'джерв'], ['ҍ', 'полумягкий знак'],
  ['ѷ', 'ижица с двойным грависом'], ['ꙍ', 'широкое о'], ['ѽ', 'омега с титлом'],
  ['҆', 'придыхание (над предыдущей буквой)'], ['́', 'ударение (над предыдущей буквой)'],
  ['̀', 'гравис (над предыдущей буквой)'], ['҄', 'смягчение (над предыдущей буквой)'],
];

export const KEYS = [...MAIN_KEYS, ...EXTRA_KEYS];

function makeKey(ch, name, textarea, onChange) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'key cu';
  b.textContent = COMBINING.has(ch) ? `◌${ch}` : ch;
  const code = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  b.title = `${name} (U+${code})`;
  b.setAttribute('aria-label', name);
  // не отбираем фокус у поля ввода
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.setRangeText(ch, start, end, 'end');
    textarea.focus();
    onChange();
  });
  return b;
}

export function mountKeyboard(container, textarea, onChange) {
  for (const [ch, name] of MAIN_KEYS) container.appendChild(makeKey(ch, name, textarea, onChange));

  const extra = document.createElement('div');
  extra.className = 'kbd-extra';
  extra.hidden = true;
  for (const [ch, name] of EXTRA_KEYS) extra.appendChild(makeKey(ch, name, textarea, onChange));

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'key key-more';
  more.textContent = 'ещё';
  more.title = 'Редкие буквы и знаки над буквой';
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('mousedown', (e) => e.preventDefault());
  more.addEventListener('click', () => {
    extra.hidden = !extra.hidden;
    more.setAttribute('aria-expanded', String(!extra.hidden));
    more.textContent = extra.hidden ? 'ещё' : 'скрыть';
  });
  container.appendChild(more);
  container.appendChild(extra);
}
