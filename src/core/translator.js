// Перевод слова и пословный разбор предложения.

export const DIRECTIONS = { CU_RU: 'cu-ru', RU_CU: 'ru-cu' };

/** Делит текст на слова и разделители (знаки препинания, пробелы). */
export function tokenize(text) {
  const parts = [];
  const re = /[\p{L}\p{M}]+/gu;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), word: false });
    parts.push({ text: m[0], word: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), word: false });
  return parts;
}

/** Основной перевод статьи в заданном направлении. */
export function primaryTranslation(entry, dir) {
  if (dir === DIRECTIONS.CU_RU) {
    if (entry.ru.length) return { text: entry.ru[0], translated: true };
    if (entry.en && entry.en.length) return { text: entry.en[0], translated: false };
    return { text: entry.headword, translated: false };
  }
  return { text: entry.headword, translated: true };
}

function matchCase(source, out) {
  if (!source || !out) return out;
  const first = source[0];
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return out[0].toUpperCase() + out.slice(1);
  }
  return out;
}

/** Ищет слово в нужную сторону. */
export function lookup(dict, word, dir, opts) {
  return dir === DIRECTIONS.CU_RU ? dict.findCu(word, opts) : dict.findRu(word, opts);
}

/**
 * Переводит текст. Одно слово -> режим «word»; несколько -> режим «sentence».
 * Для каждого слова возвращаются совпадения, по клику открывается карточка.
 */
export function translateText(dict, text, dir) {
  const parts = tokenize(text);
  const wordCount = parts.filter((p) => p.word).length;
  const mode = wordCount <= 1 ? 'word' : 'sentence';
  let index = 0;
  const tokens = parts.map((p) => {
    if (!p.word) return { ...p };
    const result = lookup(dict, p.text, dir);
    const top = result.matches[0] || null;
    let out = p.text;
    let translated = false;
    if (top) {
      const t = primaryTranslation(top.entry, dir);
      out = matchCase(p.text, t.text);
      translated = t.translated;
    }
    return {
      ...p,
      index: index++,
      result,
      kind: top ? top.kind : null,
      out,
      found: Boolean(top),
      translated,
    };
  });
  const plain = tokens.map((t) => (t.word ? t.out : t.text)).join('');
  return { mode, dir, tokens, plain };
}
