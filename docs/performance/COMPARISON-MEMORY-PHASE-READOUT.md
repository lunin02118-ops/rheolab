# Comparison Memory Phase Readout

**Generated:** 2026-05-02T18:24:13.822Z.

Diagnostic comparison-smoke memory run summary. These runs use direct Win32
RSS sampling and CDP GC hints, so use them for memory phase diagnosis, not
for user-facing latency budgets.

- N: 5
- Runs: 3
- Modes: tauri-debug-mocked
- Export save modes: direct
- Source sidecars:
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777745356682-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777745667850-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777745975756-tauri.json`

## Phase RSS

| Phase | Total p50 | Total p95 | Renderer p50 | Renderer p95 | GPU p50 | GPU p95 | Tauri p50 | Tauri p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| app_start | 421.58 MB | 427.38 MB | 87.54 MB | 89.63 MB | 114.36 MB | 117.74 MB | 57.11 MB | 57.25 MB |
| before_setup | 418.55 MB | 424.34 MB | 87.57 MB | 89.66 MB | 113.96 MB | 117.37 MB | 57.11 MB | 57.25 MB |
| before_fixture_1_dashboard_goto | 418.77 MB | 424.48 MB | 87.59 MB | 89.68 MB | 113.93 MB | 117.30 MB | 57.11 MB | 57.25 MB |
| after_fixture_1_dashboard_goto | 418.50 MB | 424.26 MB | 87.62 MB | 89.71 MB | 113.91 MB | 117.28 MB | 57.11 MB | 57.25 MB |
| before_fixture_1_upload | 418.60 MB | 424.39 MB | 87.65 MB | 89.76 MB | 113.91 MB | 117.28 MB | 57.08 MB | 57.23 MB |
| after_fixture_1_upload | 454.18 MB | 456.99 MB | 103.75 MB | 106.10 MB | 127.58 MB | 127.70 MB | 62.11 MB | 62.62 MB |
| before_fixture_1_parse_wait | 453.22 MB | 457.29 MB | 103.55 MB | 106.40 MB | 126.58 MB | 127.50 MB | 62.11 MB | 62.62 MB |
| after_fixture_1_parse | 451.43 MB | 455.78 MB | 102.68 MB | 105.55 MB | 125.93 MB | 127.09 MB | 62.11 MB | 62.62 MB |
| before_fixture_1_save_dialog | 452.11 MB | 456.46 MB | 103.05 MB | 105.92 MB | 125.95 MB | 127.11 MB | 62.11 MB | 62.62 MB |
| after_fixture_1_save_dialog_open | 482.88 MB | 491.47 MB | 125.39 MB | 127.76 MB | 130.07 MB | 141.32 MB | 62.19 MB | 62.69 MB |
| before_fixture_1_save_commit | 507 MB | 516.84 MB | 145.55 MB | 146.67 MB | 130.20 MB | 141.44 MB | 62 MB | 62.50 MB |
| after_fixture_1_save_persist | 510.80 MB | 519.73 MB | 146.53 MB | 148.72 MB | 131.09 MB | 142.29 MB | 62.65 MB | 63.04 MB |
| after_fixture_1_save | 508.47 MB | 516.26 MB | 143.90 MB | 146.92 MB | 130.57 MB | 141.74 MB | 62.66 MB | 63.04 MB |
| after_fixture_1_post_save_settle | 491.02 MB | 491.96 MB | 118.68 MB | 140.02 MB | 130.59 MB | 141.66 MB | 62.66 MB | 63.04 MB |
| after_fixture_1_cleanup | 470.30 MB | 485.74 MB | 117.46 MB | 118.46 MB | 122.41 MB | 140.54 MB | 62.66 MB | 63.04 MB |
| before_fixture_2_dashboard_goto | 470.55 MB | 474.41 MB | 114.87 MB | 117.38 MB | 122.37 MB | 128.92 MB | 62.66 MB | 63.04 MB |
| after_fixture_2_dashboard_goto | 464.88 MB | 473.83 MB | 115.07 MB | 117.52 MB | 120.09 MB | 128.66 MB | 62.66 MB | 63.05 MB |
| before_fixture_2_upload | 464.97 MB | 474.12 MB | 115.28 MB | 117.70 MB | 120.06 MB | 128.69 MB | 62.66 MB | 63.05 MB |
| after_fixture_2_upload | 497.32 MB | 498 MB | 127.76 MB | 130.23 MB | 135.12 MB | 139.20 MB | 63.79 MB | 64.22 MB |
| before_fixture_2_parse_wait | 496.23 MB | 497.30 MB | 126.54 MB | 129.65 MB | 134.45 MB | 138.92 MB | 63.79 MB | 64.22 MB |
| after_fixture_2_parse | 493.57 MB | 495.42 MB | 125.48 MB | 127.63 MB | 134.02 MB | 138.49 MB | 63.79 MB | 64.22 MB |
| before_fixture_2_save_dialog | 493.73 MB | 495.55 MB | 125.59 MB | 127.70 MB | 134.03 MB | 138.37 MB | 63.79 MB | 64.22 MB |
| after_fixture_2_save_dialog_open | 504.71 MB | 519.62 MB | 135.35 MB | 135.47 MB | 140.12 MB | 152.64 MB | 63.80 MB | 64.23 MB |
| before_fixture_2_save_commit | 519.05 MB | 537.20 MB | 147.11 MB | 151.22 MB | 140.60 MB | 152.94 MB | 63.73 MB | 64.20 MB |
| after_fixture_2_save_persist | 524.99 MB | 541.96 MB | 151.50 MB | 155.82 MB | 140.95 MB | 152.84 MB | 64.55 MB | 64.90 MB |
| after_fixture_2_save | 522.18 MB | 540.22 MB | 149.47 MB | 154.02 MB | 140.20 MB | 152.85 MB | 64.51 MB | 64.85 MB |
| after_fixture_2_post_save_settle | 521.87 MB | 538.83 MB | 148.77 MB | 152.88 MB | 140.09 MB | 152.38 MB | 64.51 MB | 64.85 MB |
| after_fixture_2_cleanup | 502.46 MB | 507.47 MB | 122.14 MB | 143.70 MB | 123.69 MB | 149.04 MB | 64.51 MB | 64.85 MB |
| before_fixture_3_dashboard_goto | 501.94 MB | 514.17 MB | 121.67 MB | 143.18 MB | 123.60 MB | 156.46 MB | 64.51 MB | 64.86 MB |
| after_fixture_3_dashboard_goto | 499.91 MB | 511.21 MB | 120.64 MB | 141.36 MB | 123.60 MB | 154.52 MB | 64.50 MB | 64.85 MB |
| before_fixture_3_upload | 500.34 MB | 505.04 MB | 120.91 MB | 141.66 MB | 123.61 MB | 148.17 MB | 64.50 MB | 64.85 MB |
| after_fixture_3_upload | 521.34 MB | 524.62 MB | 130.97 MB | 152.70 MB | 133.85 MB | 153.81 MB | 65.79 MB | 66.56 MB |
| before_fixture_3_parse_wait | 520.29 MB | 520.66 MB | 130.80 MB | 149.51 MB | 132.58 MB | 153.13 MB | 65.79 MB | 66.56 MB |
| after_fixture_3_parse | 518.39 MB | 518.46 MB | 129.43 MB | 149.89 MB | 131.67 MB | 152.32 MB | 65.79 MB | 66.56 MB |
| before_fixture_3_save_dialog | 515.86 MB | 517.47 MB | 129.61 MB | 149.36 MB | 131.56 MB | 149.71 MB | 65.79 MB | 66.56 MB |
| after_fixture_3_save_dialog_open | 522.19 MB | 553.64 MB | 131.94 MB | 151.68 MB | 133.52 MB | 185.32 MB | 65.79 MB | 66.56 MB |
| before_fixture_3_save_commit | 513.29 MB | 554.77 MB | 132.44 MB | 145.01 MB | 132.47 MB | 186.84 MB | 65.64 MB | 66.41 MB |
| after_fixture_3_save_persist | 514.85 MB | 561.26 MB | 136 MB | 147.34 MB | 132.65 MB | 189.42 MB | 65.56 MB | 65.73 MB |
| after_fixture_3_save | 512.59 MB | 557.52 MB | 133.11 MB | 145.34 MB | 132.41 MB | 188.58 MB | 65.56 MB | 65.73 MB |
| after_fixture_3_post_save_settle | 512.53 MB | 545.18 MB | 133.85 MB | 145.36 MB | 132.36 MB | 175.49 MB | 65.56 MB | 65.73 MB |
| after_fixture_3_cleanup | 512 MB | 543.71 MB | 133.01 MB | 145.15 MB | 132.04 MB | 174.91 MB | 65.56 MB | 65.73 MB |
| before_fixture_4_dashboard_goto | 493.73 MB | 533.01 MB | 128.11 MB | 133.56 MB | 132.07 MB | 164.92 MB | 65.56 MB | 65.73 MB |
| after_fixture_4_dashboard_goto | 491.37 MB | 516.34 MB | 125.89 MB | 132.48 MB | 132.05 MB | 149.43 MB | 65.56 MB | 65.73 MB |
| before_fixture_4_upload | 491.13 MB | 508.74 MB | 125.68 MB | 132.48 MB | 132.02 MB | 141.77 MB | 65.56 MB | 65.73 MB |
| after_fixture_4_upload | 523.91 MB | 539.11 MB | 145.89 MB | 147.16 MB | 141.43 MB | 156.70 MB | 65.76 MB | 66.47 MB |
| before_fixture_4_parse_wait | 517.09 MB | 536.78 MB | 143.12 MB | 145.75 MB | 140.19 MB | 155.99 MB | 65.76 MB | 66.47 MB |
| after_fixture_4_parse | 516.85 MB | 529.68 MB | 142.82 MB | 143.70 MB | 140.14 MB | 151.02 MB | 65.74 MB | 66.47 MB |
| before_fixture_4_save_dialog | 516.63 MB | 529.94 MB | 142.86 MB | 143.89 MB | 139.99 MB | 151.02 MB | 65.74 MB | 66.47 MB |
| after_fixture_4_save_dialog_open | 526.68 MB | 571.75 MB | 142.79 MB | 144.21 MB | 149.90 MB | 192.99 MB | 65.74 MB | 66.47 MB |
| before_fixture_4_save_commit | 523.80 MB | 574.21 MB | 141.80 MB | 145.16 MB | 149.08 MB | 194.51 MB | 65.56 MB | 66.29 MB |
| after_fixture_4_save_persist | 528.86 MB | 576.05 MB | 143.85 MB | 145.09 MB | 148.99 MB | 196.67 MB | 66.35 MB | 66.40 MB |
| after_fixture_4_save | 526.39 MB | 575.75 MB | 143.19 MB | 143.96 MB | 148.70 MB | 196.32 MB | 66.35 MB | 66.40 MB |
| after_fixture_4_post_save_settle | 525.69 MB | 573.40 MB | 142.45 MB | 143.01 MB | 148.64 MB | 195.14 MB | 66.35 MB | 66.40 MB |
| after_fixture_4_cleanup | 525.59 MB | 573.06 MB | 142.49 MB | 143.01 MB | 148.36 MB | 194.70 MB | 66.35 MB | 66.40 MB |
| before_fixture_5_dashboard_goto | 525.72 MB | 548.60 MB | 142.50 MB | 143 MB | 148.38 MB | 169.98 MB | 66.34 MB | 66.39 MB |
| after_fixture_5_dashboard_goto | 509.60 MB | 522.60 MB | 142.49 MB | 143 MB | 132.37 MB | 143.91 MB | 66.34 MB | 66.39 MB |
| before_fixture_5_upload | 507.60 MB | 522.37 MB | 140.39 MB | 142.89 MB | 132.37 MB | 143.85 MB | 66.34 MB | 66.39 MB |
| after_fixture_5_upload | 526.45 MB | 548.10 MB | 143.71 MB | 146.45 MB | 146.71 MB | 163.07 MB | 66.68 MB | 66.93 MB |
| before_fixture_5_parse_wait | 525 MB | 541.64 MB | 143.22 MB | 143.61 MB | 145.66 MB | 161.81 MB | 66.68 MB | 66.93 MB |
| after_fixture_5_parse | 521.39 MB | 541.41 MB | 141.03 MB | 143.41 MB | 145.36 MB | 161.79 MB | 66.68 MB | 66.93 MB |
| before_fixture_5_save_dialog | 512.08 MB | 526.84 MB | 131.77 MB | 134.53 MB | 145.31 MB | 156.21 MB | 66.67 MB | 66.93 MB |
| after_fixture_5_save_dialog_open | 570.01 MB | 589.17 MB | 133.20 MB | 137.31 MB | 201.91 MB | 215.62 MB | 66.67 MB | 66.94 MB |
| before_fixture_5_save_commit | 570.19 MB | 585.95 MB | 133.18 MB | 135.40 MB | 201.87 MB | 214.60 MB | 66.52 MB | 66.79 MB |
| after_fixture_5_save_persist | 566.72 MB | 586.12 MB | 131.45 MB | 135.19 MB | 201.04 MB | 215.59 MB | 65.90 MB | 66.11 MB |
| after_fixture_5_save | 566.24 MB | 582.30 MB | 130.89 MB | 132.21 MB | 201.02 MB | 214.84 MB | 65.90 MB | 66.11 MB |
| after_fixture_5_post_save_settle | 551.67 MB | 576.50 MB | 129.76 MB | 132.05 MB | 187.70 MB | 209.15 MB | 65.90 MB | 66.11 MB |
| after_fixture_5_cleanup | 523.26 MB | 570.45 MB | 129.82 MB | 131.94 MB | 159.14 MB | 203.28 MB | 65.90 MB | 66.11 MB |
| after_setup | 523.07 MB | 545.49 MB | 129.72 MB | 131.92 MB | 159.14 MB | 178.26 MB | 65.90 MB | 66.11 MB |
| before_comparison_open | 505.92 MB | 511.55 MB | 128.90 MB | 130.40 MB | 142.71 MB | 145.91 MB | 65.90 MB | 66.11 MB |
| after_comparison_open | 508.57 MB | 531.96 MB | 130.52 MB | 132.55 MB | 142.86 MB | 162.35 MB | 66.23 MB | 66.47 MB |
| before_add_1 | 508.48 MB | 530.28 MB | 130.46 MB | 132.44 MB | 142.71 MB | 161.61 MB | 66.23 MB | 66.47 MB |
| after_add_1_selector_open | 506.43 MB | 529.74 MB | 128.46 MB | 131.44 MB | 143.10 MB | 161.76 MB | 66.40 MB | 66.64 MB |
| after_add_1_selector_search | 506.38 MB | 526.07 MB | 127.64 MB | 128.45 MB | 143.14 MB | 161.15 MB | 66.45 MB | 66.69 MB |
| after_add_1_click | 516.01 MB | 537.18 MB | 126.80 MB | 129.85 MB | 151.84 MB | 169.07 MB | 67.17 MB | 67.29 MB |
| after_add_1_store_update | 514.13 MB | 534.98 MB | 125.95 MB | 129.73 MB | 150.81 MB | 168.10 MB | 67.17 MB | 67.29 MB |
| after_add_1_series_ready | 510.56 MB | 534.73 MB | 125.98 MB | 129.75 MB | 148.31 MB | 167.85 MB | 67.17 MB | 67.29 MB |
| after_add_1_dom_settle | 510.38 MB | 530.63 MB | 125.98 MB | 127.73 MB | 148.23 MB | 165.90 MB | 67.17 MB | 67.29 MB |
| after_add_1 | 510.48 MB | 529.95 MB | 125.98 MB | 127.73 MB | 148.23 MB | 165.11 MB | 67.17 MB | 67.29 MB |
| before_add_2 | 510.42 MB | 529.80 MB | 125.98 MB | 127.73 MB | 148.23 MB | 165.11 MB | 67.11 MB | 67.23 MB |
| after_add_2_selector_open | 510.07 MB | 530.55 MB | 125.23 MB | 126.87 MB | 148.55 MB | 166.54 MB | 67.16 MB | 67.29 MB |
| after_add_2_selector_search | 507.57 MB | 528.77 MB | 125.50 MB | 126.45 MB | 145.91 MB | 165.29 MB | 67.16 MB | 67.29 MB |
| after_add_2_click | 515.10 MB | 540.17 MB | 128.29 MB | 130.22 MB | 147.34 MB | 169.39 MB | 68.17 MB | 68.41 MB |
| after_add_2_store_update | 510.18 MB | 535.96 MB | 127.34 MB | 130.10 MB | 145.81 MB | 167.69 MB | 68.17 MB | 68.41 MB |
| after_add_2_series_ready | 510.32 MB | 536.10 MB | 127.34 MB | 130.14 MB | 145.81 MB | 167.69 MB | 68.17 MB | 68.41 MB |
| after_add_2_dom_settle | 510.20 MB | 535.89 MB | 127.34 MB | 130.14 MB | 145.80 MB | 167.58 MB | 68.17 MB | 68.41 MB |
| after_add_2 | 510.29 MB | 533.16 MB | 127.34 MB | 130.14 MB | 145.80 MB | 164.76 MB | 68.17 MB | 68.41 MB |
| before_add_3 | 510.15 MB | 533.01 MB | 127.34 MB | 130.14 MB | 145.80 MB | 164.76 MB | 68.11 MB | 68.35 MB |
| after_add_3_selector_open | 510.01 MB | 532.21 MB | 126.75 MB | 128.85 MB | 146.08 MB | 165.09 MB | 68.17 MB | 68.41 MB |
| after_add_3_selector_search | 509.45 MB | 531.64 MB | 126.46 MB | 128.67 MB | 145.91 MB | 164.77 MB | 68.18 MB | 68.41 MB |
| after_add_3_click | 530.56 MB | 546.27 MB | 128.86 MB | 131.93 MB | 161.91 MB | 175.53 MB | 68.77 MB | 68.80 MB |
| after_add_3_store_update | 526.42 MB | 544.90 MB | 128.85 MB | 131.23 MB | 160.33 MB | 175.04 MB | 68.77 MB | 68.80 MB |
| after_add_3_series_ready | 525.99 MB | 544.57 MB | 128.91 MB | 131.32 MB | 159.75 MB | 174.69 MB | 68.77 MB | 68.80 MB |
| after_add_3_dom_settle | 525.67 MB | 544.64 MB | 128.91 MB | 131.34 MB | 159.74 MB | 174.69 MB | 68.77 MB | 68.80 MB |
| after_add_3 | 525.78 MB | 544.41 MB | 128.91 MB | 131.37 MB | 159.74 MB | 174.69 MB | 68.71 MB | 68.79 MB |
| before_add_4 | 525.63 MB | 544.46 MB | 128.92 MB | 131.41 MB | 159.74 MB | 174.69 MB | 68.71 MB | 68.73 MB |
| after_add_4_selector_open | 524.19 MB | 543.56 MB | 127 MB | 130.20 MB | 160.02 MB | 175 MB | 68.77 MB | 68.80 MB |
| after_add_4_selector_search | 524.29 MB | 541.37 MB | 127.24 MB | 130.14 MB | 159.90 MB | 172.73 MB | 68.77 MB | 68.80 MB |
| after_add_4_click | 527.87 MB | 544.32 MB | 130.03 MB | 132.01 MB | 160.37 MB | 173.66 MB | 68.96 MB | 68.96 MB |
| after_add_4_store_update | 527.72 MB | 544.14 MB | 130.09 MB | 132.03 MB | 160.07 MB | 173.37 MB | 68.96 MB | 68.96 MB |
| after_add_4_series_ready | 527.12 MB | 543.94 MB | 130.11 MB | 132.10 MB | 159.54 MB | 173.19 MB | 68.96 MB | 68.96 MB |
| after_add_4_dom_settle | 527.21 MB | 544.04 MB | 130.11 MB | 132.11 MB | 159.54 MB | 173.19 MB | 68.96 MB | 68.96 MB |
| after_add_4 | 527.15 MB | 543.89 MB | 130.12 MB | 132.12 MB | 159.54 MB | 173.12 MB | 68.90 MB | 68.95 MB |
| before_add_5 | 527.19 MB | 543.95 MB | 130.12 MB | 132.13 MB | 159.54 MB | 173.12 MB | 68.90 MB | 68.90 MB |
| after_add_5_selector_open | 526.02 MB | 542.02 MB | 128.66 MB | 130.07 MB | 159.86 MB | 173.42 MB | 68.96 MB | 68.96 MB |
| after_add_5_selector_search | 526.64 MB | 542.19 MB | 128.91 MB | 130.27 MB | 160.07 MB | 173.40 MB | 68.96 MB | 68.96 MB |
| after_add_5_click | 620.09 MB | 622.41 MB | 132.71 MB | 134.54 MB | 247.01 MB | 249.63 MB | 68.96 MB | 69.19 MB |
| after_add_5_store_update | 618.60 MB | 619.10 MB | 131.74 MB | 133.57 MB | 246.62 MB | 249.04 MB | 68.96 MB | 69.19 MB |
| after_add_5_series_ready | 617.75 MB | 617.76 MB | 131.75 MB | 133.59 MB | 245.11 MB | 248.20 MB | 68.96 MB | 69.19 MB |
| after_add_5_dom_settle | 617.67 MB | 617.69 MB | 131.77 MB | 133.59 MB | 245.11 MB | 248.20 MB | 68.96 MB | 69.19 MB |
| after_add_5 | 617.54 MB | 617.68 MB | 131.77 MB | 133.59 MB | 245.11 MB | 248.20 MB | 68.90 MB | 69.19 MB |
| after_chart_canvas_painted | 624.52 MB | 624.87 MB | 136.18 MB | 137.98 MB | 247.79 MB | 250.93 MB | 68.90 MB | 69.13 MB |
| after_chart_visible | 623.15 MB | 624.19 MB | 136.19 MB | 137.98 MB | 247.48 MB | 249.38 MB | 68.90 MB | 69.13 MB |
| after_chart_ready | 609.32 MB | 621.77 MB | 136.19 MB | 138 MB | 232.51 MB | 247.88 MB | 68.90 MB | 69.13 MB |
| before_report_tab | 609.45 MB | 610.58 MB | 136.21 MB | 138.03 MB | 232.51 MB | 236.67 MB | 68.90 MB | 69.13 MB |
| after_report_tab_open | 620.16 MB | 620.37 MB | 137.41 MB | 140.07 MB | 242.11 MB | 245.35 MB | 67.93 MB | 68.17 MB |
| before_pdf | 619.02 MB | 620.07 MB | 137.47 MB | 139.29 MB | 241.75 MB | 245 MB | 67.93 MB | 68.17 MB |
| after_pdf | 612.72 MB | 615.53 MB | 135.14 MB | 137.88 MB | 236.29 MB | 242.20 MB | 68.51 MB | 68.74 MB |
| before_xlsx | 607.24 MB | 614.77 MB | 135.11 MB | 137.85 MB | 230.75 MB | 241.39 MB | 68.51 MB | 68.74 MB |
| after_xlsx | 605.20 MB | 606.82 MB | 134.20 MB | 137.91 MB | 230.39 MB | 241.15 MB | 68.52 MB | 68.76 MB |
| after_gc_hint | 593.76 MB | 599.35 MB | 122.34 MB | 126.36 MB | 228.63 MB | 238.61 MB | 68.46 MB | 68.67 MB |
| after_export_gc_hint | 593.32 MB | 598.91 MB | 122.38 MB | 126.39 MB | 228.25 MB | 238.22 MB | 68.42 MB | 68.66 MB |
| before_route_leave | 593.44 MB | 599 MB | 122.41 MB | 126.42 MB | 228.25 MB | 238.22 MB | 68.42 MB | 68.64 MB |
| after_comparison_store_clear | 591.38 MB | 597.29 MB | 120.62 MB | 124.35 MB | 228.33 MB | 238.49 MB | 68.41 MB | 68.60 MB |
| after_route_leave | 598.71 MB | 608.12 MB | 124.89 MB | 128.69 MB | 229.37 MB | 243.28 MB | 69.08 MB | 69.25 MB |
| after_chart_unmount_settle | 595.10 MB | 603.59 MB | 123.04 MB | 127.14 MB | 228.59 MB | 241.87 MB | 69.05 MB | 69.25 MB |
| after_second_gc_hint | 545.05 MB | 590.97 MB | 120.37 MB | 124.61 MB | 180.95 MB | 231.80 MB | 69.05 MB | 69.25 MB |

## App-Owned Renderer Stats

| Phase | JS heap p50 | Series cache p50 | Rust series entries p50 | Rust series cache p50 | Rust series hits p50 | Rust series misses p50 | Cmp raw p50 | Cmp columnar p50 | Parse cache entries p50 | Parse cache points p50 | DOM nodes p50 | Canvas count p50 | Canvas pixels p50 | uPlot count p50 | Cmp page root p50 | Cmp chart root p50 | Cmp chart uPlot p50 | Cmp chart canvas p50 | Cmp report root p50 | Dash chart root p50 | Dash chart uPlot p50 | Dash chart canvas p50 | uPlot init total p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| app_start | 8 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_setup | 8.06 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_1_dashboard_goto | 8.09 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_fixture_1_dashboard_goto | 8.12 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_1_upload | 8.16 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_fixture_1_upload | 10.34 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 143 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_1_parse_wait | 11.46 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_parse | 11.60 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_1_save_dialog | 11.63 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_save_dialog_open | 12.61 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 595 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_1_save_commit | 16.51 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 600 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_save_persist | 15.81 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 386 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_save | 15.94 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_post_save_settle | 16 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_cleanup | 9.90 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_2_dashboard_goto | 9.95 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_2_dashboard_goto | 9.93 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_2_upload | 9.96 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_2_upload | 16 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_2_parse_wait | 11.87 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_2_parse | 11.98 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| before_fixture_2_save_dialog | 12.01 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_2_save_dialog_open | 17.82 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 724 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| before_fixture_2_save_commit | 17.36 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 726 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_2_save_persist | 24.56 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 512 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_2_save | 24.69 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_2_post_save_settle | 24.73 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_2_cleanup | 24.76 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| before_fixture_3_dashboard_goto | 10.86 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_3_dashboard_goto | 10.83 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| before_fixture_3_upload | 10.87 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_3_upload | 18.42 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_3_parse_wait | 13.57 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_3_parse | 13.69 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| before_fixture_3_save_dialog | 13.72 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_3_save_dialog_open | 11.99 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 823 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| before_fixture_3_save_commit | 12.43 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 824 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_3_save_persist | 12.69 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 680 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_3_save | 12.28 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_3_post_save_settle | 12.31 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_3_cleanup | 12.35 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| before_fixture_4_dashboard_goto | 12.38 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_4_dashboard_goto | 11.38 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| before_fixture_4_upload | 11.41 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms |
| after_fixture_4_upload | 11.88 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_4_parse_wait | 19.39 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_4_parse | 19.49 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| before_fixture_4_save_dialog | 19.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_4_save_dialog_open | 15.06 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 529 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| before_fixture_4_save_commit | 15.22 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 530 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_4_save_persist | 14.65 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 386 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_4_save | 14.75 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_4_post_save_settle | 14.78 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_4_cleanup | 14.81 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| before_fixture_5_dashboard_goto | 14.85 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_5_dashboard_goto | 14.88 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| before_fixture_5_upload | 13.76 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms |
| after_fixture_5_upload | 20.22 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_5_parse_wait | 14.42 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_parse | 14.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| before_fixture_5_save_dialog | 14.55 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_save_dialog_open | 13.85 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 592 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| before_fixture_5_save_commit | 13.23 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 593 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_save_persist | 13.61 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 449 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_save | 13.73 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_post_save_settle | 13.76 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_cleanup | 13.79 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_setup | 13.82 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| before_comparison_open | 13.85 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_comparison_open | 11.24 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 206 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_add_1 | 11.35 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 206 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_selector_open | 11.10 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 281 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_selector_search | 11.15 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 237 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_click | 11.46 MB | 0 B | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 215 | 0 | 0 B | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_store_update | 11.97 MB | 32.56 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_1_series_ready | 11.91 MB | 32.56 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_1_dom_settle | 11.94 MB | 32.56 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_1 | 11.97 MB | 32.56 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| before_add_2 | 12.01 MB | 32.56 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_2_selector_open | 11.82 MB | 32.56 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 278 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_2_selector_search | 11.99 MB | 32.56 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 278 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_2_click | 12.11 MB | 32.56 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 251 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_2_store_update | 13.34 MB | 109.88 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_2_series_ready | 13.24 MB | 109.88 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_2_dom_settle | 13.27 MB | 109.88 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_2 | 13.30 MB | 109.88 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| before_add_3 | 13.34 MB | 109.88 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_3_selector_open | 13.04 MB | 109.88 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 292 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_3_selector_search | 13.21 MB | 109.88 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 292 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_3_click | 12.75 MB | 109.88 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 265 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_3_store_update | 13.44 MB | 186.06 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_3_series_ready | 13.42 MB | 186.06 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_3_dom_settle | 13.45 MB | 186.06 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_3 | 13.48 MB | 186.06 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| before_add_4 | 13.51 MB | 186.06 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_4_selector_open | 13.78 MB | 186.06 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 306 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_4_selector_search | 13.96 MB | 186.06 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 306 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_4_click | 14.21 MB | 186.06 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 279 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_4_store_update | 14.47 MB | 234.94 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_4_series_ready | 14.54 MB | 234.94 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_4_dom_settle | 14.57 MB | 234.94 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_4 | 14.60 MB | 234.94 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| before_add_5 | 14.63 MB | 234.94 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_5_selector_open | 14.85 MB | 234.94 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 320 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_5_selector_search | 15.03 MB | 234.94 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 320 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_5_click | 14.72 MB | 234.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 293 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_5_store_update | 15.71 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_5_series_ready | 15.66 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_5_dom_settle | 15.69 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_add_5 | 15.72 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_chart_canvas_painted | 17.84 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_chart_visible | 17.88 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_chart_ready | 17.92 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| before_report_tab | 17.95 MB | 295.94 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms |
| after_report_tab_open | 19.56 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 272 | 0 | 0 B | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | n/a |
| before_pdf | 17.43 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms |
| after_pdf | 15.40 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms |
| before_xlsx | 15.44 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms |
| after_xlsx | 15.61 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms |
| after_gc_hint | 11.45 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms |
| after_export_gc_hint | 11.50 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms |
| before_route_leave | 11.53 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms |
| after_comparison_store_clear | 11.64 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 215 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | n/a |
| after_route_leave | 11.89 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 307 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms |
| after_chart_unmount_settle | 12.27 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 453 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms |
| after_second_gc_hint | 11.14 MB | 591.88 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 453 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms |

## P50 Deltas

| Delta | Total | Renderer | GPU | Tauri |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup -> after_add_5 | 94.28 MB | 1.95 MB | 85.97 MB | 3 MB |
| after_add_5 -> after_chart_canvas_painted | 6.98 MB | 4.41 MB | 2.68 MB | 0 MB |
| after_xlsx - after_export_gc_hint | 11.88 MB | 11.82 MB | 2.14 MB | 0.10 MB |
| after_export_gc_hint - after_route_leave | -5.39 MB | -2.51 MB | -1.12 MB | -0.66 MB |
| after_route_leave - after_chart_visible | -24.44 MB | -11.30 MB | -18.11 MB | 0.18 MB |

## Readout

- `after_xlsx - after_export_gc_hint` estimates reclaimable post-export RSS
  after product-side buffer cleanup plus a diagnostic GC hint.
- `after_export_gc_hint - after_route_leave` shows whether navigation releases
  additional app-controlled state. Near-zero renderer deltas here suggest the
  remaining RSS is mostly WebView2/runtime retention.
- `after_route_leave - after_chart_visible` should not be interpreted as a
  leak by itself; WebView2/GPU memory may shift across phases and processes.

