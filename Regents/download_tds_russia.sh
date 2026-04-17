#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  download_tds_russia.sh
#  Скачивание TDS / SDS / каталогов для российских реагентов ГРП
#  Производители: ГК «Миррико» · ООО «ТД «ЭКОНО-ТЕХ» · АО «СНПХ»
#                 АО «Полиэкс» · АО «Буйский хим. завод»
#  Запуск: chmod +x download_tds_russia.sh && ./download_tds_russia.sh
# ════════════════════════════════════════════════════════════════

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DIR="tds_russia"
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
echo " РОССИЯ | Российские реагенты ГРП"
echo "════════════════════════════════════════"

# ── ГК «МИРРИКО» ──────────────────────────────────────────────────
dl "Mirrico_Catalog_GRP_ATREN_GUAMIN.pdf" \
   "https://mirrico.ru/upload/iblock/1c7/71vj6fwwutph0tknznjpqm5hb1e1o1e2/f9p0xpm6qmnzs51fdqbajhuj17kq0dq9.pdf" \
   "Миррико — Каталог реагентов ГРП (ATREN BCL/GB, ГУАМИН 7000-10000, деструкторы)"

dl "Mirrico_Catalog_Production_ATREN.pdf" \
   "https://mirrico.ru/upload/uf/f06/f06a99e6c474169798386cdc6ea2a550.pdf" \
   "Миррико — Каталог для добычи (ATREN-BIO A/P, ПАВ, деструкторы)"

dl "Mirrico_Catalog_Production2_Iron.pdf" \
   "https://mirrico.ru/upload/iblock/11a/y6lhombxq8fq0ijh871ukd5hfc2pc7xn/qbtce9looq8sfvx3995s40w68qrupybu.pdf" \
   "Миррико — Каталог для добычи расширенный (ATREN Iron, DESCUM 2D 3811 C)"

dl "Mirrico_Catalog_Drilling_ATREN-CS135.pdf" \
   "https://mirrico.ru/upload/iblock/6e3/6e3b2212971b5ba464264eedc678c6a5.pdf" \
   "Миррико — Реагенты для бурения (ATREN CS-135, PG — стабилизаторы глин)"

dl "Mirrico_VesFrac_FibrilFrac_Innovation.pdf" \
   "https://mirrico.ru/upload/uf/7b4/7b451917223891800040a6f762ef44e5.pdf" \
   "Миррико — VES-FRAC и ATREN FIBRIL FRAC (безгуаровые жидкости ГРП)"

dl "Mirrico_WaterTreatment_ATREN-BIO.pdf" \
   "https://mirrico.ru/upload/iblock/c92/43y2isxmk8bs6417vehnrpc4nxdqrn0y/Buklet_SVS.pdf" \
   "Миррико — Обработка воды (ATREN-BIO A/P, бактерициды)"

dl "Mirrico_Catalog_EN_OilRecovery.pdf" \
   "https://mirrico.ru/upload/uf/411/4113cb864583150a07396c373499d652.pdf" \
   "Миррико — Каталог на английском (ATREN / VES-FRAC EN)"

# ── ООО «ТД «ЭКОНО-ТЕХ» ──────────────────────────────────────────
dl "Econotech_WG-50_TDS.pdf" \
   "https://econotech.ru/upload/products/files/WG_50_PDS_agents_passport_44_17_9344.pdf" \
   "ЭКОНО-ТЕХ — TDS гелеобразователь WG-50 (гуар)"

dl "Econotech_WGXL-8.1_TDS.pdf" \
   "https://econotech.ru/upload/products/files/WGXL_8_1_PDS_agents_passport_50_18_2526.pdf" \
   "ЭКОНО-ТЕХ — TDS сшиватель WGXL-8.1 (боратный, T 10-60°C)"

dl "Econotech_WGXL-8.2_TDS.pdf" \
   "https://econotech.ru/upload/products/files/WGXL_8_2_PDS_agents_passport_51_18_4747.pdf" \
   "ЭКОНО-ТЕХ — TDS сшиватель WGXL-8.2 (мгновенного действия)"

dl "Econotech_WGXL-9.1_TDS.pdf" \
   "https://econotech.ru/upload/products/files/WGXL_9_1_PDS_agents_passport_52_18_4701.pdf" \
   "ЭКОНО-ТЕХ — TDS сшиватель WGXL-9.1 (водная основа)"

dl "Econotech_WCS-100_101_SDS.pdf" \
   "https://econotech.ru/upload/products/files/WCS_100__WCS_101_Pasport_Bezopasnosti_safety_certificate_66_53_2129.pdf" \
   "ЭКОНО-ТЕХ — Паспорт безопасности стабилизаторов глин WCS-100/101 (ТУ 2499-005-78216681-2013)"

dl "Econotech_SG-HT_SDS.pdf" \
   "https://econotech.ru/upload/products/files/SG_HT_MSDS_safety_certificate_68_54_6396.pdf" \
   "ЭКОНО-ТЕХ — SDS высокотемпературный стабилизатор геля SG-HT"

# ── АО «СНПХ» ─────────────────────────────────────────────────────
# TDS только по запросу; фиксируем страницы-источники
echo "▶ СНПХ-5311..5340 — TDS по запросу"
echo "  Страница: https://snph.ru/ingibitory-soleobrazovaniya/"
echo "  Контакт:  snph@snph.ru | +7 (843) 274-00-73"

# ── АО «ПОЛИЭКС» ──────────────────────────────────────────────────
echo "▶ Полиэкс Гелекс / Литекс — TDS по запросу"
echo "  Страница: http://polyex-izh.ru/catalog/"
echo "  Контакт:  info@polyex-izh.ru"

# ── АО «БУЙСКИЙ ХИМ. ЗАВОД» ──────────────────────────────────────
echo "▶ Калий метаборат (БХЗ) — ТУ/TDS по запросу"
echo "  Страница: https://bhz.ru/catalog/dlya-promyshlennosti/kaliy-metaborat-1/"
echo "  Контакт:  info@bhz.ru"

echo ""
echo "════════════════════════════════════════"
printf " ✓ Скачано: %d   ✗ Ошибок: %d\n" $OK $FAIL
echo " Папка: $(pwd)"
echo "════════════════════════════════════════"
ls -lh
