// Строка-клавиатура со спецсимволами старославянской кириллицы.

const KEYS = [
  ['ѣ', 'ять'], ['ѧ', 'малый юс'], ['ѫ', 'большой юс'], ['ѩ', 'йотированный малый юс'], ['ѭ', 'йотированный большой юс'],
  ['ѡ', 'омега'], ['ѱ', 'пси'], ['ѯ', 'кси'], ['ѳ', 'фита'], ['ѵ', 'ижица'], ['ѕ', 'зело'], ['і', 'и десятеричное'],
  ['ъ', 'ер'], ['ь', 'ерь'], ['҃', 'титло (ставится над предыдущей буквой)'],
  ['ѥ', 'йотированное е'], ['ꙗ', 'йотированное а'], ['ꙑ', 'еры'], ['ѹ', 'ук'],
];

export function mountKeyboard(container, textarea, onChange) {
  for (const [ch, name] of KEYS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key cu';
    b.textContent = ch === '҃' ? '◌҃' : ch;
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
    container.appendChild(b);
  }
}
