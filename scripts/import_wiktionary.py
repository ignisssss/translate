#!/usr/bin/env python3
"""Конвертер открытых дампов старославянского словаря в формат public/data/dictionary.json.

Поддерживаются два входных формата:

  kaikki  JSONL-дамп Wiktionary от проекта Kaikki (https://kaikki.org): одна статья на строку,
          нужны записи с "lang_code": "cu" (старославянский / церковнославянский).
          Дамп английского Викисловаря даёт английские толкования (поле "en"),
          дамп русского Викисловаря — русские (поле "ru").
  tsv     Таблица с заголовком. Колонки: headword, pos, ru, forms, greek, etymology, note
          (ru и forms — списки через «;»). Обязательны headword и ru.

Примеры:

  python scripts/import_wiktionary.py kaikki-cu.jsonl --existing public/data/dictionary.json \\
      --out public/data/dictionary.json --merge
  python scripts/import_wiktionary.py words.tsv --format tsv --merge --out public/data/dictionary.json

В режиме --merge вручную написанные статьи не меняются: добавляются только новые слова
(из заглавных слов и их форм). Отчёт печатается в stderr.

Лицензия данных: текст Викисловаря распространяется на условиях CC BY-SA 4.0. При публикации
расширенной базы сохраните указание источника (поле "source" и раздел в README).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

POS_RU = {
    "noun": "сущ.", "verb": "гл.", "adj": "прил.", "adv": "нареч.", "prep": "предл.",
    "postp": "послелог", "conj": "союз", "pron": "мест.", "num": "числ.", "particle": "част.",
    "intj": "межд.", "name": "собств.", "det": "мест.-прил.", "article": "артикль",
    "phrase": "фраза", "prefix": "приставка", "suffix": "суффикс", "proverb": "поговорка",
}
# Теги форм, которые не нужны как самостоятельные написания.
SKIP_FORM_TAGS = {"table-tags", "inflection-template", "class", "romanization", "canonical"}
# Знаки, которые снимаем с заглавных слов (ударения и пр.), кроме значащих букв.
MARKS_RE = re.compile(r"[̀-ͯ҃-҉ⷠ-ⷿ꙯-꙽ꚞꚟ]")
SPLIT_RE = re.compile(r"\s*;\s*")


def clean(word: str) -> str:
    return MARKS_RE.sub("", unicodedata.normalize("NFC", word)).strip()


def key(word: str) -> str:
    return clean(word).lower().replace("ё", "е")


def clean_gloss(gloss: str) -> str:
    gloss = re.sub(r"\s+", " ", gloss).strip().rstrip(".")
    return gloss


def gloss_lang(text: str) -> str:
    return "ru" if re.search(r"[а-яА-ЯёЁ]", text) else "en"


def read_jsonl(path: Path, lang_code: str):
    opener = sys.stdin if str(path) == "-" else path.open(encoding="utf-8")
    with opener as fh:
        for n, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"строка {n}: пропущена ({exc})", file=sys.stderr)
                continue
            if obj.get("lang_code") == lang_code or (not obj.get("lang_code") and obj.get("lang") in ("Old Church Slavonic", "Старославянский")):
                yield obj


def convert_kaikki(objs):
    """Возвращает (леммы, формы-ссылки): леммы — список статей, формы — {лемма_key: [формы]}."""
    lemmas: dict[tuple[str, str], dict] = {}
    form_of: dict[str, set[str]] = {}
    for obj in objs:
        head = clean(obj.get("word", ""))
        if not head or " " in head and obj.get("pos") not in ("phrase", "proverb"):
            continue
        pos = POS_RU.get(obj.get("pos", ""), obj.get("pos", ""))
        ru: list[str] = []
        en: list[str] = []
        examples: list[dict] = []
        parent: str | None = None
        for sense in obj.get("senses", []):
            if sense.get("form_of") or sense.get("alt_of"):
                ref = (sense.get("form_of") or sense.get("alt_of"))[0].get("word")
                if ref:
                    parent = clean(ref)
                continue
            for g in sense.get("glosses", [])[:1]:
                g = clean_gloss(g)
                if not g:
                    continue
                (ru if gloss_lang(g) == "ru" else en).append(g)
            for ex in sense.get("examples", [])[:1]:
                text = ex.get("text")
                tr = ex.get("translation") or ex.get("english") or ex.get("ru") or ""
                if text and tr:
                    examples.append({"cu": text, "ru": tr} if gloss_lang(tr) == "ru" else {"cu": text, "ru": "", "en": tr})
        if parent:
            form_of.setdefault(key(parent), set()).add(head)
            continue
        if not (ru or en):
            continue
        forms = []
        for f in obj.get("forms", []):
            tags = set(f.get("tags", []))
            form = clean(f.get("form", ""))
            if not form or tags & SKIP_FORM_TAGS or form == head or " " in form or form in ("-", "—"):
                continue
            if form not in forms:
                forms.append(form)
        etym = (obj.get("etymology_text") or "").strip()
        entry = {"headword": head, "pos": pos or "—", "ru": ru, "source": "wiktionary"}
        if en and not ru:
            entry["en"] = en
        if forms:
            entry["forms"] = forms
        if etym:
            entry["etymology"] = re.sub(r"\s+", " ", etym)
        if examples:
            entry["examples"] = examples
        k = (key(head), pos)
        if k in lemmas:  # одно слово встретилось дважды: объединяем значения
            old = lemmas[k]
            old["ru"] = list(dict.fromkeys(old["ru"] + ru))
            if "en" in entry:
                old["en"] = list(dict.fromkeys(old.get("en", []) + entry["en"]))
        else:
            lemmas[k] = entry
    out = list(lemmas.values())
    for e in out:
        extra = form_of.get(key(e["headword"]))
        if extra:
            e["forms"] = list(dict.fromkeys(e.get("forms", []) + sorted(extra)))
    return out


def convert_tsv(path: Path):
    entries = []
    opener = sys.stdin if str(path) == "-" else path.open(encoding="utf-8", newline="")
    with opener as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            head = clean(row.get("headword", ""))
            ru = [x for x in SPLIT_RE.split((row.get("ru") or "").strip()) if x]
            if not head or not ru:
                continue
            e = {"headword": head, "pos": (row.get("pos") or "—").strip(), "ru": ru, "source": "tsv"}
            forms = [clean(x) for x in SPLIT_RE.split((row.get("forms") or "").strip()) if x]
            if forms:
                e["forms"] = forms
            for src, dst in (("greek", "greek"), ("etymology", "etymology"), ("note", "note")):
                if (row.get(src) or "").strip():
                    e[dst] = row[src].strip()
            entries.append(e)
    return entries


def merge(existing: list[dict], new: list[dict]):
    have = {key(e["headword"]) for e in existing}
    for e in existing:
        for f in e.get("forms", []):
            have.add(key(f))
    added, skipped = [], 0
    for e in new:
        if key(e["headword"]) in have:
            skipped += 1
            continue
        have.add(key(e["headword"]))
        added.append(e)
    return existing + added, len(added), skipped


def main() -> int:
    for stream in (sys.stdout, sys.stderr):  # кириллица в консоли Windows
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap =argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="входной файл (.jsonl или .tsv); «-» — stdin")
    ap.add_argument("--format", choices=["auto", "kaikki", "tsv"], default="auto")
    ap.add_argument("--lang-code", default="cu", help="код языка в дампе (по умолчанию cu)")
    ap.add_argument("--existing", default="public/data/dictionary.json", help="текущий словарь для слияния")
    ap.add_argument("--out", default="public/data/dictionary.json", help="куда записать результат")
    ap.add_argument("--merge", action="store_true", help="добавить к существующему словарю, не меняя его статьи")
    ap.add_argument("--limit", type=int, default=0, help="взять не больше N новых статей")
    args = ap.parse_args()

    path = Path(args.input)
    fmt = args.format
    if fmt == "auto":
        fmt = "tsv" if path.suffix.lower() in (".tsv", ".txt") else "kaikki"
    new = convert_tsv(path) if fmt == "tsv" else convert_kaikki(read_jsonl(path, args.lang_code))
    if args.limit:
        new = new[: args.limit]

    base: dict = {"version": 1, "language": "cu", "entries": []}
    ex_path = Path(args.existing)
    if args.merge and ex_path.exists():
        base = json.loads(ex_path.read_text(encoding="utf-8"))
    entries, added, skipped = merge(base["entries"], new) if args.merge else (new, len(new), 0)

    seen: set[str] = set()
    for e in entries:  # уникальные id (омонимы получают суффикс)
        base_id = e.get("id") or e["headword"]
        cand, n = base_id, 2
        while cand in seen:
            cand = f"{base_id}#{n}"
            n += 1
        e["id"] = cand
        seen.add(cand)

    base["entries"] = entries
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(base, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"прочитано новых статей: {len(new)}, добавлено: {added}, пропущено как дубли: {skipped}, "
          f"всего в словаре: {len(entries)} -> {out}", file=sys.stderr)
    no_ru = sum(1 for e in entries if not e.get("ru"))
    if no_ru:
        print(f"внимание: у {no_ru} статей нет русского перевода (только английский, поле \"en\")", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
