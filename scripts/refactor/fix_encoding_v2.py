#!/usr/bin/env python3
"""WP-0.3-v2: Extended mojibake cleanup for Rust and TypeScript sources.

The original `fix_encoding.py` (v1) left the following patterns uncleaned:

    в”Ђ  → ─    (box drawing horizontal, right-quote variant)
    в†’  → →    (rightwards arrow)
    в†ђ  → ←    (leftwards arrow)
    в‰€  → ≈    (approximately equal)
    Р°,Рµ,…    (fully mojibake Russian strings — UTF-8 of CP1251 of UTF-8)

This v2 script does two passes:

  1. **Literal-replacement pass** — runs the original v1 table plus the new
     symbol entries above.  Fast, deterministic, safe.
  2. **Segment-recovery pass** — finds contiguous runs of mojibake-looking
     characters (starting with Р/С/Ё/Ђ/Љ/Њ/Ћ/Ќ/Џ/ѓ/џ or Г), tries to
     recover them via `.encode('cp1251').decode('utf-8')`, and substitutes
     only when the result is plausible Russian text.

Run: `python scripts/refactor/fix_encoding_v2.py [--dry-run]`
"""

import os
import re
import sys

# --------------------------------------------------------------------------- #
# Pass 1 — literal substitution table                                         #
# --------------------------------------------------------------------------- #

FIXES = [
    # em dash variants
    ("вЂ\u201d", "\u2014"),  # вЂ" -> —
    ("вЂ\u201c", "\u2014"),
    ("вЂ\u2019", "\u2014"),
    ("вЂ", "\u2014"),
    # ellipsis
    ("вЂ¦", "\u2026"),
    # multiplication sign
    ("Г\u00d7", "\u00d7"),
    ("Г\u2014", "\u00d7"),  # Г— -> ×
    # box drawing horizontal (v2: both left- and right-quote variants)
    ("в\u201cЂ", "\u2500"),  # в"Ђ  (left quote)  -> ─
    ("в\u201dЂ", "\u2500"),  # в"Ђ  (right quote) -> ─
    # arrows
    ("в\u2020\u2019", "\u2192"),  # в†' -> →
    ("в\u2020\u201c", "\u2190"),  # в†" -> ←
    ("в\u2020\u201d", "\u2190"),
    ("в\u2020\u0402", "\u2190"),  # в†Ђ -> ←
    ("в\u2020\u0452", "\u2190"),  # в†ђ -> ←
    # approximately equal
    ("в\u2030\u20ac", "\u2248"),  # в‰€ -> ≈
    # misc. sometimes seen
    ("В\u00a0", "\u00a0"),       # В  -> NBSP
    # severely corrupted Russian error message in restore.rs (legacy)
    (
        "Р\xa4Р\xb0Р\xb9Р\xbb Р\xbdР\xb5 СЃРѕРґРµСЂР¶РёС\x82 "
        "С\x82Р\xb0Р\xb1Р\xbbР\xb8С\x86С\x83 Experiment "
        "вЂ\u201d СЌС\x82Рѕ РЅРµ Р\xb1Р\xb0Р\xb7Р\xb0 "
        "РґР\xb0РЅРЅС\x8bС\x85 RheoLab",
        "Файл не содержит таблицу Experiment \u2014 "
        "это не база данных RheoLab",
    ),
]

# --------------------------------------------------------------------------- #
# Pass 2 — segment recovery                                                   #
# --------------------------------------------------------------------------- #

# Run of ≥ 2 mojibake "pairs" where each pair is a cyrillic wrapper plus an
# extended-Latin / punctuation char.  Recovery through cp1251→utf-8 + the
# strict RUSSIAN_OK filter protects against false positives.
MOJIBAKE_RUN = re.compile(
    r"(?:"
    r"[\u0400-\u04FF]"                                        # cyrillic wrapper (any)
    r"[\u0080-\u00FF\u0400-\u04FF\u2000-\u203F\u201A-\u2122]" # broad second-char class
    r"){2,}"
)

# Plausible Russian / punctuation / digit / ASCII after recovery
RUSSIAN_OK = re.compile(r"^[а-яА-ЯёЁa-zA-Z0-9 \-_.,:;!?()\[\]\"'«»—…/\\\t\n]+$")


def try_recover_segment(seg: str) -> str | None:
    """Try to recover a double-encoded segment.  Return None if implausible."""
    try:
        fixed = seg.encode("cp1251", errors="strict").decode("utf-8", errors="strict")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None

    # Accept only if the result is plausibly-legal Russian text
    if RUSSIAN_OK.match(fixed):
        return fixed
    # Also accept single ASCII recoveries like "—" or "…"
    if len(fixed) <= 3 and all(c.isprintable() for c in fixed):
        return fixed
    return None


def segment_recover(content: str) -> tuple[str, int]:
    """Return (new_content, count_recovered)."""
    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        seg = m.group()
        rec = try_recover_segment(seg)
        if rec is not None and rec != seg:
            count += 1
            return rec
        return seg

    new = MOJIBAKE_RUN.sub(repl, content)
    return new, count


# --------------------------------------------------------------------------- #
# Driver                                                                      #
# --------------------------------------------------------------------------- #

SEARCH_ROOTS = [
    os.path.join("src-tauri", "src"),
    os.path.join("src", "rust"),
]
SKIP_DIRS = {"target", ".git", "node_modules", "dist"}
EXTENSIONS = (".rs",)


def fix_file(path: str, dry: bool) -> tuple[int, int]:
    """Return (literal_count, recovery_count)."""
    try:
        with open(path, encoding="utf-8") as f:
            original = f.read()
    except UnicodeDecodeError:
        print(f"  SKIP (not UTF-8): {path}", file=sys.stderr)
        return 0, 0

    new = original
    literal = 0
    for bad, good in FIXES:
        occurrences = new.count(bad)
        if occurrences:
            new = new.replace(bad, good)
            literal += occurrences

    new, recovered = segment_recover(new)

    if new != original and not dry:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(new)

    return literal, recovered


def main() -> None:
    dry = "--dry-run" in sys.argv

    os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    total_files = 0
    total_literal = 0
    total_recovery = 0

    for root in SEARCH_ROOTS:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith(EXTENSIONS):
                    continue
                fpath = os.path.join(dirpath, fname)
                lit, rec = fix_file(fpath, dry)
                if lit or rec:
                    total_files += 1
                    total_literal += lit
                    total_recovery += rec
                    mark = "(dry)" if dry else ""
                    print(f"  lit={lit:2d} rec={rec:2d} {mark} {fpath}")

    action = "would fix" if dry else "fixed"
    print(
        f"\nDone: {action} {total_literal} literal + {total_recovery} recovery "
        f"replacement(s) across {total_files} file(s)."
    )


if __name__ == "__main__":
    main()
