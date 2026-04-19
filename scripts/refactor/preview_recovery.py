"""Preview what the segment-recovery pass would do — write to a file."""
import os, re, sys, io

os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

MOJIBAKE_RUN = re.compile(
    r"(?:"
    r"[\u0400-\u04FF]"
    r"[\u0080-\u00FF\u0400-\u04FF\u2000-\u203F\u201A-\u2122]"
    r"){2,}"
)
RUSSIAN_OK = re.compile(r"^[а-яА-ЯёЁa-zA-Z0-9 \-_.,:;!?()\[\]\"'«»—…/\\\t\n]+$")

results = []

for root in ["src-tauri/src", "src/rust"]:
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in {"target", "node_modules", ".git"}]
        for f in files:
            if not f.endswith(".rs"):
                continue
            p = os.path.join(dirpath, f)
            try:
                with open(p, encoding="utf-8") as fh:
                    data = fh.read()
            except:
                continue
            for m in MOJIBAKE_RUN.finditer(data):
                seg = m.group()
                try:
                    fixed = seg.encode("cp1251").decode("utf-8")
                except Exception:
                    continue
                accepted = bool(RUSSIAN_OK.match(fixed)) or (
                    len(fixed) <= 3 and all(c.isprintable() for c in fixed)
                )
                if accepted and fixed != seg:
                    results.append((p, seg, fixed, "ACCEPT"))
                elif fixed != seg:
                    results.append((p, seg, fixed, "REJECT"))

# Write to UTF-8 file so PowerShell misrendering doesn't matter
with open("runtime/audit/recovery-preview.txt", "w", encoding="utf-8", newline="\n") as out:
    out.write(f"Total candidates: {len(results)}\n\n")
    accept_count = sum(1 for r in results if r[3] == "ACCEPT")
    reject_count = sum(1 for r in results if r[3] == "REJECT")
    out.write(f"ACCEPT: {accept_count}\nREJECT: {reject_count}\n\n")
    out.write("=" * 80 + "\n")
    for path, seg, fixed, verdict in results:
        out.write(f"[{verdict}] {path}\n")
        out.write(f"  seg:   {seg!r}\n")
        out.write(f"  fixed: {fixed!r}\n\n")

print(f"Written {len(results)} candidates to runtime/audit/recovery-preview.txt")
print(f"ACCEPT: {accept_count}, REJECT: {reject_count}")
