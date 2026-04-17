#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# Скачивание TDS/SDS/брошюр для реагентов ГРП
# Регионы: Россия · США · Китай (open-access PDFs)
# Запуск: chmod +x download_tds.sh && ./download_tds.sh
# ─────────────────────────────────────────────────────────
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
mkdir -p tds_files && cd tds_files
OK=0; FAIL=0

echo "▶ RU_Mirrico_Catalog_GRP_reagents.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Mirrico_Catalog_GRP_reagents.pdf" \
  "https://mirrico.ru/upload/iblock/1c7/71vj6fwwutph0tknznjpqm5hb1e1o1e2/f9p0xpm6qmnzs51fdqbajhuj17kq0dq9.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Mirrico_Catalog_Production.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Mirrico_Catalog_Production.pdf" \
  "https://mirrico.ru/upload/uf/f06/f06a99e6c474169798386cdc6ea2a550.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Mirrico_Catalog_Production2.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Mirrico_Catalog_Production2.pdf" \
  "https://mirrico.ru/upload/iblock/11a/y6lhombxq8fq0ijh871ukd5hfc2pc7xn/qbtce9looq8sfvx3995s40w68qrupybu.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Mirrico_Catalog_Drilling.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Mirrico_Catalog_Drilling.pdf" \
  "https://mirrico.ru/upload/iblock/6e3/6e3b2212971b5ba464264eedc678c6a5.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Mirrico_WaterTreatment_SVS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Mirrico_WaterTreatment_SVS.pdf" \
  "https://mirrico.ru/upload/iblock/c92/43y2isxmk8bs6417vehnrpc4nxdqrn0y/Buklet_SVS.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Mirrico_VesFrac_Innovation.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Mirrico_VesFrac_Innovation.pdf" \
  "https://mirrico.ru/upload/uf/7b4/7b451917223891800040a6f762ef44e5.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Mirrico_Catalog_EN.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Mirrico_Catalog_EN.pdf" \
  "https://mirrico.ru/upload/uf/411/4113cb864583150a07396c373499d652.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Econotech_WG-50_TDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Econotech_WG-50_TDS.pdf" \
  "https://econotech.ru/upload/products/files/WG_50_PDS_agents_passport_44_17_9344.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Econotech_WGXL-8.1_TDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Econotech_WGXL-8.1_TDS.pdf" \
  "https://econotech.ru/upload/products/files/WGXL_8_1_PDS_agents_passport_50_18_2526.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Econotech_WGXL-8.2_TDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Econotech_WGXL-8.2_TDS.pdf" \
  "https://econotech.ru/upload/products/files/WGXL_8_2_PDS_agents_passport_51_18_4747.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Econotech_WGXL-9.1_TDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Econotech_WGXL-9.1_TDS.pdf" \
  "https://econotech.ru/upload/products/files/WGXL_9_1_PDS_agents_passport_52_18_4701.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ RU_Econotech_WCS-100_101_SDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "RU_Econotech_WCS-100_101_SDS.pdf" \
  "https://econotech.ru/upload/products/files/WCS_100__WCS_101_Pasport_Bezopasnosti_safety_certificate_66_53_2129.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_Halliburton_FightR_EC-1_SDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_Halliburton_FightR_EC-1_SDS.pdf" \
  "https://dam.assets.ohio.gov/image/upload/ohiodnr.gov/documents/oil-gas/msds/FightR%20EC-1_Halliburton_SDS.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_Halliburton_FightR_EC-17_SDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_Halliburton_FightR_EC-17_SDS.pdf" \
  "https://www.rangeresources.com/wp-content/uploads/2024/12/Friction-Reducer-FDP-S1463-22-Halliburton-1.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_BakerHughes_Lightning_FracFluid_Spec.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_BakerHughes_Lightning_FracFluid_Spec.pdf" \
  "https://www.bakerhughes.com/sites/bakerhughes/files/2021-03/lightning-fracturing-fluid-system-spec.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_ChampionX_Combos_Brochure.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_ChampionX_Combos_Brochure.pdf" \
  "https://www.championx.com/contents/Combos%20Brochure_compressed.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_Syensqo_Tiguar_HPG_Brochure.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_Syensqo_Tiguar_HPG_Brochure.pdf" \
  "https://www.syensqo.com/sites/g/files/alwlxe161/files/tridion/documents/Tiguar-Brochure.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_Ashland_Natrosol250_HEC_TDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_Ashland_Natrosol250_HEC_TDS.pdf" \
  "https://www.dkshdiscover.com/medias/TDS-Natrosol-250-HHR-Ashland.pdf?context=bWFzdGVyfGJhY2tvZmZpY2VleGNlbGltcG9ydHwxMzMwMjR8YXBwbGljYXRpb24vcGRmfGgxOS9oOTQvODgwMzc4OTk0NDA5NC5wZGZ8OWE2MDM5OWEyNWMzZGM4ZTA3MGM2MDhiYWYwNjMzMzUzZjNlYWNjMzIxN2Y1N2VjZGFjNWFhY2RhOTk0OTc5Mg" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_SLB_J480_YF100HTD_SDS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_SLB_J480_YF100HTD_SDS.pdf" \
  "https://www.shell.com.au/content/dam/shell/assets/en/australia/documents/j480.pdf" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo "▶ USA_SLB_CrosslinkedBorateFluid_PS.pdf"
curl -L --silent --fail --max-time 30 \
  -H "User-Agent: $UA" \
  -o "USA_SLB_CrosslinkedBorateFluid_PS.pdf" \
  "https://www.slb.com/-/media/files/stimulation/product-sheet/crosslinked-borate-fluid-ps.ashx" \
  && { echo "  ✓ OK"; OK=$((OK+1)); } \
  || { echo "  ✗ FAIL"; FAIL=$((FAIL+1)); }
sleep 1

echo ""
echo "════════════════════════════════"
echo " Скачано: $OK  /  Ошибок: $FAIL"
echo " Папка:   $(pwd)"
echo "════════════════════════════════"
ls -lh
