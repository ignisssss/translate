// Нормализация старославянской орфографии для нестрогого поиска.

// Надстрочные буквы U+2DE0–U+2DF3 несут значение (бцⷣа = богородица), поэтому
// сначала превращаем их в обычные буквы и только потом снимаем остальные знаки.
const SUPERSCRIPT = 'бвгджзклмнопрстхцчшщ';
const SUPER_RE = /[ⷠ-ⷳ]/g;
// Титла, покрытие, паерок, ударения, прочие комбинируемые знаки и остальные надстрочные буквы.
const MARKS_RE = /[̀-ͯ҃-҉ⷴ-ⷿ꙯-꙽ꚞꚟ]/g;
const TITLO_MARK_RE = /[҃-҇ⷠ-ⷿ]/;

export function hasTitloMark(s) {
  return TITLO_MARK_RE.test(s);
}

const ANY_MARK_RE = /[̀-ͯ҃-҉ⷠ-ⷿ꙯-꙽ꚞꚟ]/;

/** Снимает титла и диакритику, сохраняя значащие надстрочные буквы. */
export function stripMarks(s) {
  s = s.normalize('NFC');
  if (!ANY_MARK_RE.test(s)) return s; // быстрый путь: в большинстве слов знаков нет
  return s
    .replace(SUPER_RE, (c) => SUPERSCRIPT[c.charCodeAt(0) - 0x2de0])
    .replace(MARKS_RE, '');
}

/** Нижний регистр + без знаков; буквы не меняются (ѣ остаётся ѣ). */
export function strictKey(s) {
  return stripMarks(s.toLowerCase()).replace(/ё/g, 'е');
}

// Графические и фонетические соответствия старославянской и современной кириллицы.
const LOOSE_MAP = {
  'ѣ': 'е', 'ѧ': 'я', 'ѩ': 'я', 'ѫ': 'у', 'ѭ': 'ю', 'ѥ': 'е', 'ꙗ': 'я',
  'ѹ': 'у', 'ꙋ': 'у', 'ѡ': 'о', 'ѻ': 'о', 'ѿ': 'от',
  'і': 'и', 'ї': 'и', 'ѵ': 'и', 'й': 'и',
  'ѳ': 'ф', 'ѕ': 'з', 'ꙁ': 'з', 'ѱ': 'пс', 'ѯ': 'кс', 'ꙑ': 'ы', 'ҁ': 'к',
  'щ': 'шт',
};
const VOWELS = 'аеиоуыюяѣѧѫѩѭѥꙗёэ';

const LOOSE_RE = new RegExp(`[${Object.keys(LOOSE_MAP).join('')}]`, 'g');
function mapChars(s) {
  return s.replace(LOOSE_RE, (c) => LOOSE_MAP[c]);
}

/**
 * Ключи нечёткого поиска. Первый — с отбрасыванием еров (богъ → бог),
 * второй — «полногласный»: слоговые ръ/рь → ер, лъ → ол (слъньце → солнце,
 * срьдьце → сердце). Совпадение по любому из ключей считается нечётким совпадением.
 */
export function looseKeys(s) {
  const base = mapChars(strictKey(s).replace(/оу/g, 'у'));
  const plain = base.replace(/[ъь]/g, '');
  const keys = new Set([plain]);
  if (plain.length !== base.length && /[ъь]/.test(base) && /р[ъь]|лъ/.test(base)) {
    let full = '';
    for (let i = 0; i < base.length; i++) {
      const c = base[i];
      const next = base[i + 1];
      const prev = base[i - 1];
      const afterConsonant = prev && !VOWELS.includes(prev) && prev !== 'ъ' && prev !== 'ь';
      if ((c === 'р') && (next === 'ъ' || next === 'ь') && afterConsonant) { full += 'ер'; i++; continue; }
      if (c === 'л' && next === 'ъ' && afterConsonant) { full += 'ол'; i++; continue; }
      full += c;
    }
    keys.add(full.replace(/[ъь]/g, ''));
  }
  return [...keys].filter(Boolean);
}

/** Основной (первый) нечёткий ключ. */
export function looseKey(s) {
  return looseKeys(s)[0] || '';
}

/** Ключ для русского слова: нижний регистр, ё → е, без знаков. */
export function ruKey(s) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(MARKS_RE, '').normalize('NFC');
}

// Научная латинская транслитерация → кириллица (для запросов вида bogŭ, ręka).
const LAT = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', 'ž': 'ж', z: 'з', i: 'и', k: 'к', l: 'л', m: 'м', n: 'н',
  o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', x: 'х', h: 'х', c: 'ц', 'č': 'ч', 'š': 'ш', y: 'ꙑ',
  'ě': 'ѣ', 'ǫ': 'ѫ', 'ę': 'ѧ', 'ŭ': 'ъ', 'ĭ': 'ь',
};
export function isLatin(s) {
  return /[a-zěǫęšžčŭĭ]/i.test(s) && !/[Ѐ-ԯꙀ-ꚟ]/.test(s);
}
export function latinToCyrillic(s) {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/št/g, 'щ').replace(/dz/g, 'ѕ').replace(/jǫ/g, 'ѭ').replace(/ję/g, 'ѩ')
    .replace(/ju/g, 'ю').replace(/ja/g, 'я').replace(/je/g, 'ѥ')
    .replace(/./gsu, (c) => LAT[c] || c);
}

// Кириллица → научная латинская транслитерация (для показа в карточке).
const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'ž', ѕ: 'dz', з: 'z', и: 'i', і: 'i', ѵ: 'i', ѳ: 'f',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ѡ: 'o', ѻ: 'o', п: 'p', р: 'r', с: 's', т: 't', ѹ: 'u', ꙋ: 'u', у: 'u',
  ф: 'f', х: 'x', ц: 'c', ч: 'č', ш: 'š', щ: 'št', ъ: 'ŭ', ь: 'ĭ', ꙑ: 'y', ы: 'y', ѣ: 'ě', ю: 'ju', ѧ: 'ę',
  ѫ: 'ǫ', ѩ: 'ję', ѭ: 'jǫ', ѥ: 'je', ꙗ: 'ja', я: 'ja', ѿ: 'ot', ѯ: 'ks', ѱ: 'ps', ꙁ: 'z', ҁ: 'k', й: 'j',
};
export function transliterate(s) {
  return strictKey(s)
    .replace(/оу/g, 'u')
    .replace(/./gsu, (c) => (TR[c] !== undefined ? TR[c] : c));
}

/** Расстояние Левенштейна с ранним выходом, если оно больше max. */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
