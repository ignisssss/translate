// Индекс словаря и поиск в обе стороны (старославянский <-> русский).
import {
  editDistance, hasTitloMark, isLatin, latinToCyrillic, looseKeys, ruKey, strictKey,
} from './normalizer.js';
import { expandTitlo } from './titlo.js';

/**
 * Виды совпадений (kind), от точного к приблизительному:
 *   exact  — заглавное слово;  form — известная форма слова;
 *   titlo  — слово под титлом (сокращённое написание);
 *   loose  — совпадение после нормализации (ѣ=е, ѫ=у, без еров…);
 *   stem   — слово с неизвестным окончанием (по основе);
 *   fuzzy  — похожее написание (одна опечатка).
 */
export const KIND_ORDER = ['exact', 'form', 'titlo', 'loose', 'stem', 'fuzzy'];
const LANG_RANK = { chu: 0, cs: 1, orv: 2 };

const RU_ENDINGS = [
  'ешь', 'ишь', 'ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ых', 'их', 'ой', 'ей', 'ом', 'ем', 'ую', 'юю', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий',
  'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'ть', 'ет', 'ут', 'ют', 'ит', 'ат', 'ят', 'ла', 'ли', 'ло',
  'а', 'я', 'у', 'ю', 'е', 'и', 'ы', 'о', 'ь', 'й',
];
const VERB_ENDING = /(ет|ит|ут|ют|ат|ят|ешь|ишь|ла|ли|ло)$/;
const VOWEL_END = /[аеиоуыюяѣѧѫ]$/;

function normalizeEntry(e, order) {
  return {
    ...e,
    id: e.id || e.headword,
    lang: e.lang || 'chu',
    ru: e.ru || [],
    en: e.en || [],
    forms: e.forms || [],
    titlo: e.titlo || [],
    related: e.related || [],
    examples: e.examples || (e.example ? [e.example] : []),
    detail: e.detail || null,
    order,
  };
}

function push(map, key, entry) {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [entry]);
  else if (!list.includes(entry)) list.push(entry);
}

const splitList = (s, sep) => (s ? s.split(sep).filter(Boolean) : []);

export class Dictionary {
  /** Собирает словарь из компактного индекса (public/data/search_index.json). */
  static fromIndex(index) {
    const entries = index.entries.map((r) => {
      const lang = index.langs[r[5]];
      return {
        id: r[0] + (lang === 'orv' ? '#orv' : ''),
        headword: r[0],
        pos: r[1],
        ru: splitList(r[2], '; '),
        en: splitList(r[3], '; '),
        forms: splitList(r[4], ' ').map((f) => f.replace(/_/g, ' ')),
        lang,
        chunk: index.chunks[r[6]],
        titlo: splitList(r[7], ' ').map((f) => f.replace(/_/g, ' ')),
      };
    });
    return new Dictionary(entries);
  }

  constructor(rawEntries) {
    this.entries = rawEntries.map(normalizeEntry);
    this.byId = new Map(this.entries.map((e) => [e.id, e]));
    this.byHeadword = new Map();
    this.byHead = new Map();
    this.byForm = new Map();
    this.byTitlo = new Map();
    this.byLoose = new Map();
    this.ruIndex = new Map(); // слово -> [{entry, rank}]
    this.looseList = []; // [ключ, статья] — все написания, для приблизительного поиска
    this.headList = []; // [ключ, статья] — только заглавные слова, для поиска по основе
    this._lenBuckets = null;
    this._chunks = new Map();
    this.chunkLoader = null;

    for (const e of this.entries) {
      const hk = strictKey(e.headword);
      if (!this.byHeadword.has(hk)) this.byHeadword.set(hk, e);
      push(this.byHead, hk, e);
      for (const f of e.forms) push(this.byForm, strictKey(f), e);
      for (const t of e.titlo) push(this.byTitlo, strictKey(t), e);
      const seen = new Set();
      const addLoose = (v, isHead) => {
        for (const k of looseKeys(v)) {
          push(this.byLoose, k, e);
          if (isHead) this.headList.push([k, e]);
          if (!seen.has(k)) { seen.add(k); this.looseList.push([k, e]); }
        }
      };
      addLoose(e.headword, true);
      for (const v of e.forms) addLoose(v, false);
      for (const v of e.titlo) addLoose(v, false);
      e.ru.forEach((meaning, mi) => {
        const words = ruKey(meaning).split(/[^а-я0-9]+/).filter(Boolean);
        words.forEach((w) => {
          if (w.length < 2) return;
          const rank = (words.length === 1 ? 0 : 3) + mi;
          const list = this.ruIndex.get(w) || [];
          const ex = list.find((x) => x.entry === e);
          if (!ex) list.push({ entry: e, rank });
          else if (rank < ex.rank) ex.rank = rank;
          this.ruIndex.set(w, list);
        });
      });
    }
    this.ruTokens = [...this.ruIndex.keys()];
  }

  get size() {
    return this.entries.length;
  }

  getById(id) {
    return this.byId.get(id) || null;
  }

  getByHeadword(h) {
    return this.byHeadword.get(strictKey(h)) || null;
  }

  // ───── полные статьи (чанки) ─────

  /** Подгружает полную статью из чанка по первой букве; возвращает Promise<detail | null>. */
  loadDetail(entry) {
    if (entry.detail) return Promise.resolve(entry.detail);
    if (!entry.chunk || !this.chunkLoader) return Promise.resolve(null);
    let p = this._chunks.get(entry.chunk);
    if (!p) {
      p = this.chunkLoader(entry.chunk).catch(() => null);
      this._chunks.set(entry.chunk, p);
    }
    return p.then((data) => {
      const d = data && data[entry.id];
      if (d) entry.detail = d;
      return d || null;
    });
  }

  // ───── старославянский → русский ─────

  /** Разрешает написание в статьи без приблизительных стадий. */
  _resolveExact(q) {
    const found = [];
    const add = (entry, kind) => { if (!found.some((m) => m.entry === entry)) found.push({ entry, kind }); };
    const sk = strictKey(q);
    (this.byHead.get(sk) || []).forEach((e) => add(e, 'exact'));
    (this.byForm.get(sk) || []).forEach((e) => add(e, 'form'));
    if (!found.length) {
      for (const k of looseKeys(q)) (this.byLoose.get(k) || []).forEach((e) => add(e, 'loose'));
    }
    // сначала старославянские статьи, затем церковнославянские и древнерусские; внутри языка — по точности
    found.sort((a, b) => LANG_RANK[a.entry.lang] - LANG_RANK[b.entry.lang]
      || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    return found;
  }

  _buckets() {
    if (!this._lenBuckets) {
      this._lenBuckets = new Map();
      for (const item of this.looseList) {
        const n = item[0].length;
        if (!this._lenBuckets.has(n)) this._lenBuckets.set(n, []);
        this._lenBuckets.get(n).push(item);
      }
    }
    return this._lenBuckets;
  }

  findCu(raw, { approx = true } = {}) {
    const trimmed = (raw || '').trim();
    const result = { query: trimmed, normalized: trimmed, matches: [] };
    if (!trimmed) return result;
    const q = isLatin(trimmed) ? latinToCyrillic(trimmed) : trimmed;
    result.normalized = q;
    const matches = result.matches;
    const add = (entry, kind, extra) => {
      if (!matches.some((m) => m.entry === entry)) matches.push({ entry, kind, ...extra });
    };

    if (hasTitloMark(q)) {
      (this.byTitlo.get(strictKey(q)) || []).forEach((e) => add(e, 'titlo', { abbr: trimmed, full: e.headword }));
    }
    this._resolveExact(q).forEach((m) => add(m.entry, m.kind));

    if (!matches.length) {
      (this.byTitlo.get(strictKey(q)) || []).forEach((e) => add(e, 'titlo', { abbr: trimmed, full: e.headword }));
      for (const cand of expandTitlo(q)) {
        this._resolveExact(cand.expanded).forEach((m) => add(m.entry, 'titlo', { abbr: trimmed, full: m.entry.headword }));
      }
    }

    if (!matches.length && approx) {
      const keys = looseKeys(q);
      // слово с неизвестным окончанием: основа = заглавное слово без последней гласной
      const stems = [];
      for (const [k, entry] of this.headList) {
        for (const stem of VOWEL_END.test(k) ? [k, k.slice(0, -1)] : [k]) {
          if (stem.length < 3) continue;
          for (const tk of keys) {
            if (tk.length - stem.length <= 3 && tk.startsWith(stem)) stems.push({ entry, len: stem.length });
          }
        }
      }
      stems.sort((a, b) => b.len - a.len || a.entry.order - b.entry.order);
      stems.slice(0, 8).forEach((s) => add(s.entry, 'stem'));

      if (!matches.length) {
        const fuzzy = [];
        const buckets = this._buckets();
        for (const tk of keys) {
          if (tk.length < 5) continue;
          for (const n of [tk.length - 1, tk.length, tk.length + 1]) {
            for (const [k, entry] of buckets.get(n) || []) {
              const d = editDistance(tk, k, 1);
              if (d <= 1) fuzzy.push({ entry, d });
            }
          }
        }
        fuzzy.sort((a, b) => a.d - b.d || a.entry.order - b.entry.order);
        fuzzy.slice(0, 8).forEach((f) => add(f.entry, 'fuzzy'));
      }
    }
    return result;
  }

  suggestCu(raw, limit = 8) {
    const q = isLatin((raw || '').trim()) ? latinToCyrillic(raw.trim()) : (raw || '').trim();
    const keys = looseKeys(q);
    if (!keys.length) return [];
    const heads = [];
    const seen = new Set();
    for (const [k, e] of this.headList) {
      if (seen.has(e)) continue;
      if (keys.some((q2) => k.startsWith(q2))) {
        seen.add(e);
        heads.push({ entry: e, via: null, len: k.length });
        if (heads.length >= 400) break;
      }
    }
    // сначала короткие слова (ближе к введённому), при равенстве — по приоритету статьи
    heads.sort((a, b) => a.len - b.len || a.entry.order - b.entry.order);
    const out = heads.slice(0, limit);
    if (out.length < limit) {
      for (const [k, e] of this.looseList) {
        if (seen.has(e)) continue;
        if (keys.some((q2) => k.startsWith(q2))) {
          seen.add(e);
          out.push({ entry: e, via: k });
          if (out.length >= limit) break;
        }
      }
    }
    return out;
  }

  // ───── русский → старославянский ─────

  findRu(raw, { approx = true } = {}) {
    const trimmed = (raw || '').trim();
    const result = { query: trimmed, normalized: trimmed, matches: [] };
    if (!trimmed) return result;
    const key = ruKey(trimmed).replace(/[^а-я0-9]/g, '');
    if (!key) return result;
    const matches = result.matches;
    const add = (entry, kind, rank) => {
      if (!matches.some((m) => m.entry === entry)) matches.push({ entry, kind, rank });
    };

    // rank < 3: слово — целое значение статьи; rank >= 3: слово только упомянуто в длинном толковании
    const exact = (this.ruIndex.get(key) || []).slice().sort((x, y) => x.rank - y.rank || x.entry.order - y.entry.order);
    exact.filter((x) => x.rank < 3).slice(0, 8).forEach((x) => add(x.entry, 'exact', x.rank));

    if (!matches.length && approx) {
      const ending = RU_ENDINGS.find((en) => key.length - en.length >= 3 && key.endsWith(en));
      const stem = ending ? key.slice(0, -ending.length) : key;
      const weakStem = [];
      if (stem.length >= 3) {
        const verbal = VERB_ENDING.test(key);
        const cands = [];
        for (const t of this.ruTokens) {
          if (!t.startsWith(stem) || t.length - stem.length > 4) continue;
          for (const x of this.ruIndex.get(t)) {
            const bonus = verbal === /(ть|ти)$/.test(t) ? 0 : 3;
            cands.push({ entry: x.entry, rank: x.rank, score: (t.length - stem.length) + bonus + x.rank / 10 });
          }
        }
        cands.sort((x, y) => x.score - y.score || x.entry.order - y.entry.order);
        cands.filter((c) => c.rank < 3).slice(0, 8).forEach((c) => add(c.entry, 'stem', c.score));
        cands.filter((c) => c.rank >= 3).slice(0, 8).forEach((c) => weakStem.push(c));
      }
      if (!matches.length) exact.slice(0, 8).forEach((x) => add(x.entry, 'exact', x.rank));
      if (!matches.length) weakStem.forEach((c) => add(c.entry, 'stem', c.score));
      if (!matches.length && key.length >= 5) {
        const fuzzy = [];
        for (const t of this.ruTokens) {
          if (Math.abs(t.length - key.length) <= 1 && editDistance(key, t, 1) <= 1) {
            for (const x of this.ruIndex.get(t)) fuzzy.push(x.entry);
          }
        }
        fuzzy.slice(0, 8).forEach((e) => add(e, 'fuzzy', 9));
      }
    }
    return result;
  }

  suggestRu(raw, limit = 8) {
    const key = ruKey((raw || '').trim()).replace(/[^а-я0-9]/g, '');
    if (key.length < 1) return [];
    const out = [];
    const seen = new Set();
    for (const t of this.ruTokens) {
      if (!t.startsWith(key)) continue;
      for (const x of this.ruIndex.get(t)) {
        if (x.rank > 2 && key.length < 3) continue;
        if (seen.has(x.entry)) continue;
        seen.add(x.entry);
        out.push({ entry: x.entry, via: t, rank: x.rank, len: t.length });
      }
    }
    out.sort((a, b) => a.rank - b.rank || a.len - b.len || a.entry.order - b.entry.order);
    return out.slice(0, limit);
  }
}
