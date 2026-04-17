#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  download_tds_usa.sh
#  Скачивание TDS / SDS для американских реагентов ГРП
#  Производители: Halliburton · Baker Hughes · SLB · Syensqo
#                 Ashland · ChampionX · Kemira
#  Запуск: chmod +x download_tds_usa.sh && ./download_tds_usa.sh
# ════════════════════════════════════════════════════════════════

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DIR="tds_usa"
mkdir -p "$DIR" && cd "$DIR"
OK=0; FAIL=0

dl() {
  local FILE="$1" URL="$2" DESC="$3"
  echo "▶ $FILE"
  echo "  $DESC"
  curl -L --silent --fail --max-time 40 \
    -H "User-Agent: $UA" \
    -H "Accept: application/pdf,*/*" \
    -o "$FILE" "$URL" \
    && { SIZE=$(du -sh "$FILE" | cut -f1); echo "  ✓ OK ($SIZE)"; OK=$((OK+1)); } \
    || { echo "  ✗ FAIL — $URL"; FAIL=$((FAIL+1)); }
  sleep 1
}

echo "════════════════════════════════════════"
echo " США | Американские реагенты ГРП"
echo "════════════════════════════════════════"

# ── HALLIBURTON ───────────────────────────────────────────────────
dl "Halliburton_FightR_EC1_SDS.pdf" \
   "https://dam.assets.ohio.gov/image/upload/ohiodnr.gov/documents/oil-gas/msds/FightR%20EC-1_Halliburton_SDS.pdf" \
   "FightR EC-1 — SDS (Ohio DNR, публичное раскрытие)"

dl "Halliburton_FightR_EC17_SDS.pdf" \
   "https://www.rangeresources.com/wp-content/uploads/2024/12/Friction-Reducer-FDP-S1463-22-Halliburton-1.pdf" \
   "FightR FDP-S1463-22 — SDS (Range Resources disclosure)"

# ── BAKER HUGHES ──────────────────────────────────────────────────
dl "BakerHughes_Lightning_FracFluid_Spec.pdf" \
   "https://www.bakerhughes.com/sites/bakerhughes/files/2021-03/lightning-fracturing-fluid-system-spec.pdf" \
   "Lightning Fracturing Fluid System — Product Spec"

# ── SLB (SCHLUMBERGER) ────────────────────────────────────────────
dl "SLB_J480_YF100HTD_SDS.pdf" \
   "https://www.shell.com.au/content/dam/shell/assets/en/australia/documents/j480.pdf" \
   "J480 / YF100HTD Crosslinker Delay Agent — SDS (Shell AU)"

dl "SLB_CrosslinkedBorate_YF100Flex_ProductSheet.pdf" \
   "https://www.slb.com/-/media/files/stimulation/product-sheet/crosslinked-borate-fluid-ps.ashx" \
   "High-Performance Crosslinked Borate Fluid (YF100Flex/FlexD) — Product Sheet"

# ── SYENSQO (SOLVAY NOVECARE) ─────────────────────────────────────
dl "Syensqo_Tiguar_HPG_Brochure.pdf" \
   "https://www.syensqo.com/sites/g/files/alwlxe161/files/tridion/documents/Tiguar-Brochure.pdf" \
   "Tiguar HPG — Brochure (4 марки: 308NB / HP8FF / 415 / 418)"

# Резервный URL Syensqo (если основной даёт 403)
if [ ! -s "Syensqo_Tiguar_HPG_Brochure.pdf" ]; then
  echo "  ↩ Пробую резервный URL..."
  curl -L --silent --fail --max-time 40 \
    -H "User-Agent: $UA" \
    -H "Referer: https://www.syensqo.com/en/brands/tiguar" \
    -o "Syensqo_Tiguar_HPG_Brochure.pdf" \
    "https://content.syensqo.com/l/213851/2025-06-23/2ywqrm" \
    && echo "  ✓ OK (резервный)" \
    || echo "  ✗ Оба URL недоступны — запросить напрямую: syensqo.com/en/brands/tiguar"
fi

# ── ASHLAND ───────────────────────────────────────────────────────
dl "Ashland_Natrosol250_HEC_TDS.pdf" \
   "https://www.dkshdiscover.com/medias/TDS-Natrosol-250-HHR-Ashland.pdf?context=bWFzdGVyfGJhY2tvZmZpY2VleGNlbGltcG9ydHwxMzMwMjR8YXBwbGljYXRpb24vcGRmfGgxOS9oOTQvODgwMzc4OTk0NDA5NC5wZGZ8OWE2MDM5OWEyNWMzZGM4ZTA3MGM2MDhiYWYwNjMzMzUzZjNlYWNjMzIxN2Y1N2VjZGFjNWFhY2RhOTk0OTc5Mg" \
   "Natrosol 250 HEC — TDS (через DKSH)"

# ── CHAMPIONX ─────────────────────────────────────────────────────
dl "ChampionX_Combos_SICI_Brochure.pdf" \
   "https://www.championx.com/middle-east-tradeshow-interactive/chemical-technologies-interactive/chemical-solutions/scale-inhibitor-corrosion-inhibitor-iron-sulfide-dissolver-brochure/ChampionX-Scale-Corrosion-FeS-Brochure-FINAL.pdf" \
   "ChampionX Scale+Corrosion+FeS Inhibitor Combo (SICI-серия) — Brochure"

dl "ChampionX_Trifecta_FactSheet.pdf" \
   "https://www.championx.com/contents/Trifecta%20Fact%20Sheet_v2.pdf" \
   "ChampionX Trifecta Triple Combination — Fact Sheet"

dl "ChampionX_SICI12589A_CaseStudy.pdf" \
   "https://www.championx.com/contents/CH-0425_SICI12589A.pdf" \
   "ChampionX SICI12589A — Case Study (North Sea Beryl)"

# ── KEMIRA ────────────────────────────────────────────────────────
# KemFlow A-4251 — только пресс-релиз, TDS по запросу
echo "▶ Kemira_KemFlow_A4251 — TDS по запросу у Kemira (oilfield@kemira.com)"
echo "  Источник: https://www.kemira.com/company/media/newsroom/news/kemflow-friction-reducer-improves-hydraulic-fracturing/"

echo ""
echo "════════════════════════════════════════"
printf " ✓ Скачано: %d   ✗ Ошибок: %d\n" $OK $FAIL
echo " Папка: $(pwd)"
echo "════════════════════════════════════════"
ls -lh
