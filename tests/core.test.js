import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { looseKeys, strictKey, stripMarks, transliterate, latinToCyrillic } from '../src/core/normalizer.js';
import { Dictionary } from '../src/core/search.js';
import { translateText, DIRECTIONS } from '../src/core/translator.js';

const raw = JSON.parse(readFileSync(new URL('../public/data/dictionary.json', import.meta.url), 'utf8'));
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
