#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  download_tds_china.sh
#  Скачивание TDS / каталогов для китайских реагентов ГРП
#  Производители: CNPC / Sinopec · UNP International · Sinofloc
#                 Shandong IRO · TC Chemicals · Sichuan Energy
#  Запуск: chmod +x download_tds_china.sh && ./download_tds_china.sh
# ════════════════════════════════════════════════════════════════

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DIR="tds_china"
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
echo " КИТАЙ | Китайские реагенты ГРП"
echo "════════════════════════════════════════"

# ── CNPC (публичные отраслевые PDF) ───────────────────────────────
dl "CNPC_FracFluid_SaltTolerant_FR_TDS.pdf" \
   "https://www.cnpcusa.com/en/Salt%20Tolerant%20Friction%20Reducer.pdf" \
   "CNPC — Salt Tolerant Friction Reducer TDS (понизитель трения, солестойкий)"

# ── UNP INTERNATIONAL ─────────────────────────────────────────────
# Прямых PDF нет; каталог на сайте + контакт для запроса
echo "▶ UNP — VESMET APA-T / EHS, BIMET 1227/210"
echo "  TDS по запросу: info@unpchemicals.com"
echo "  Каталог: https://www.unpchemicals.com/drilling-completion-fluid-additives.html"

# ── SHANDONG IRO POLYMER ──────────────────────────────────────────
dl "IRO_APAM_Oilfield_ProductPage.pdf" \
   "https://www.iropolymer.com/pdf/APAM-product-data.pdf" \
   "Shandong IRO — APAM Anionic Polyacrylamide TDS (понизитель трения/FR)"

# Резервный вариант — HTML страница (если PDF недоступен)
if [ ! -s "IRO_APAM_Oilfield_ProductPage.pdf" ]; then
  echo "  ↩ PDF недоступен. Страница-источник:"
  echo "    https://www.iropolymer.com/Oil/Anionic-Polyacrylamide-APAM.htm"
  echo "  Контакт: sales@iropolymer.com"
fi

# ── BEIJING SINOFLOC ──────────────────────────────────────────────
dl "Sinofloc_PAM_FrictionReducer_Brochure.pdf" \
   "https://www.sinofloc.com/d/file/news/2018-12-20/polyacrylamide-used-as-friction-reducer.pdf" \
   "Sinofloc — PAM as Friction Reducer Brochure"

if [ ! -s "Sinofloc_PAM_FrictionReducer_Brochure.pdf" ]; then
  echo "  ↩ PDF недоступен. Страница-источник:"
  echo "    https://www.sinofloc.com/news/sinofloc-polyacrylamide-used-as-friction-reducer.html"
  echo "  Контакт: info@sinofloc.com"
fi

# ── TC CHEMICALS (TAICHANG) ───────────────────────────────────────
# Органические сшиватели TNPZ / TNBZ / TIPT — только по запросу
echo "▶ TC Chemicals — TNPZ / TNBZ / TIPT (Ti/Zr органические сшиватели)"
echo "  TDS по запросу: https://www.tcchem.com.cn/contact"
echo "  Alibaba: https://taichangchemical.en.alibaba.com"

# ── SICHUAN ENERGY ────────────────────────────────────────────────
echo "▶ Sichuan Energy — VES2-12 (безгуаровая VES жидкость ГРП)"
echo "  Страница: https://scenergy.en.made-in-china.com/product/cTVYBzUOJQrI/"
echo "  TDS высылается поставщиком по запросу на made-in-china.com"

echo ""
echo "════════════════════════════════════════"
printf " ✓ Скачано: %d   ✗ Ошибок: %d\n" $OK $FAIL
echo " Папка: $(pwd)"
echo "════════════════════════════════════════"
ls -lh
