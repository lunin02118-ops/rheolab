#!/usr/bin/env python3
"""WP-0.3: Fix mojibake in Rust source files.

Known corruption: UTF-8 Cyrillic text was re-encoded through ISO-8859-5,
producing sequences like:

    вЂ"  → — (em dash U+2014)
    вЂ¦  → … (ellipsis U+2026)
    Г—   → × (multiplication sign U+00D7)
    в"Ђ  → ─ (box drawing light horizontal U+2500)

Also fixes one severely corrupted Russian error string in restore.rs.
"""

import os
import sys

# Order matters: longer patterns first to avoid partial replacements
FIXES = [
    # em dash variants
    ("вЂ\u201d", "\u2014"),  # вЂ" -> —
    ("вЂ\u201c", "\u2014"),  # вЂ" (left quote variant) -> —
    ("вЂ\u2019", "\u2014"),  # вЂ' -> —
    ("вЂ", "\u2014"),        # fallback for remaining вЂ sequences
    # ellipsis
    ("вЂ¦", "\u2026"),       # вЂ¦ -> …
    # multiplication sign
    ("Г\u00d7", "\u00d7"),   # Г× -> ×
    # box drawing characters used as visual separators
    ("в\u201cЂ", "\u2500"),  # в"Ђ -> ─
    # severely corrupted Russian error message in restore.rs
    (
        "Р\xa4Р\xb0Р\xb9Р\xbb Р\xbdР\xb5 СЃРѕРґРµСЂР¶РёС\x82 "
        "С\x82Р\xb0Р\xb1Р\xbbР\xb8С\x86С\x83 Experiment "
        "вЂ\u201d СЌС\x82Рѕ РЅРµ Р\xb1Р\xb0Р\xb7Р\xb0 "
        "РґР\xb0РЅРЅС\x8bС\x85 RheoLab",
        "Файл не содержит таблицу Experiment \u2014 "
        "это не база данных RheoLab",
    ),
]

SEARCH_ROOTS = [
    os.path.join("src-tauri", "src"),
    os.path.join("src", "rust"),
]
SKIP_DIRS = {"target", ".git", "node_modules"}


def fix_file(path: str) -> int:
    """Return number of replacements made."""
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        print(f"  SKIP (not UTF-8): {path}", file=sys.stderr)
        return 0

    new = content
    count = 0
    for bad, good in FIXES:
        occurrences = new.count(bad)
        if occurrences:
            new = new.replace(bad, good)
            count += occurrences

    if new != content:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(new)
    return count


def main() -> None:
    total_files = 0
    total_fixes = 0

    for root in SEARCH_ROOTS:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith(".rs"):
                    continue
                fpath = os.path.join(dirpath, fname)
                n = fix_file(fpath)
                if n:
                    total_files += 1
                    total_fixes += n
                    print(f"  fixed {n:2d} instance(s): {fpath}")

    print(f"\nDone: {total_fixes} replacement(s) in {total_files} file(s).")


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    main()
