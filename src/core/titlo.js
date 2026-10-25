// Справочник слов под титлом.
//
// Запись: [скелет, основа полного слова]. Скелет сравнивается с написанием
// без знаков (бг҃ъ → «бгъ»); остаток после скелета считается окончанием.
// Раскрытие = основа + окончание (бг + ꙋ → бог + ꙋ). Результат принимается
// только если такое слово есть в словаре (проверяет search.js).
import { stripMarks } from './normalizer.js';

export const TITLO_STEMS = [
  ['бг', 'бог'],
  ['гд', 'господ'],
  ['іс', 'иисꙋс'],
  ['ис', 'иисꙋс'],
  ['хс', 'христос'],
  ['члвѣк', 'чловѣк'],
  ['члвк', 'чловѣк'],
  ['члк', 'чловѣк'],
  ['дх', 'дꙋх'],
  ['цр', 'цѣсар'],
  ['апл', 'апостол'],
  ['ст', 'свѧт'],
  ['ѿц', 'отьц'],
  ['оц', 'отьц'],
  ['сн', 'сꙑн'],
  ['мт', 'матер'],
  ['нб', 'неб'],
  ['нбс', 'небес'],
  ['дш', 'дꙋш'],
  ['срд', 'срьдь'],
  ['слв', 'слов'],
  ['прр', 'пророк'],
  ['бц', 'богородиц'],
  ['бцд', 'богородиц'],
];

// Графические варианты, не влияющие на скелет.
function graphic(s) {
  return s
    .replace(/оу/g, 'ꙋ')
    .replace(/[ѹ]/g, 'ꙋ')
    .replace(/[ї]/g, 'і')
    .replace(/ѡ/g, 'о');
}

function skeletonKey(s) {
  return graphic(stripMarks(s.toLowerCase()))
    .replace(/і/g, 'и')
    .replace(/ѿ/g, 'от')
    .replace(/ꙋ/g, 'у');
}

const PREPARED = TITLO_STEMS.map(([abbr, stem]) => ({ abbr, key: skeletonKey(abbr), stem })).sort(
  (a, b) => b.key.length - a.key.length,
);

/**
 * Возвращает варианты полного написания для возможного сокращения.
 * Каждый вариант: { abbr, stem, expanded }.
 */
export function expandTitlo(token) {
  const key = skeletonKey(token);
  const out = [];
  for (const p of PREPARED) {
    if (!key.startsWith(p.key)) continue;
    const rest = key.slice(p.key.length);
    if (rest.length > 4) continue;
    out.push({ abbr: p.abbr, stem: p.stem, expanded: p.stem + rest });
  }
  return out;
}
