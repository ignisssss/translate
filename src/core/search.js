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
    ru: e.ru || [],
    en: e.en || [],
    forms: e.forms || [],
    titlo: e.titlo || [],
    related: e.related || [],
    examples: e.examples || (e.example ? [e.example] : []),
    order,
  };
}

function push(map, key, entry) {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [entry]);
  else if (!list.includes(entry)) list.push(entry);
}

export class Dictionary {
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

    for (const e of this.entries) {
      this.byHeadword.set(strictKey(e.headword), e);
      push(this.byHead, strictKey(e.headword), e);
      for (const f of e.forms) push(this.byForm, strictKey(f), e);
      for (const t of e.titlo) push(this.byTitlo, strictKey(t), e);
      for (const k of looseKeys(e.headword)) this.headList.push([k, e]);
      const variants = [e.headword, ...e.forms, ...e.titlo];
      const seen = new Set();
      for (const v of variants) {
        for (const k of looseKeys(v)) {
          push(this.byLoose, k, e);
          if (!seen.has(k)) { seen.add(k); this.looseList.push([k, e]); }
        }
      }
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
    return found;
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
            if (tk.startsWith(stem) && tk.length - stem.length <= 3) stems.push({ entry, len: stem.length });
          }
        }
      }
      stems.sort((a, b) => b.len - a.len || a.entry.order - b.entry.order);
      stems.forEach((s) => add(s.entry, 'stem'));

      if (!matches.length) {
        const fuzzy = [];
        for (const tk of keys) {
          if (tk.length < 4) continue;
          for (const [k, entry] of this.looseList) {
            const d = editDistance(tk, k, 1);
            if (d <= 1) fuzzy.push({ entry, d });
          }
        }
        fuzzy.sort((a, b) => a.d - b.d || a.entry.order - b.entry.order);
        fuzzy.forEach((f) => add(f.entry, 'fuzzy'));
      }
    }
    return result;
  }

  suggestCu(raw, limit = 8) {
    const q = isLatin((raw || '').trim()) ? latinToCyrillic(raw.trim()) : (raw || '').trim();
    const keys = looseKeys(q);
    if (!keys.length) return [];
    const out = [];
    const seen = new Set();
    const consider = (entry, via) => {
      if (seen.has(entry)) return;
      seen.add(entry);
      out.push({ entry, via });
    };
    for (const e of this.entries) {
      const hk = looseKeys(e.headword);
      if (keys.some((k) => hk.some((h) => h.startsWith(k)))) consider(e, null);
    }
    if (out.length < limit) {
      for (const [k, e] of this.looseList) {
        if (keys.some((q2) => k.startsWith(q2))) consider(e, k);
        if (out.length >= limit * 2) break;
      }
    }
    return out.slice(0, limit);
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

    (this.ruIndex.get(key) || []).slice().sort((a, b) => a.rank - b.rank || a.entry.order - b.entry.order)
      .forEach((x) => add(x.entry, 'exact', x.rank));

    // совпадение с заглавным словом старославянского (дом -> домъ)
    if (!matches.length && approx) {
      const ending = RU_ENDINGS.find((en) => key.length - en.length >= 3 && key.endsWith(en));
      const stem = ending ? key.slice(0, -ending.length) : key;
      if (stem.length >= 3) {
        const verbal = VERB_ENDING.test(key);
        const cands = [];
        for (const t of this.ruTokens) {
          if (!t.startsWith(stem) || t.length - stem.length > 4) continue;
          for (const x of this.ruIndex.get(t)) {
            const bonus = verbal === /(ть|ти)$/.test(t) ? 0 : 1;
            cands.push({ entry: x.entry, score: (t.length - stem.length) + bonus + x.rank / 10 });
          }
        }
        cands.sort((a, b) => a.score - b.score || a.entry.order - b.entry.order);
        cands.forEach((c) => add(c.entry, 'stem', c.score));
      }
      if (!matches.length && key.length >= 5) {
        const fuzzy = [];
        for (const t of this.ruTokens) {
          if (editDistance(key, t, 1) <= 1) for (const x of this.ruIndex.get(t)) fuzzy.push(x.entry);
        }
        fuzzy.forEach((e) => add(e, 'fuzzy', 9));
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
        out.push({ entry: x.entry, via: t, rank: x.rank });
      }
    }
    out.sort((a, b) => a.rank - b.rank || a.entry.order - b.entry.order);
    return out.slice(0, limit);
  }
}
