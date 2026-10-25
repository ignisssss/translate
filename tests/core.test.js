import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { looseKeys, strictKey, stripMarks, transliterate, latinToCyrillic } from '../src/core/normalizer.js';
import { Dictionary } from '../src/core/search.js';
import { KEYS, MAIN_KEYS } from '../src/ui/keyboard.js';
import { translateText, DIRECTIONS } from '../src/core/translator.js';

const raw = JSON.parse(readFileSync(new URL('../data/curated/dictionary.json', import.meta.url), 'utf8'));
const dict = new Dictionary(raw.entries);
const top = (res) => res.matches[0] && res.matches[0].entry.headword;

test('словарь: не меньше 100 статей, нет дублей', () => {
  assert.ok(raw.entries.length >= 100);
  const heads = raw.entries.map((e) => e.headword);
  assert.equal(new Set(heads).size, heads.length);
  for (const e of raw.entries) {
    assert.ok(e.headword && e.pos && Array.isArray(e.ru) && e.ru.length, `статья ${e.headword}`);
    for (const r of e.related || []) assert.ok(heads.includes(r), `${e.headword}: related ${r}`);
  }
});

test('нормализация: титла и знаки снимаются', () => {
  assert.equal(stripMarks('бг҃ъ'), 'бгъ');
  assert.equal(strictKey('Гд҇ь'), 'гдь');
  assert.equal(stripMarks('бцⷣа'), 'бцда');
});

test('нормализация: нечёткие ключи', () => {
  assert.deepEqual(looseKeys('богъ'), ['бог']);
  assert.ok(looseKeys('чловѣкъ').includes('чловек'));
  assert.ok(looseKeys('слъньце').includes('солнце'));
  assert.ok(looseKeys('срьдьце').includes('сердце'));
  assert.ok(looseKeys('ѿ').includes('от'));
  assert.ok(looseKeys('ѱалмъ').includes('псалм'));
  assert.ok(looseKeys('ѯ').includes('кс'));
  assert.equal(looseKeys('ѫ')[0], 'у');
  assert.equal(looseKeys('оуста')[0], 'уста');
});

test('транслитерация', () => {
  assert.equal(transliterate('рѫка'), 'rǫka');
  assert.equal(latinToCyrillic('rǫka'), 'рѫка');
});

test('поиск ОЦС: точное, форма, нечёткое', () => {
  assert.equal(top(dict.findCu('богъ')), 'богъ');
  assert.equal(dict.findCu('богъ').matches[0].kind, 'exact');
  assert.equal(dict.findCu('боже').matches[0].kind, 'form');
  assert.equal(top(dict.findCu('чловек')), 'чловѣкъ');
  assert.equal(dict.findCu('чловек').matches[0].kind, 'loose');
  assert.equal(top(dict.findCu('рука')), 'рѫка');
  assert.equal(top(dict.findCu('bogŭ')), 'богъ');
});

test('поиск ОЦС: слова под титлом', () => {
  const cases = {
    'бг҃ъ': 'богъ',
    'гд҇ь': 'господь',
    'іс҃ъ': 'иисꙋсъ',
    'чл҃вѣкъ': 'чловѣкъ',
    'дх҃ъ': 'дꙋхъ',
    'цр҃ь': 'цѣсарь',
    'ап҇лъ': 'апостолъ',
    'бцⷣа': 'богородица',
  };
  for (const [abbr, full] of Object.entries(cases)) {
    const r = dict.findCu(abbr);
    assert.equal(top(r), full, abbr);
    assert.equal(r.matches[0].kind, 'titlo', abbr);
  }
  // без знаков и с неизвестным окончанием
  assert.equal(top(dict.findCu('бгъ')), 'богъ');
  assert.equal(top(dict.findCu('бг҃ꙋ')), 'богъ');
  assert.equal(top(dict.findCu('полное чловѣкъ'.split(' ')[1])), 'чловѣкъ');
});

test('поиск ОЦС: основа и опечатка', () => {
  assert.equal(dict.findCu('богомь').matches[0].entry.headword, 'богъ');
  assert.equal(dict.findCu('словомь').matches[0].kind, 'stem');
  const fz = dict.findCu('чловѣкь');
  assert.equal(top(fz), 'чловѣкъ');
});

test('архаизмы из задания найдены', () => {
  for (const w of ['абие', 'вельми', 'выя', 'глаголати', 'десница', 'шуйца', 'зело', 'паки', 'токмо', 'человеколюбие', 'живот']) {
    assert.ok(dict.findCu(w).matches.length, w);
  }
  const zhivot = dict.findCu('живот').matches[0].entry;
  assert.ok(zhivot.ru.includes('жизнь'));
});

test('поиск русский → ОЦС', () => {
  assert.equal(top(dict.findRu('бог')), 'богъ');
  assert.equal(top(dict.findRu('Любовь')), 'любꙑ');
  assert.equal(top(dict.findRu('левая рука'.split(' ')[0])).length > 0, true);
  assert.equal(top(dict.findRu('очень')) === 'велми' || top(dict.findRu('очень')) === 'зѣло', true);
  const stem = dict.findRu('любит');
  assert.equal(top(stem), 'любити');
});

test('автодополнение', () => {
  assert.ok(dict.suggestCu('бог').some((s) => s.entry.headword === 'богъ'));
  assert.ok(dict.suggestRu('люб').some((s) => s.entry.headword === 'любити'));
});

test('предложение: пословный разбор', () => {
  const r = translateText(dict, 'Богъ любꙑ ѥстъ.', DIRECTIONS.CU_RU);
  assert.equal(r.mode, 'sentence');
  const words = r.tokens.filter((t) => t.word);
  assert.equal(words.length, 3);
  assert.deepEqual(words.map((w) => w.out), ['Бог', 'любовь', 'быть']);
  assert.ok(words.every((w) => w.found));
  assert.ok(r.plain.endsWith('.'));
  const ru = translateText(dict, 'бог любовь', DIRECTIONS.RU_CU);
  assert.equal(ru.plain, 'богъ любꙑ');
  const unk = translateText(dict, 'зzzzz богъ', DIRECTIONS.CU_RU);
  assert.equal(unk.tokens.filter((t) => t.word)[0].found, false);
  assert.equal(translateText(dict, 'богъ', DIRECTIONS.CU_RU).mode, 'word');
});

// ───── собранная база (public/data/, строится scripts/build_full_dictionary.py) ─────
// Тесты подстраиваются под состав сборки: полная, без части источников или только ручные статьи.
const dataUrl = (name) => new URL(`../public/data/${name}`, import.meta.url);
const hasIndex = existsSync(dataUrl('search_index.json')) && existsSync(dataUrl('sources.json'));
const built = hasIndex
  ? {
    index: JSON.parse(readFileSync(dataUrl('search_index.json'), 'utf8')),
    sources: new Set(JSON.parse(readFileSync(dataUrl('sources.json'), 'utf8')).sources.map((x) => x.id)),
  }
  : null;
// нижняя граница размера: ручные статьи всегда есть; большие источники поднимают планку
const minCount = !built ? 0
  : built.sources.has('dyachenko') || built.sources.has('ruwikt') ? 15000
    : built.sources.has('kaikki') ? 3000
      : raw.entries.length - 5;

test('собранная база: загрузка и поиск', { skip: !hasIndex }, () => {
  const { index } = built;
  const t0 = performance.now();
  const full = Dictionary.fromIndex(index);
  const ms = performance.now() - t0;
  assert.ok(index.count >= minCount, `статей: ${index.count}, ожидалось не меньше ${minCount}`);
  assert.equal(full.size, index.count);
  assert.ok(ms < 4000, `индекс строится ${ms.toFixed(0)} мс`);
  // ручные статьи остаются первыми и выигрывают при омонимии
  assert.equal(full.findCu('богъ').matches[0].entry.ru[0], 'бог');
  assert.equal(full.findCu('бг҃ъ').matches[0].kind, 'titlo');
  assert.ok(full.findCu('чловѣкъ').matches.length >= 1);
  assert.equal(full.findRu('бог').matches[0].entry.headword, 'богъ');
  // изменённые русские формы ищутся по основе, а не по случайному слову из чужого толкования
  assert.equal(full.findRu('бога').matches[0].entry.headword, 'богъ');
  assert.equal(full.findRu('любит').matches[0].entry.headword, 'любити');
  // старославянская статья выше древнерусской, даже если у неё совпадение только по форме
  assert.equal(full.findCu('вельми').matches[0].entry.lang, 'chu');
  // слова из Дьяченко проверяем только если источник вошёл в сборку
  if (built.sources.has('dyachenko')) {
    const cs = full.findCu('отроковица').matches[0];
    assert.ok(cs && cs.entry.ru.length);
  }
  // древнерусские статьи есть только вместе с источником pitt-orv или русским Викисловарём
  assert.equal(full.entries.some((e) => e.lang === 'orv'), built.sources.has('pitt-orv') || built.sources.has('ruwikt'));
  // номера омонимов из Викисловаря не попадают в значения
  assert.ok(full.entries.every((e) => e.ru.every((m) => !/\[\d+\]/.test(m))));
  // каждая статья ссылается на существующий чанк
  assert.ok(full.entries.every((e) => index.chunks.includes(e.chunk)));
  // скорость поиска
  const t1 = performance.now();
  for (let i = 0; i < 50; i++) { full.suggestCu('бл'); full.suggestRu('бла'); full.findCu('богомь'); }
  assert.ok(performance.now() - t1 < 1500, 'поиск медленный');
});

test('собранная база: чанки содержат полные статьи', { skip: !hasIndex }, async () => {
  const full = Dictionary.fromIndex(built.index);
  full.chunkLoader = async (name) => JSON.parse(readFileSync(dataUrl(`chunks/${name}`), 'utf8'));
  const e = full.findCu('богъ').matches[0].entry;
  const d = await full.loadDetail(e);
  assert.ok(d && d.ru.includes('бог') && d.sources.includes('manual'));
  // первая, средняя и последняя статьи индекса и слово с юсом
  const probes = [full.entries[0], full.entries[full.size >> 1], full.entries[full.size - 1], full.findCu('рѫка').matches[0].entry];
  for (const x of probes) assert.ok(await full.loadDetail(x), x.headword);
});

test('собранная база: таблицы форм из Викисловаря', { skip: !hasIndex }, () => {
  const cell = /^(?:(?:short|long)\.)?(?:(?:m|f|n)\.)?(?:(?:pres|aor|impf|imp|fut|cond)\.)?(?:(?:1|2|3)\.)?(?:(?:nom|gen|dat|acc|ins|loc|voc)\.)?(?:sg|du|pl)$|^(?:inf|sup)$/;
  let withParadigm = 0;
  const found = {};
  for (const name of readdirSync(dataUrl('chunks/'))) {
    const chunk = JSON.parse(readFileSync(dataUrl(`chunks/${name}`), 'utf8'));
    for (const [id, d] of Object.entries(chunk)) {
      if (!d.paradigm) continue;
      withParadigm++;
      for (const [k, forms] of Object.entries(d.paradigm)) {
        assert.ok(cell.test(k), `${id}: неизвестная ячейка ${k}`);
        assert.ok(Array.isArray(forms) && forms.length && forms.every((f) => typeof f === 'string' && f), `${id}: ${k}`);
      }
      found[id] = d.paradigm;
    }
  }
  if (built.sources.has('ruwikt')) {
    assert.ok(withParadigm >= 1000, `таблиц форм: ${withParadigm}`);
    assert.ok(found['вода']['gen.sg'].includes('водꙑ'));
    assert.ok(found['вода']['nom.sg'].includes('вода'));
  }
});

test('синодальная часть church-slavonic (Поляков) не используется', { skip: !hasIndex }, () => {
  const text = readFileSync(new URL('../scripts/build_full_dictionary.py', import.meta.url), 'utf8');
  assert.ok(!/syn\/(nouns|verbs|adjectives|pronouns|closed)/.test(text.replace(/#.*$/gm, '')), 'в сборке остались файлы syn/');
});

test('клавиатура: все кнопки обрабатываются поиском', () => {
  const marks = /[\u0300-\u036f\u0483-\u0489]/;
  for (const [ch, name] of KEYS) {
    assert.ok(name, `у ${ch} нет названия`);
    if (marks.test(ch)) {
      assert.equal(strictKey(`а${ch}`), 'а', `знак ${name} не снимается`); // знаки над буквой не мешают поиску
    } else {
      const k = looseKeys(`а${ch}а`)[0];
      assert.ok(/^[а-яё]*$/.test(k), `буква ${ch} (${name}) даёт ключ «${k}»`);
    }
  }
  assert.equal(new Set(KEYS.map((k) => k[0])).size, KEYS.length, 'повторяющиеся кнопки');
  for (const must of ['ѣ', 'ѧ', 'ѫ', 'ѩ', 'ѭ', 'ѡ', 'ѱ', 'ѯ', 'ѳ', 'ѵ', 'ѕ', 'і', 'ъ', 'ь', '\u0483', 'ꙁ', 'ꙋ', 'ѿ', 'ѻ', '\u0487']) {
    assert.ok(MAIN_KEYS.some((k) => k[0] === must), `нет кнопки ${must}`);
  }
});

test('нормализация: редкие буквы и знаки', () => {
  assert.equal(looseKeys('ꙁемлѧ')[0], 'земля');
  assert.equal(looseKeys('богꙋ')[0], 'бог' + 'у');
  assert.equal(looseKeys('ѿвѣтъ')[0], 'ответ');
  assert.equal(looseKeys('ꙇсꙋсъ')[0], 'исус');
  assert.equal(looseKeys('отꙿцемъ')[0], 'отцем'); // паерок
  assert.equal(looseKeys('ѝ')[0], 'и'); // готовая буква со знаком
  assert.equal(strictKey('гд\u0487ь'), 'гдь'); // покрытие
  assert.equal(strictKey('дꙋ\u0301хъ'), 'дꙋхъ'); // ударение
});

test('клавиатура покрывает буквы базы (частые символы)', { skip: !hasIndex }, () => {
  const on = new Set(KEYS.map((k) => k[0]));
  const counts = new Map();
  for (const r of built.index.entries) for (const c of (r[0] + r[4] + r[7]).normalize('NFC')) counts.set(c, (counts.get(c) || 0) + 1);
  const basic = /[а-яё_\s]/;
  const missing = [...counts].filter(([c, n]) => !basic.test(c) && n >= 20 && !on.has(c) && !/[\u0300-\u036f\u0483-\u0489]/.test(c));
  assert.deepEqual(missing, [], `буквы без кнопок: ${missing.map(([c, n]) => c + n).join(' ')}`);
});
