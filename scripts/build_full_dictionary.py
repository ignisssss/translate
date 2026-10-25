#!/usr/bin/env python3
"""Сборка полной базы старославянского, церковнославянского и древнерусского слов.

Скачивает открытые источники (кэш в scripts/.cache), разбирает, объединяет по нормализованной
лемме и пишет компактный индекс поиска и чанки с полными статьями для фронтенда:

  public/data/search_index.json     краткие данные всех статей (поиск и автодополнение)
  public/data/chunks/ch_XXXX.json   полные статьи, по первой букве нормализованной леммы
  public/data/sources.json          источники, лицензии, вклад каждого

Источники (отключаются через --exclude ID):
  manual         вручную составленный словарь        data/curated/dictionary.json
  dyachenko      Большой церковно-славянский словарь (Дьяченко), DSL    pod-o-mart/lingvo
  kcs            Краткий церковнославянский словарь, DSL                pod-o-mart/lingvo
  chu-dict       Old Church Slavonic Dictionary (chu-eng), DSL          pod-o-mart/lingvo
  chu-gloss      Old Church Slavonic Glossary (chu-eng), DSL            pod-o-mart/lingvo
  pitt-chu       Pitt chu-eng (только слова без условной записи), DSL   pod-o-mart/lingvo
  pitt-orv       Pitt orv-rus (древнерусский), DSL                      pod-o-mart/lingvo
  lexicon        грамматика, ударения, части речи (TSV)   gold-silver-copper/church-slavonic
  syntacticus    формы и частоты из корпусов (chu.xml, orv.xml)         proiel/syntacticus-dictionaries
  kaikki         английский Викисловарь, язык cu (JSONL)                 kaikki.org
  ruwikt         русский Викисловарь: старославянский, церковнославянский,
                 древнерусский (JSONL)                                   kaikki.org/ruwiktionary

По умолчанию источники без явной лицензии (dyachenko, kcs, chu-dict, chu-gloss, pitt-chu, pitt-orv)
не включаются; флаг --with-restricted добавляет их.

Запуск:  python scripts/build_full_dictionary.py [--refresh] [--with-restricted] [--exclude syntacticus]
Лицензии источников разные (см. README и public/data/sources.json): перед публикацией проверьте их.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
CURATED = ROOT / "data" / "curated" / "dictionary.json"
OUT = ROOT / "public" / "data"

LINGVO = "https://raw.githubusercontent.com/pod-o-mart/lingvo/main/"
CSLEX = "https://raw.githubusercontent.com/gold-silver-copper/church-slavonic/main/crates/church-slavonic/lexicon/"
SYNT = "https://raw.githubusercontent.com/proiel/syntacticus-dictionaries/master/"
KAIKKI = "https://kaikki.org/dictionary/Old%20Church%20Slavonic/kaikki.org-dictionary-OldChurchSlavonic.jsonl"
# русский Викисловарь (выгрузка Kaikki): код языка -> (имя в URL, наш код языка)
RUWIKT = {
    "cu": ("Старославянский", "chu"),
    "chu-ru": ("Церковнославянский", "cs"),
    "orv": ("Древнерусский", "orv"),
}
# источники без явной лицензии: по умолчанию не включаются (--with-restricted включает)
RESTRICTED = {"dyachenko", "kcs", "chu-dict", "chu-gloss", "pitt-chu", "pitt-orv"}

DSL_ZIPS = {
    "dyachenko": "chu-rus_ConciseOldChurch-Unicode_1_5.zip",
    "kcs": "chu-rus_kcs_podomart_1_3.zip",
    "chu-dict": "chu-eng_old-church-slavonic-dictionary_podomart_1_2.zip",
    "chu-gloss": "chu-eng_old-church-slavonic-glossary_podomart_1_1.zip",
    "pitt-chu": "chu-eng_pitt-edu_podomart_2_1.zip",
    "pitt-orv": "orv-rus_pitt-edu_podomart_2_2.zip",
}
LEXICON_FILES = [f"{d}/{n}.tsv" for d in ("ocs", "syn") for n in ("nouns", "verbs", "adjectives", "pronouns")] + ["syn/closed.tsv"]

SOURCE_INFO = {
    "manual": ("Вручную составленный словарь проекта", "", "авторская работа проекта"),
    "dyachenko": ("Большой церковно-славянский словарь (по Г. Дьяченко), DSL-версия М. Подолака / EdwART", "https://github.com/pod-o-mart/lingvo", "в репозитории лицензия не указана; оригинал Дьяченко (1900) — общественное достояние, права на цифровую компиляцию неясны"),
    "kcs": ("Краткий церковнославянский словарь (pagez.ru / orthodoxy.ru), DSL-версия podomart", "https://github.com/pod-o-mart/lingvo", "© Pagez, 2001–2007; лицензия не указана"),
    "chu-dict": ("Old Church Slavonic Dictionary (chu-eng), DSL, podomart", "https://github.com/pod-o-mart/lingvo", "лицензия не указана"),
    "chu-gloss": ("Old Church Slavonic Glossary (chu-eng), DSL, podomart", "https://github.com/pod-o-mart/lingvo", "лицензия не указана"),
    "pitt-chu": ("Old Church Slavonic–English (Pitt), DSL, podomart", "https://github.com/pod-o-mart/lingvo", "лицензия не указана"),
    "pitt-orv": ("Древнерусско-русский словарь (Pitt), DSL, podomart", "https://github.com/pod-o-mart/lingvo", "лицензия не указана"),
    "lexicon": ("church-slavonic: лексикон (части речи, род, ударения)", "https://github.com/gold-silver-copper/church-slavonic", "Apache-2.0 / MIT (данные частично получены из других источников)"),
    "syntacticus": ("Syntacticus dictionaries (PROIEL / TOROT): леммы, формы, частоты", "https://github.com/proiel/syntacticus-dictionaries", "CC BY-NC-SA 3.0/4.0 (некоммерческое использование, ShareAlike)"),
    "kaikki": ("Английский Викисловарь, язык cu (выгрузка Kaikki.org / wiktextract)", "https://kaikki.org/dictionary/Old%20Church%20Slavonic/", "CC BY-SA 4.0 (ShareAlike)"),
    "ruwikt": ("Русский Викисловарь: старославянский, церковнославянский, древнерусский (выгрузка Kaikki.org / wiktextract)", "https://kaikki.org/ruwiktionary/", "CC BY-SA 4.0 (ShareAlike)"),
}
# приоритет источников при слиянии (меньше — важнее): определяет заглавное написание и порядок значений
PRIORITY = {"manual": 0, "chu-dict": 1, "chu-gloss": 1, "ruwikt": 2, "kaikki": 3, "pitt-chu": 4, "dyachenko": 5, "kcs": 6, "pitt-orv": 7}
SYNT_NAMES = {
    "marianus": "Мариинское ев.", "zogr": "Зографское ев.", "supr": "Супрасльская рукопись",
    "kiev-mis": "Киевские листки", "psal-sin": "Синайская псалтырь",
    "vit-const": "Житие Константина", "vit-meth": "Житие Мефодия",
}
LANG_CODE = {"chu": 0, "cs": 1, "orv": 2}

# ───────────────────────────── нормализация (зеркало src/core/normalizer.js) ─────────────────────────────
SUPERSCRIPT = "бвгджзклмнопрстхцчшщ"
SUPER_RE = re.compile("[ⷠ-ⷳ]")
MARKS_RE = re.compile("[̀-ͯ҃-҉ⷴ-ⷿ꙯-꙽ꚞꚟ]")
LOOSE_MAP = {
    "ѣ": "е", "ѧ": "я", "ѩ": "я", "ѫ": "у", "ѭ": "ю", "ѥ": "е", "ꙗ": "я", "ѹ": "у", "ꙋ": "у", "ѡ": "о", "ѻ": "о",
    "ѿ": "от", "і": "и", "ї": "и", "ѵ": "и", "й": "и", "ѳ": "ф", "ѕ": "з", "ꙁ": "з", "ѱ": "пс", "ѯ": "кс",
    "ꙑ": "ы", "ҁ": "к", "щ": "шт",
}
PRE_MAP = str.maketrans({"є": "е", "Є": "Е", "ј": "й", "Ј": "Й", " ": " "})
SPECIAL_LETTERS = set("ѣѧѫѩѭѥꙗѹꙋ")


def prep(s: str) -> str:
    return unicodedata.normalize("NFC", s).translate(PRE_MAP)


def strip_marks(s: str) -> str:
    s = unicodedata.normalize("NFC", s)
    s = SUPER_RE.sub(lambda m: SUPERSCRIPT[ord(m.group()) - 0x2DE0], s)
    return MARKS_RE.sub("", s)


def strict_key(s: str) -> str:
    return strip_marks(s.lower()).replace("ё", "е")


def loose_key(s: str) -> str:
    s = strict_key(prep(s)).replace("оу", "у")
    return "".join(LOOSE_MAP.get(c, c) for c in s).replace("ъ", "").replace("ь", "")


def clean_word(s: str) -> str:
    """Слово для показа и ключей: без знаков ударения и титла, нормализованные буквы."""
    return strip_marks(prep(s)).strip()


# ───────────────────────────── загрузка ─────────────────────────────
def log(*a):
    print(*a, file=sys.stderr, flush=True)


def download(url: str, dest: Path, refresh: bool = False) -> Path | None:
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for attempt in range(1, 4):
        try:
            req = Request(url, headers={"User-Agent": "ocs-translator-build/1.0"})
            with urlopen(req, timeout=120) as r, open(dest.with_suffix(dest.suffix + ".part"), "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            dest.with_suffix(dest.suffix + ".part").replace(dest)
            log(f"  скачано {url.rsplit('/', 1)[-1]}: {dest.stat().st_size / 1024:.0f} КБ")
            return dest
        except (URLError, OSError, TimeoutError) as exc:
            last = exc
            time.sleep(2 * attempt)
    # запасной путь: curl (у него свои настройки TLS, на Windows он часто проходит там, где Python не может)
    if shutil.which("curl"):
        part = dest.with_suffix(dest.suffix + ".part")
        for _ in range(3):
            r = subprocess.run(["curl", "-sSfL", "--retry", "2", "-m", "300", "-o", str(part), url],
                               capture_output=True, text=True)
            if r.returncode == 0 and part.exists() and part.stat().st_size > 0:
                part.replace(dest)
                log(f"  скачано через curl {url.rsplit('/', 1)[-1]}: {dest.stat().st_size / 1024:.0f} КБ")
                return dest
            last = r.stderr.strip() or last
    log(f"  НЕ УДАЛОСЬ скачать {url}: {last}")
    return None


# ───────────────────────────── записи ─────────────────────────────
def new_rec(src: str, lang: str, head: str, **kw) -> dict:
    rec = {
        "src": src, "lang": lang, "head": head, "variants": [], "pos": "", "ru": [], "en": [],
        "gloss": "", "grammar": "", "forms": [], "stress": "", "etymology": "", "examples": [],
        "greek": "", "note": "", "titlo": [], "related": [], "form_of": None,
    }
    rec.update(kw)
    return rec


def uniq(items):
    seen, out = set(), []
    for x in items:
        k = x.strip().lower()
        if x.strip() and k not in seen:
            seen.add(k)
            out.append(x.strip())
    return out


# ───────────────────────────── DSL ─────────────────────────────
def read_dsl_text(zip_path: Path) -> str:
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".dsl") and not n.lower().endswith("_abrv.dsl")]
        raw = z.read(names[0])
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    if raw[:2] and len(raw) > 4 and raw[1:2] == b"\x00":
        return raw.decode("utf-16-le")
    return raw.decode("utf-8-sig")


def parse_dsl_cards(text: str):
    cards, cur = [], None
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        if line[0] in " \t":
            if cur is not None:
                cur[1].append(line.strip())
        else:
            if cur is None or cur[1]:
                cur = ([], [])
                cards.append(cur)
            cur[0].append(line.strip())
    return cards


REF_RE = re.compile(r"\[ref\](.*?)\[/ref\]")
TAG_RE = re.compile(r"\[/?[A-Za-z!*][A-Za-z0-9!*]*(?:\s[^\]]*)?\]")


def dsl_text(s: str) -> str:
    s = REF_RE.sub(r"\1", s)
    s = TAG_RE.sub("", s)
    s = re.sub(r"\\(.)", r"\1", s)
    return re.sub(r"\s+", " ", prep(s)).strip()


def dsl_head(h: str) -> list[str]:
    """Заголовок DSL: {…} — служебная часть (ударение {́} вставляем, {-} убираем)."""
    h = re.sub(r"\{(.*?)\}", lambda m: "" if m.group(1) == "-" else m.group(1), h)
    h = dsl_text(h)
    out = [h]
    if "(" in h:  # необязательные буквы: даём оба написания
        out = [re.sub(r"[()]", "", h), re.sub(r"\([^)]*\)", "", h)]
    return [x.strip() for x in out if x.strip()]


def split_top(text: str, seps: str) -> list[str]:
    parts, depth, cur = [], 0, []
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]" and depth:
            depth -= 1
        if ch in seps and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def meanings_from(text: str, seps: str = ",;") -> list[str]:
    text = re.sub(r"^\s*\d+[.)]\s*", "", text)
    out = []
    for p in split_top(text, seps):
        p = re.sub(r"^\s*\d+[.)]\s*", "", p)
        p = re.sub(r"\s*\[\d+\]", "", p).strip().strip(".").strip()
        if p and len(p) <= 200 and not p.startswith("="):
            out.append(p)
    return out


def head_ok(h: str) -> bool:
    return bool(re.fullmatch(r"[Ѐ-ӿꙀ-ꚟ̀-ͯ҃-҉]+", h))


def pick_head(cands: list[str]) -> str:
    cands = [c for c in cands if c]
    for c in cands:
        if SPECIAL_LETTERS & set(c):
            return c
    for c in cands:
        if c[-1:] in "ъь":
            return c
    return cands[0]


def parse_dyachenko(text: str, src: str) -> list[dict]:
    recs = []
    for heads, body in parse_dsl_cards(text):
        hs = [clean_word(x).lower() for h in heads for x in dsl_head(h)]
        hs = [h for h in hs if head_ok(h)]
        if not hs:
            continue
        accented, lines = "", []
        for i, l in enumerate(body):
            m = re.match(r"^\[m\d\]\[c [a-z]+\](.+?)\[/c\]$", l)
            if m and i == 0 and not accented:
                accented = dsl_text(m.group(1))
                continue
            lines.append(dsl_text(l))
        lines = [l for l in lines if l]
        if not lines:
            continue
        cands = hs + ([clean_word(accented).lower()] if accented else [])
        head = pick_head(cands)
        rec = new_rec(src, "cs", head, variants=[h for h in cands if h != head])
        if accented and strict_key(accented) != accented.lower() and any(MARKS_RE.search(c) for c in accented):
            rec["stress"] = accented
        if src == "kcs":
            full = " ".join(lines)
            first = re.split(r"(?<=[.!?])\s", full)[0].strip().rstrip(".")
            rec["gloss"] = full
            short = first if len(first) <= 80 else first[:77].rsplit(" ", 1)[0] + "…"
            rec["ru"] = [short] if short else []
        else:
            ms = []
            for l in lines:
                if re.match(r"^(см\.|ср\.)", l):
                    continue
                ms += meanings_from(l)
            rec["ru"] = uniq(ms)[:14]
        if rec["ru"]:
            recs.append(rec)
    return recs


def parse_pitt_orv(text: str) -> list[dict]:
    recs = []
    for heads, body in parse_dsl_cards(text):
        hs = [clean_word(x).lower() for h in heads for x in dsl_head(h)]
        hs = [h for h in hs if head_ok(h)]
        if not hs or not body:
            continue
        raw = " ".join(body)
        if re.search(r"\[p\]\[lang name=\"Russian\"\](см|прил\. от сл)", raw):
            continue  # отсылочные статьи
        pos, forms, lines = "", [], []
        for l in body:
            t = dsl_text(l)
            if l.startswith("[m2][com]"):
                if t.startswith("спр."):
                    pos = "гл."
                    forms += [w.strip("(),") for w in t[4:].replace("(", " ").replace(")", " ").split()]
                else:
                    forms.append(t)
                continue
            lines.append(t)
        ms = []
        for t in lines:
            ms += meanings_from(re.sub(r"^\s*\d+\s+", "", t), ".;")
        ms = uniq(ms)[:14]
        if not ms:
            continue
        rec = new_rec("pitt-orv", "orv", hs[0], variants=hs[1:], pos=pos, ru=ms)
        rec["forms"] = [clean_word(f).lower() for f in forms if head_ok(clean_word(f).lower())]
        recs.append(rec)
    return recs


EN_POS = {
    "noun": "сущ.", "verb": "гл.", "adjective": "прил.", "adverb": "нареч.", "particle": "част.",
    "conjunction": "союз", "preposition": "предл.", "pronoun": "мест.", "numeral": "числ.",
    "interjection": "межд.", "proper": "собств.",
}
EN_GENDER = {"masculine": "м. р.", "feminine": "ж. р.", "neuter": "ср. р."}


def parse_chu_dict(text: str) -> list[dict]:
    recs = []
    for heads, body in parse_dsl_cards(text):
        parts = [p.strip() for h in heads for p in dsl_text(re.sub(r"\{(.*?)\}", r"\1", h)).split(",")]
        if not parts or not parts[0]:
            continue
        lemma = re.sub(r"\s+(сѧ|си)$", "", clean_word(parts[0]).lower())
        if not head_ok(lemma):
            continue
        en = []
        for l in body:
            if l.startswith("[m1]") and not l.startswith("[m1][b]"):
                en += meanings_from(dsl_text(l), ";")
        if not en:
            continue
        forms = [clean_word(p).lower() for p in parts[1:] if head_ok(clean_word(p).lower())]
        recs.append(new_rec("chu-dict", "chu", lemma, en=uniq(en)[:8], forms=forms))
    return recs


def parse_chu_gloss(text: str) -> list[dict]:
    recs = []
    for heads, body in parse_dsl_cards(text):
        hs = [clean_word(dsl_text(h)).lower() for h in heads]
        hs = [h for h in hs if head_ok(h)]
        if not hs or not body:
            continue
        pos_raw, form_of, en = "", None, []
        for l in body:
            m = re.search(r"\[i\].*? of \[/i\]\[b\](.+?)\[/b\]", l)
            if m:
                form_of = clean_word(dsl_text(m.group(1))).lower()
                continue
            p = re.match(r"^\[m2\]\[p\](.+?)\[/p\]$", l)
            if p and not pos_raw:
                pos_raw = p.group(1)
                continue
            t = dsl_text(l)
            if t and not l.startswith("[m2][i]"):
                en += meanings_from(t, ";")
        pos = ""
        gender = ""
        for k, v in EN_POS.items():
            if pos_raw.startswith(k):
                pos = v
        for k, v in EN_GENDER.items():
            if k in pos_raw:
                gender = v
        rec = new_rec("chu-gloss", "chu", hs[0], pos=pos, en=uniq(en)[:8], grammar=gender)
        rec["form_of"] = form_of
        if form_of or en:
            recs.append(rec)
    return recs


def parse_pitt_chu(text: str) -> tuple[list[dict], int]:
    recs, skipped = [], 0
    for heads, body in parse_dsl_cards(text):
        if len(heads) != 1:
            skipped += 1
            continue
        h = clean_word(heads[0]).lower()
        if not head_ok(h) or "-" in heads[0] or "{" in heads[0]:
            skipped += 1  # условная запись (основа + окончание/класс) — не разбираем
            continue
        if any("[p]see[/p]" in l or "rel. to" in l for l in body):
            skipped += 1
            continue
        en = []
        for l in body:
            if l.startswith("[i]"):
                continue
            t = re.sub(r"^\+\w+\s+", "", dsl_text(re.sub(r"\[p\].*?\[/p\]", "", l)))
            if t:
                en += meanings_from(t, ";")
        if en:
            recs.append(new_rec("pitt-chu", "chu", h, en=uniq(en)[:6]))
        else:
            skipped += 1
    return recs, skipped


# ───────────────────────────── Kaikki (Викисловарь) ─────────────────────────────
KAIKKI_POS = {
    "noun": "сущ.", "verb": "гл.", "adj": "прил.", "adv": "нареч.", "prep": "предл.", "conj": "союз",
    "pron": "мест.", "num": "числ.", "particle": "част.", "intj": "межд.", "name": "собств.", "det": "мест.-прил.",
}


def parse_kaikki(path: Path) -> list[dict]:
    lemmas, forms_of = {}, defaultdict(list)
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            if o.get("lang_code") != "cu" or o.get("pos") not in KAIKKI_POS:
                continue
            head = clean_word(o.get("word", "")).lower()
            if not head or " " in head or not head_ok(head):
                continue
            en, parent, ex = [], None, []
            for s in o.get("senses", []):
                ref = s.get("form_of") or s.get("alt_of")
                if ref:
                    parent = clean_word(ref[0].get("word", "")).lower()
                    continue
                for g in s.get("glosses", [])[:1]:
                    g = re.sub(r"\s+", " ", g).strip().rstrip(".")
                    if g:
                        en.append(g)
                for e in s.get("examples", [])[:1]:
                    if e.get("text") and (e.get("english") or e.get("translation")):
                        ex.append({"cu": e["text"], "ru": "", "en": e.get("english") or e.get("translation")})
            if parent:
                forms_of[parent].append(head)
                continue
            if not en:
                continue
            forms = [clean_word(f["form"]).lower() for f in o.get("forms", [])
                     if not (set(f.get("tags", [])) & {"romanization", "table-tags", "inflection-template", "class"})]
            rec = new_rec("kaikki", "chu", head, pos=KAIKKI_POS[o["pos"]], en=uniq(en)[:6],
                          forms=[f for f in forms if head_ok(f) and f != head], examples=ex[:2],
                          etymology=re.sub(r"\s+", " ", o.get("etymology_text") or "").strip()[:400])
            k = loose_key(head)
            if k in lemmas:
                lemmas[k]["en"] = uniq(lemmas[k]["en"] + rec["en"])[:8]
            else:
                lemmas[k] = rec
    for parent, fs in forms_of.items():
        r = lemmas.get(loose_key(parent))
        if r:
            r["forms"] = uniq(r["forms"] + fs)
    return list(lemmas.values())


# ───────────────────────────── русский Викисловарь (Kaikki) ─────────────────────────────
RUWIKT_POS = dict(KAIKKI_POS, particle="част.", prefix="приставка")
FORM_GLOSS_RE = re.compile(
    r"^(?:форма\b|прич\.|причастие|деепр\.|краткая форма|сравнит|превосх|повелит|"
    r".*\b(?:глагола|существительного|прилагательного|местоимения|числительного|наречия)\s+\S+$)"
)


def ruwikt_form_target(gloss: str) -> str | None:
    """«прич. от свободити», «форма … глагола внести» -> лемма, от которой образована форма."""
    if not FORM_GLOSS_RE.match(gloss.strip()):
        return None
    m = re.search(r"([\u0400-\u04FF\uA640-\uA69F\u0300-\u036f\u0483-\u0489]+)\s*[.;,)]*$", gloss.strip())
    return clean_word(m.group(1)).lower() if m else None


def parse_ruwikt(path: Path, code: str, lang: str) -> list[dict]:
    recs = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            if o.get("lang_code") != code:
                continue
            head = clean_word(o.get("word", "")).lower()
            if not head or " " in head or not head_ok(head):
                continue
            ru, ex, form_of = [], [], None
            for sense in o.get("senses", []):
                ref = sense.get("form_of") or sense.get("alt_of")
                if ref and ref[0].get("word"):
                    form_of = clean_word(ref[0]["word"]).lower()
                    continue
                for g in sense.get("glosses", [])[:1]:
                    g = re.sub(r"\s+", " ", g).strip()
                    tgt = ruwikt_form_target(g)
                    if tgt:
                        form_of = tgt
                        continue
                    ru += [m for m in meanings_from(g) if not m.startswith(("см.", "ср."))]
                for e in sense.get("examples", [])[:1]:
                    if e.get("text") and e.get("translation"):
                        ex.append({"cu": re.sub(r"\s+", " ", e["text"]).strip(), "ru": e["translation"].strip()})
            forms = []
            for f in o.get("forms", []):
                w = clean_word(f.get("form", "")).lower()
                # в выгрузке для существительных «формы» — одни окончания (ъ, а, и): отбрасываем
                if (len(w) >= 3 and head_ok(w) and w != head and loose_key(w)[:2] == loose_key(head)[:2]
                        and not set(f.get("tags", [])) & {"romanization", "table-tags", "inflection-template"}):
                    forms.append(w)
            etym = ""
            texts = o.get("etymology_texts") or []
            if texts and "??" not in texts[0]:
                etym = re.sub(r"\s+", " ", texts[0]).strip()[:400]
            related = [clean_word(x["word"]).lower() for k in ("related", "derived", "synonyms")
                       for x in o.get(k, []) if isinstance(x, dict) and x.get("word")]
            rec = new_rec("ruwikt", lang, head, pos=RUWIKT_POS.get(o.get("pos", ""), ""), ru=uniq(ru)[:14],
                          forms=uniq(forms)[:30], examples=ex[:2], etymology=etym,
                          related=[r for r in uniq(related) if head_ok(r) and r != head][:12])
            rec["form_of"] = form_of if not rec["ru"] else None
            if rec["ru"] or rec["form_of"]:
                recs.append(rec)
    return recs


# ───────────────────────────── лексикон church-slavonic и Syntacticus ─────────────────────────────
LEX_POS = {"n": "сущ.", "v": "гл.", "a": "прил.", "pron": "мест."}
LEX_CLOSED = {"conj": "союз", "adv": "нареч.", "prep": "предл.", "part": "част.", "intj": "межд.", "num": "числ.",
              "advpro": "нареч.", "pred": "предикатив"}
LEX_GENDER = {"m": "м. р.", "f": "ж. р.", "n": "ср. р."}


def read_lexicon(files: list[Path]):
    rows = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            lines = [l for l in fh if not l.startswith("#")]
        rd = csv.DictReader(lines, delimiter="\t")
        for r in rd:
            lemma = r.get("lemma", "")
            if not lemma:
                continue
            pos = LEX_POS.get(r.get("pos", ""), "")
            if r.get("pos") == "x":
                pos = LEX_CLOSED.get(r.get("class", ""), "")
            gender = LEX_GENDER.get(r.get("gender", ""), "")
            rows.append({"lemma": lemma, "ocs": "/ocs/" in str(f).replace("\\", "/") or f.name.startswith("cs_ocs"),
                         "pos": pos, "gender": gender, "anim": r.get("anim") == "anim"})
    return rows


def read_syntacticus(path: Path, limit_forms: int = 40):
    out = {}
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag != "lemma":
            continue
        lemma = clean_word(el.get("lemma", "")).lower()
        lemma = re.sub(r"#\d+$", "", lemma)
        if lemma and lemma != "?" and head_ok(lemma):
            srcs = [s.get("idref") for s in el.findall("./distribution/source")]
            total = sum(int(s.get("n", "0")) for s in el.findall("./distribution/source"))
            forms = []
            for s2 in el.iter("slot2"):
                f = clean_word(s2.get("form", "")).lower()
                if f and head_ok(f) and f != lemma and f not in forms:
                    forms.append(f)
            k = loose_key(lemma)
            prev = out.get(k)
            if prev:
                prev["freq"] += total
                prev["forms"] = uniq(prev["forms"] + forms)[:limit_forms]
                prev["sources"] = sorted(set(prev["sources"]) | set(srcs))
            else:
                out[k] = {"freq": total, "forms": forms[:limit_forms], "sources": sorted(set(srcs))}
        el.clear()
    return out


# ───────────────────────────── слияние ─────────────────────────────
def load_manual() -> list[dict]:
    if not CURATED.exists():
        log(f"  нет {CURATED} — ручной словарь пропущен")
        return []
    data = json.loads(CURATED.read_text(encoding="utf-8"))
    recs = []
    for e in data["entries"]:
        rec = new_rec("manual", "chu", e["headword"], pos=e.get("pos", ""), ru=e.get("ru", []), en=e.get("en", []),
                      gloss=e.get("gloss", ""), grammar=e.get("grammar", ""), forms=e.get("forms", []),
                      etymology=e.get("etymology", ""), examples=e.get("examples", []), greek=e.get("greek", ""),
                      note=e.get("note", ""), titlo=e.get("titlo", []), related=e.get("related", []))
        recs.append(rec)
    return recs


def good_form(form: str, lemma: str) -> bool:
    """Отсекает обрывки (бь, бъ), которые встречаются среди засвидетельствованных форм."""
    return len(loose_key(form)) >= min(2, len(loose_key(lemma)))


def merge(records: list[dict]):
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    forms_pending = []
    for r in records:
        if r.get("form_of"):
            forms_pending.append(r)
            continue
        if not (r["ru"] or r["en"]):
            continue
        grp = "o" if r["lang"] == "orv" else "s"
        k = loose_key(r["head"])
        if k:
            groups[(grp, k)].append(r)

    merged = {}
    for key, recs in groups.items():
        recs.sort(key=lambda r: PRIORITY[r["src"]])
        first = recs[0]
        e = {
            "head": first["head"] if first["src"] == "manual" else clean_word(first["head"]),
            "lang": "orv" if key[0] == "o" else ("chu" if any(r["lang"] == "chu" for r in recs) else "cs"),
            "pos": next((r["pos"] for r in recs if r["pos"]), ""),
            "ru": uniq([m for r in recs for m in r["ru"]]),
            "en": uniq([m for r in recs for m in r["en"]]),
            "gloss": next((r["gloss"] for r in recs if r["gloss"] and r["src"] != "kcs"), ""),
            "grammar": next((r["grammar"] for r in recs if r["grammar"]), ""),
            "etymology": next((r["etymology"] for r in recs if r["etymology"]), ""),
            "greek": next((r["greek"] for r in recs if r["greek"]), ""),
            "note": next((r["note"] for r in recs if r["note"]), ""),
            "stress": next((r["stress"] for r in recs if r["stress"]), ""),
            "examples": [x for r in recs for x in r["examples"]][:4],
            "related": uniq([x for r in recs for x in r["related"]]),
            "titlo": uniq([x for r in recs for x in r["titlo"]]),
            "variants": [], "forms": [], "sources": sorted({r["src"] for r in recs}, key=lambda s: PRIORITY[s]),
            "freq": 0, "attested": [],
        }
        kcs = next((r for r in recs if r["src"] == "kcs"), None)
        if kcs and kcs["gloss"] and not e["gloss"]:
            e["gloss"] = kcs["gloss"]
        spell = [r["head"] for r in recs] + [v for r in recs for v in r["variants"]]
        e["variants"] = [v for v in uniq(spell) if strict_key(v) != strict_key(e["head"])]
        e["forms"] = [f for f in uniq([f for r in recs for f in r["forms"]]) if strict_key(f) != strict_key(e["head"])]
        merged[key] = e

    attached = 0
    for r in forms_pending:
        tgt = merged.get(("o" if r["lang"] == "orv" else "s", loose_key(r["form_of"])))
        if tgt and strict_key(r["head"]) != strict_key(tgt["head"]):
            tgt["forms"] = uniq(tgt["forms"] + [r["head"]])
            attached += 1
    return merged, attached


def resolve_related(merged) -> int:
    """Оставляет в related только слова, которые есть в базе, и приводит их к заглавным написаниям."""
    kept = 0
    for (grp, _), e in merged.items():
        out = []
        for w in e["related"]:
            tgt = merged.get((grp, loose_key(w))) or (merged.get(("s", loose_key(w))) if grp == "o" else None)
            if tgt and tgt is not e and tgt["head"] not in out:
                out.append(tgt["head"])
        e["related"] = out[:12]
        kept += len(out)
    return kept


def enrich_lexicon(merged, rows):
    matched = 0
    for row in rows:
        e = merged.get(("s", loose_key(row["lemma"])))
        if not e:
            continue
        matched += 1
        if "lexicon" not in e["sources"]:
            e["sources"].append("lexicon")
        if not e["pos"] and row["pos"]:
            e["pos"] = row["pos"]
        if row["gender"] and row["gender"] not in e["grammar"]:
            bits = [row["gender"]] + (["одуш."] if row["anim"] else [])
            e["grammar"] = (e["grammar"] + "; " if e["grammar"] else "") + ", ".join(bits)
        has_accent = bool(MARKS_RE.search(unicodedata.normalize("NFC", row["lemma"])))
        if has_accent and not e["stress"]:
            e["stress"] = unicodedata.normalize("NFC", row["lemma"])
        plain = clean_word(row["lemma"]).lower()
        if plain and strict_key(plain) != strict_key(e["head"]) and plain not in e["variants"]:
            e["variants"].append(plain)
    return matched


def enrich_syntacticus(merged, data, grp, label_attested):
    matched = 0
    for k, d in data.items():
        e = merged.get((grp, k))
        if not e:
            continue
        matched += 1
        if "syntacticus" not in e["sources"]:
            e["sources"].append("syntacticus")
        e["freq"] += d["freq"]
        e["forms"] = uniq(e["forms"] + [f for f in d["forms"] if good_form(f, e["head"])])
        if label_attested:
            e["attested"] = sorted({SYNT_NAMES.get(s, s) for s in d["sources"]})
            if e["lang"] == "cs":
                e["lang"] = "chu"  # слово засвидетельствовано в староболгарских памятниках
    return matched


# ───────────────────────────── вывод ─────────────────────────────
def short_ru(meanings: list[str], n: int = 4, width: int = 50) -> str:
    out = []
    for m in meanings[:n]:
        m = re.sub(r"\s*\([^)]*\)", "", m).replace(";", ",").strip()
        if len(m) > width:
            m = m[: width - 1].rsplit(" ", 1)[0] + "…"
        if m:
            out.append(m)
    return "; ".join(out)


def chunk_letter(head: str) -> str:
    k = loose_key(head)
    c = k[:1]
    return c if re.fullmatch(r"[а-яё]", c) else "_"


def write_output(merged, extra_sources: dict):
    entries = list(merged.values())
    rank = {"chu": 0, "cs": 1, "orv": 2}
    entries.sort(key=lambda e: (0 if "manual" in e["sources"] else 1, rank[e["lang"]], -e["freq"], loose_key(e["head"])))

    letters = sorted({chunk_letter(e["head"]) for e in entries})
    lidx = {c: i for i, c in enumerate(letters)}
    chunks = defaultdict(dict)
    rows = []
    for e in entries:
        eid = e["head"] + ("#orv" if e["lang"] == "orv" else "")
        fs = uniq(e["variants"] + e["forms"])
        fs = [f.replace(" ", "_") for f in fs if " " not in f][:24]
        c = chunk_letter(e["head"])
        rows.append([
            e["head"], e["pos"] or "", short_ru(e["ru"]), short_ru(e["en"], 3, 60), " ".join(fs),
            LANG_CODE[e["lang"]], lidx[c], " ".join(t.replace(" ", "_") for t in e["titlo"]),
        ])
        detail = {"ru": e["ru"], "en": e["en"], "sources": e["sources"]}
        for k_out, k_in in (("gloss", "gloss"), ("grammar", "grammar"), ("etymology", "etymology"), ("greek", "greek"),
                            ("note", "note"), ("stress", "stress")):
            if e[k_in]:
                detail[k_out] = e[k_in]
        if e["examples"]:
            detail["examples"] = e["examples"]
        if e["related"]:
            detail["related"] = e["related"]
        if e["variants"]:
            detail["variants"] = e["variants"][:30]
        if e["forms"]:
            detail["forms"] = e["forms"][:80]
        if e["titlo"]:
            detail["titlo"] = e["titlo"]
        if e["freq"]:
            detail["freq"] = e["freq"]
        if e["attested"]:
            detail["attested"] = e["attested"]
        chunks[c][eid] = detail

    OUT.mkdir(parents=True, exist_ok=True)
    cdir = OUT / "chunks"
    cdir.mkdir(exist_ok=True)
    for old in cdir.glob("ch_*.json"):
        old.unlink()
    files = []
    for c in letters:
        name = f"ch_{ord(c):04x}.json"
        (cdir / name).write_text(json.dumps(chunks[c], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        files.append(name)
    index = {
        "v": 2, "count": len(rows), "letters": letters, "chunks": files,
        "cols": ["headword", "pos", "ru", "en", "forms", "lang", "chunk", "titlo"],
        "langs": ["chu", "cs", "orv"], "entries": rows,
    }
    idx_path = OUT / "search_index.json"
    idx_path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    counts = Counter(s for e in entries for s in e["sources"])
    (OUT / "sources.json").write_text(json.dumps({
        "generated": time.strftime("%Y-%m-%d"),
        "sources": [{"id": k, "name": SOURCE_INFO[k][0], "url": SOURCE_INFO[k][1], "license": SOURCE_INFO[k][2],
                     "entries": counts.get(k, 0)} for k in SOURCE_INFO if counts.get(k)],
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return entries, idx_path, cdir


def human(n: float) -> str:
    return f"{n / 1024 / 1024:.2f} МБ" if n > 1 << 20 else f"{n / 1024:.0f} КБ"


def gz_size(p: Path) -> int:
    return len(gzip.compress(p.read_bytes(), 6))


def main() -> int:
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="скачать источники заново")
    ap.add_argument("--exclude", default="", help="источники через запятую, которые не включать")
    ap.add_argument("--with-restricted", action="store_true",
                    help="включить источники без явной лицензии: " + ", ".join(sorted(RESTRICTED)))
    args = ap.parse_args()
    excl = {x.strip() for x in args.exclude.split(",") if x.strip()}
    if not args.with_restricted:
        excl |= RESTRICTED
    use = lambda s: s not in excl  # noqa: E731
    t0 = time.time()
    stats = {"skipped": {}, "failed": []}

    log("== загрузка ==")
    records: list[dict] = []
    if use("manual"):
        m = load_manual()
        records += m
        log(f"  manual: {len(m)}")
    for sid, fname in DSL_ZIPS.items():
        if not use(sid):
            continue
        p = download(LINGVO + fname, CACHE / fname, args.refresh)
        if not p:
            stats["failed"].append(sid)
            continue
        text = read_dsl_text(p)
        if sid in ("dyachenko", "kcs"):
            rs = parse_dyachenko(text, sid)
        elif sid == "pitt-orv":
            rs = parse_pitt_orv(text)
        elif sid == "chu-dict":
            rs = parse_chu_dict(text)
        elif sid == "chu-gloss":
            rs = parse_chu_gloss(text)
        else:
            rs, sk = parse_pitt_chu(text)
            stats["skipped"][sid] = sk
        records += rs
        log(f"  {sid}: {len(rs)} статей")
    if use("kaikki"):
        p = download(KAIKKI, CACHE / "kaikki-cu.jsonl", args.refresh)
        if p:
            rs = parse_kaikki(p)
            records += rs
            log(f"  kaikki: {len(rs)} статей")
        else:
            stats["failed"].append("kaikki")

    if use("ruwikt"):
        for code, (name, lang) in RUWIKT.items():
            url = f"https://kaikki.org/ruwiktionary/{quote(name)}/kaikki.org-dictionary-{quote(name)}.jsonl"
            p = download(url, CACHE / f"ruwikt-{code}.jsonl", args.refresh)
            if not p:
                stats["failed"].append(f"ruwikt-{code}")
                continue
            rs = parse_ruwikt(p, code, lang)
            records += rs
            log(f"  ruwikt {name}: {len(rs)} записей")

    merged, attached = merge(records)
    log(f"== слияние: {len(merged)} уникальных лемм, присоединено форм-ссылок: {attached} ==")

    lex_total = lex_matched = 0
    if use("lexicon"):
        files = []
        for rel in LEXICON_FILES:
            p = download(CSLEX + rel, CACHE / ("cs_" + rel.replace("/", "_")), args.refresh)
            if p:
                files.append(p)
        if files:
            rows = read_lexicon(files)
            lex_total = len(rows)
            lex_matched = enrich_lexicon(merged, rows)
            log(f"  lexicon: {lex_total} лексем, совпало с переводами: {lex_matched}")
        else:
            stats["failed"].append("lexicon")
    synt = {}
    if use("syntacticus"):
        for lang, grp in (("chu", "s"), ("orv", "o")):
            p = download(SYNT + f"{lang}.xml", CACHE / f"syntacticus-{lang}.xml", args.refresh)
            if not p:
                stats["failed"].append(f"syntacticus-{lang}")
                continue
            data = read_syntacticus(p)
            m = enrich_syntacticus(merged, data, grp, grp == "s")
            synt[lang] = (len(data), m)
            log(f"  syntacticus {lang}: {len(data)} лемм, совпало: {m}")

    rel = resolve_related(merged)
    log(f"  связанных слов (внутри базы): {rel}")
    entries, idx_path, cdir = write_output(merged, {})

    # ───── статистика ─────
    total = len(entries)
    with_ru = sum(1 for e in entries if e["ru"])
    en_only = total - with_ru
    by_lang = Counter(e["lang"] for e in entries)
    by_src = Counter(s for e in entries for s in e["sources"])
    chunk_files = sorted(cdir.glob("ch_*.json"))
    chunk_bytes = sum(p.stat().st_size for p in chunk_files)
    chunk_gz = sum(gz_size(p) for p in chunk_files)
    big = max(chunk_files, key=lambda p: p.stat().st_size)
    idx_b = idx_path.stat().st_size
    print("\n===== ИТОГ СБОРКИ =====")
    print(f"Уникальных слов (лемм):        {total}")
    print(f"  с русским переводом:         {with_ru}")
    print(f"  только с английским:         {en_only}")
    print("  по языкам:                   " + ", ".join(f"{k}: {v}" for k, v in sorted(by_lang.items())))
    print("  по источникам (вхождений):   " + ", ".join(f"{k}: {v}" for k, v in by_src.most_common()))
    print(f"  с формами слова:             {sum(1 for e in entries if e['forms'])}")
    print(f"  с ударением:                 {sum(1 for e in entries if e['stress'])}")
    print(f"  с примерами:                 {sum(1 for e in entries if e['examples'])}")
    print(f"  с титлом:                    {sum(1 for e in entries if e['titlo'])}")
    print(f"  со связанными словами:       {sum(1 for e in entries if e['related'])}")
    print(f"Лексикон church-slavonic:      {lex_total} лексем, из них с переводом в базе: {lex_matched} "
          f"(остальные без перевода в базу не включены)")
    for lang, (n, m) in synt.items():
        print(f"Syntacticus {lang}:               {n} лемм, совпало с базой: {m}")
    if stats["skipped"]:
        print("Пропущено при разборе:         " + ", ".join(f"{k}: {v}" for k, v in stats["skipped"].items()))
    if stats["failed"]:
        print("НЕ СКАЧАНО:                    " + ", ".join(stats["failed"]))
    print(f"Размер search_index.json:      {human(idx_b)} (gzip {human(gz_size(idx_path))})")
    print(f"Размер чанков ({len(chunk_files)} файлов):    {human(chunk_bytes)} (gzip {human(chunk_gz)}), "
          f"крупнейший {big.name} {human(big.stat().st_size)}")
    print(f"Время сборки: {time.time() - t0:.1f} с")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
