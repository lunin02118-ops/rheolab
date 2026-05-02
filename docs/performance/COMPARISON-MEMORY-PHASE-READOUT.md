# Comparison Memory Phase Readout

**Generated:** 2026-05-02T19:40:30.687Z.

Diagnostic comparison-smoke memory run summary. These runs use direct Win32
RSS sampling and CDP GC hints, so use them for memory phase diagnosis, not
for user-facing latency budgets.

- N: 5
- Runs: 3
- Modes: tauri-debug-mocked
- Export save modes: direct
- Source sidecars:
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777750030719-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777750299113-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777750564015-tauri.json`

## Phase RSS

| Phase | Total p50 | Total p95 | Renderer p50 | Renderer p95 | GPU p50 | GPU p95 | Tauri p50 | Tauri p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| app_start | 417.77 MB | 429.43 MB | 89.50 MB | 92.41 MB | 107.69 MB | 115.55 MB | 56.74 MB | 57.02 MB |
| before_setup | 417.83 MB | 426.80 MB | 89.56 MB | 92.42 MB | 107.69 MB | 114.59 MB | 56.74 MB | 57.02 MB |
| before_fixture_1_dashboard_goto | 415.65 MB | 426.77 MB | 89.59 MB | 92.44 MB | 107.25 MB | 114.55 MB | 56.74 MB | 57.02 MB |
| after_fixture_1_dashboard_goto | 415.79 MB | 430.31 MB | 89.61 MB | 93.32 MB | 107.25 MB | 117.31 MB | 56.74 MB | 57.04 MB |
| before_fixture_1_upload | 415.55 MB | 430.18 MB | 89.66 MB | 93.22 MB | 107.22 MB | 117.17 MB | 56.71 MB | 57.07 MB |
| after_fixture_1_upload | 452.13 MB | 462.73 MB | 106.71 MB | 109 MB | 118.77 MB | 128.45 MB | 62.03 MB | 62.06 MB |
| before_fixture_1_parse_wait | 447.32 MB | 462.58 MB | 106.42 MB | 109.31 MB | 117.70 MB | 128.19 MB | 62.03 MB | 62.06 MB |
| after_fixture_1_parse | 446.12 MB | 462.26 MB | 104.97 MB | 109.51 MB | 117.03 MB | 127.75 MB | 62.03 MB | 62.06 MB |
| before_fixture_1_save_dialog | 446.10 MB | 462.82 MB | 105.28 MB | 109.87 MB | 117.06 MB | 127.73 MB | 62.03 MB | 62.06 MB |
| after_fixture_1_save_dialog_open | 472.81 MB | 484.95 MB | 125.04 MB | 125.05 MB | 121.46 MB | 133.63 MB | 62.11 MB | 62.14 MB |
| before_fixture_1_save_commit | 502.37 MB | 509.54 MB | 146.27 MB | 149.11 MB | 121.89 MB | 133.94 MB | 61.92 MB | 61.95 MB |
| after_fixture_1_save_persist | 501.24 MB | 513.07 MB | 146.37 MB | 146.96 MB | 122.07 MB | 133.98 MB | 62.55 MB | 62.68 MB |
| after_fixture_1_save | 501.53 MB | 511.26 MB | 144.22 MB | 147.33 MB | 121.81 MB | 134.04 MB | 62.55 MB | 62.68 MB |
| after_fixture_1_post_save_settle | 489.54 MB | 499.93 MB | 122.73 MB | 144.74 MB | 121.81 MB | 132.99 MB | 62.55 MB | 62.68 MB |
| after_fixture_1_cleanup | 471.14 MB | 478.82 MB | 117.90 MB | 118.99 MB | 121.45 MB | 127.40 MB | 62.55 MB | 62.68 MB |
| before_fixture_2_dashboard_goto | 470.20 MB | 479.03 MB | 116.81 MB | 119.08 MB | 121.48 MB | 127.43 MB | 62.55 MB | 62.68 MB |
| after_fixture_2_dashboard_goto | 470.37 MB | 479.03 MB | 116.98 MB | 119.18 MB | 121.48 MB | 127.40 MB | 62.55 MB | 62.68 MB |
| before_fixture_2_upload | 470.54 MB | 479.32 MB | 117.16 MB | 119.37 MB | 121.48 MB | 127.43 MB | 62.55 MB | 62.68 MB |
| after_fixture_2_upload | 491.30 MB | 503.18 MB | 129.67 MB | 129.96 MB | 131.02 MB | 139.08 MB | 64.23 MB | 64.62 MB |
| before_fixture_2_parse_wait | 487.06 MB | 502.16 MB | 129.12 MB | 129.44 MB | 129.18 MB | 138.69 MB | 64.23 MB | 64.62 MB |
| after_fixture_2_parse | 487.28 MB | 500.95 MB | 126.83 MB | 129.25 MB | 129.21 MB | 137.51 MB | 64.23 MB | 64.62 MB |
| before_fixture_2_save_dialog | 487.12 MB | 501.01 MB | 126.93 MB | 129.39 MB | 129.04 MB | 137.36 MB | 64.23 MB | 64.62 MB |
| after_fixture_2_save_dialog_open | 499.42 MB | 509.04 MB | 134.96 MB | 136.42 MB | 130.48 MB | 138.12 MB | 64.24 MB | 64.62 MB |
| before_fixture_2_save_commit | 514.73 MB | 525.49 MB | 151.05 MB | 152.17 MB | 130.02 MB | 138.40 MB | 64.18 MB | 64.56 MB |
| after_fixture_2_save_persist | 522.09 MB | 529 MB | 155.88 MB | 157.25 MB | 130.47 MB | 138.35 MB | 64.45 MB | 64.72 MB |
| after_fixture_2_save | 517.99 MB | 528.94 MB | 154.15 MB | 155.91 MB | 129.93 MB | 138.34 MB | 64.45 MB | 64.72 MB |
| after_fixture_2_post_save_settle | 510.48 MB | 517.17 MB | 153.96 MB | 154 MB | 129.91 MB | 137.87 MB | 64.45 MB | 64.68 MB |
| after_fixture_2_cleanup | 485.27 MB | 493.28 MB | 121.41 MB | 123.51 MB | 129.73 MB | 137.84 MB | 64.41 MB | 64.68 MB |
| before_fixture_3_dashboard_goto | 482.86 MB | 486.03 MB | 122.09 MB | 122.54 MB | 129.68 MB | 130.60 MB | 64.41 MB | 64.68 MB |
| after_fixture_3_dashboard_goto | 477.86 MB | 482.62 MB | 117.98 MB | 121.44 MB | 121.99 MB | 129.83 MB | 64.41 MB | 64.68 MB |
| before_fixture_3_upload | 475.76 MB | 482.09 MB | 118.14 MB | 119.45 MB | 122.02 MB | 129.72 MB | 64.41 MB | 64.66 MB |
| after_fixture_3_upload | 489.09 MB | 508.37 MB | 130.46 MB | 131.16 MB | 124.27 MB | 139.97 MB | 65.81 MB | 66.06 MB |
| before_fixture_3_parse_wait | 485.31 MB | 502.10 MB | 127.05 MB | 127.50 MB | 122.86 MB | 138.44 MB | 65.81 MB | 66.06 MB |
| after_fixture_3_parse | 484.04 MB | 502.43 MB | 126.73 MB | 127.80 MB | 122.86 MB | 138.47 MB | 65.81 MB | 66.06 MB |
| before_fixture_3_save_dialog | 483.41 MB | 501.21 MB | 126.83 MB | 127.28 MB | 122.34 MB | 137.93 MB | 65.81 MB | 66.06 MB |
| after_fixture_3_save_dialog_open | 496.73 MB | 513.05 MB | 128.15 MB | 129.85 MB | 132.19 MB | 148.47 MB | 65.81 MB | 66.06 MB |
| before_fixture_3_save_commit | 498.44 MB | 512.21 MB | 128.43 MB | 132.68 MB | 131.32 MB | 147.57 MB | 65.66 MB | 65.91 MB |
| after_fixture_3_save_persist | 499.34 MB | 512.23 MB | 128.25 MB | 132.88 MB | 130.99 MB | 147.84 MB | 65.18 MB | 65.30 MB |
| after_fixture_3_save | 499.54 MB | 509.63 MB | 126.37 MB | 132.98 MB | 131 MB | 147.09 MB | 65.18 MB | 65.30 MB |
| after_fixture_3_post_save_settle | 498.27 MB | 509.47 MB | 126.32 MB | 131.82 MB | 130.92 MB | 147.01 MB | 65.18 MB | 65.30 MB |
| after_fixture_3_cleanup | 497.85 MB | 501.31 MB | 125.78 MB | 131.79 MB | 130.57 MB | 139.43 MB | 65.18 MB | 65.30 MB |
| before_fixture_4_dashboard_goto | 498.74 MB | 502.33 MB | 126.77 MB | 132.59 MB | 130.59 MB | 139.43 MB | 65.18 MB | 65.30 MB |
| after_fixture_4_dashboard_goto | 491.07 MB | 493.37 MB | 125.81 MB | 132.56 MB | 122.94 MB | 131.39 MB | 65.18 MB | 65.30 MB |
| before_fixture_4_upload | 489.68 MB | 493.38 MB | 125.88 MB | 131.22 MB | 122.96 MB | 131.40 MB | 65.18 MB | 65.30 MB |
| after_fixture_4_upload | 507.61 MB | 518.81 MB | 146.55 MB | 146.70 MB | 123.74 MB | 133.09 MB | 67.07 MB | 67.15 MB |
| before_fixture_4_parse_wait | 504.54 MB | 516.40 MB | 143.72 MB | 145.21 MB | 123.45 MB | 132.10 MB | 67.07 MB | 67.15 MB |
| after_fixture_4_parse | 504.12 MB | 512.01 MB | 143.31 MB | 143.81 MB | 122.93 MB | 131.49 MB | 67.11 MB | 67.17 MB |
| before_fixture_4_save_dialog | 504.26 MB | 511.87 MB | 143.32 MB | 143.83 MB | 122.95 MB | 131.24 MB | 67.11 MB | 67.17 MB |
| after_fixture_4_save_dialog_open | 503.18 MB | 520.57 MB | 142.13 MB | 143.12 MB | 124.18 MB | 140.17 MB | 67.11 MB | 67.17 MB |
| before_fixture_4_save_commit | 501.63 MB | 521.57 MB | 141 MB | 144.43 MB | 123.64 MB | 139.89 MB | 66.93 MB | 66.99 MB |
| after_fixture_4_save_persist | 513.67 MB | 519.45 MB | 142.32 MB | 146.23 MB | 131.41 MB | 140.39 MB | 66.03 MB | 66.07 MB |
| after_fixture_4_save | 512.21 MB | 518.25 MB | 140.99 MB | 144.69 MB | 131.42 MB | 140.47 MB | 66.03 MB | 66.07 MB |
| after_fixture_4_post_save_settle | 510.27 MB | 517.58 MB | 141.12 MB | 143.67 MB | 130.88 MB | 139.88 MB | 66.03 MB | 66.07 MB |
| after_fixture_4_cleanup | 509.76 MB | 510.27 MB | 140.98 MB | 143.63 MB | 130.88 MB | 132.32 MB | 66.03 MB | 66.07 MB |
| before_fixture_5_dashboard_goto | 510.06 MB | 510.22 MB | 141.14 MB | 143.67 MB | 130.85 MB | 132.36 MB | 66.03 MB | 66.07 MB |
| after_fixture_5_dashboard_goto | 502.59 MB | 509.45 MB | 140.65 MB | 143.69 MB | 123.03 MB | 131.76 MB | 66.03 MB | 66.07 MB |
| before_fixture_5_upload | 500.31 MB | 509.37 MB | 140.87 MB | 141.73 MB | 123.03 MB | 131.74 MB | 66.03 MB | 66.07 MB |
| after_fixture_5_upload | 504.65 MB | 516.86 MB | 133.95 MB | 144.11 MB | 132.85 MB | 133.37 MB | 67 MB | 67.64 MB |
| before_fixture_5_parse_wait | 504.70 MB | 511.06 MB | 134.01 MB | 141.79 MB | 131.61 MB | 133.16 MB | 67 MB | 67.64 MB |
| after_fixture_5_parse | 502.22 MB | 511.09 MB | 132.23 MB | 141.80 MB | 131.62 MB | 132.64 MB | 67 MB | 67.64 MB |
| before_fixture_5_save_dialog | 502.34 MB | 502.54 MB | 132.45 MB | 133.16 MB | 131.30 MB | 132.63 MB | 67.02 MB | 67.64 MB |
| after_fixture_5_save_dialog_open | 505.45 MB | 513.41 MB | 134.30 MB | 135.15 MB | 133.98 MB | 140.31 MB | 67.02 MB | 67.63 MB |
| before_fixture_5_save_commit | 505.01 MB | 509.74 MB | 131.95 MB | 133.67 MB | 133.85 MB | 139.65 MB | 66.87 MB | 67.49 MB |
| after_fixture_5_save_persist | 498.62 MB | 508.34 MB | 128.95 MB | 133.20 MB | 133.39 MB | 139.40 MB | 65.65 MB | 65.82 MB |
| after_fixture_5_save | 499.18 MB | 504.98 MB | 129.36 MB | 130.02 MB | 133.44 MB | 139.12 MB | 65.65 MB | 65.82 MB |
| after_fixture_5_post_save_settle | 497.26 MB | 504.27 MB | 128.39 MB | 129.95 MB | 132.61 MB | 138.62 MB | 65.65 MB | 65.82 MB |
| after_fixture_5_cleanup | 488.81 MB | 496.66 MB | 128.57 MB | 129.78 MB | 123.28 MB | 131.68 MB | 65.65 MB | 65.82 MB |
| after_setup | 488.70 MB | 496.40 MB | 128.43 MB | 129.90 MB | 123.17 MB | 131.63 MB | 65.65 MB | 65.82 MB |
| before_comparison_open | 488.05 MB | 496.66 MB | 128.66 MB | 129.23 MB | 123.20 MB | 131.67 MB | 65.65 MB | 65.82 MB |
| after_comparison_open | 490.05 MB | 506.16 MB | 129.04 MB | 130.10 MB | 123.70 MB | 139.04 MB | 65.96 MB | 66.23 MB |
| before_add_1 | 489.86 MB | 505.24 MB | 129.07 MB | 129.99 MB | 123.21 MB | 138.88 MB | 65.96 MB | 66.23 MB |
| after_add_1_selector_open | 488.22 MB | 505.01 MB | 127.59 MB | 128.22 MB | 123.48 MB | 139.88 MB | 66.14 MB | 66.40 MB |
| after_add_1_selector_search | 485.28 MB | 501.71 MB | 124.52 MB | 125.13 MB | 123.22 MB | 139.68 MB | 66.19 MB | 66.55 MB |
| after_add_1_click | 499.51 MB | 506.09 MB | 125.89 MB | 125.99 MB | 136.34 MB | 141.76 MB | 66.57 MB | 67.08 MB |
| after_add_1_store_update | 498.02 MB | 504.59 MB | 125.85 MB | 125.96 MB | 135.42 MB | 140.85 MB | 66.57 MB | 67.08 MB |
| after_add_1_series_ready | 498.05 MB | 504.58 MB | 125.86 MB | 125.94 MB | 135.42 MB | 140.85 MB | 66.57 MB | 67.08 MB |
| after_add_1_dom_settle | 497.76 MB | 504.29 MB | 125.86 MB | 125.95 MB | 135.14 MB | 140.60 MB | 66.57 MB | 67.08 MB |
| after_add_1 | 497.67 MB | 504.29 MB | 125.86 MB | 125.95 MB | 135.14 MB | 140.60 MB | 66.57 MB | 67.08 MB |
| before_add_2 | 497.70 MB | 504.12 MB | 125.86 MB | 125.95 MB | 135.14 MB | 140.60 MB | 66.50 MB | 67.02 MB |
| after_add_2_selector_open | 497.21 MB | 504.17 MB | 124.88 MB | 125.53 MB | 135.47 MB | 140.88 MB | 66.56 MB | 67.08 MB |
| after_add_2_selector_search | 497.46 MB | 504.39 MB | 125.05 MB | 125.88 MB | 135.43 MB | 140.86 MB | 66.56 MB | 67.08 MB |
| after_add_2_click | 500.14 MB | 507.37 MB | 126.25 MB | 127.11 MB | 135.85 MB | 142.06 MB | 66.95 MB | 67.48 MB |
| after_add_2_store_update | 499.83 MB | 504.93 MB | 126.30 MB | 127.08 MB | 135.58 MB | 140.67 MB | 66.95 MB | 67.48 MB |
| after_add_2_series_ready | 499.39 MB | 505.05 MB | 126.38 MB | 127.10 MB | 135.21 MB | 140.63 MB | 66.95 MB | 67.48 MB |
| after_add_2_dom_settle | 499.48 MB | 505.02 MB | 126.41 MB | 127.10 MB | 135.21 MB | 140.60 MB | 66.95 MB | 67.48 MB |
| after_add_2 | 499.37 MB | 505.09 MB | 126.44 MB | 127.11 MB | 135.21 MB | 140.60 MB | 66.95 MB | 67.48 MB |
| before_add_3 | 499.41 MB | 505.07 MB | 126.48 MB | 127.11 MB | 135.21 MB | 140.60 MB | 66.89 MB | 67.42 MB |
| after_add_3_selector_open | 497.98 MB | 505.29 MB | 125.93 MB | 126.45 MB | 135.51 MB | 140.87 MB | 66.95 MB | 67.48 MB |
| after_add_3_selector_search | 497.84 MB | 502.86 MB | 125.69 MB | 126.91 MB | 135.46 MB | 138.09 MB | 66.95 MB | 67.49 MB |
| after_add_3_click | 510.85 MB | 516.83 MB | 128.44 MB | 129.27 MB | 146.85 MB | 149.34 MB | 66.99 MB | 67.53 MB |
| after_add_3_store_update | 510.02 MB | 516.08 MB | 128.41 MB | 128.52 MB | 146.68 MB | 148.69 MB | 66.99 MB | 67.53 MB |
| after_add_3_series_ready | 509.48 MB | 514.12 MB | 126.79 MB | 128.35 MB | 146.25 MB | 147.94 MB | 67.01 MB | 67.53 MB |
| after_add_3_dom_settle | 509.57 MB | 514.22 MB | 127.12 MB | 128.38 MB | 146.25 MB | 147.94 MB | 67.04 MB | 67.54 MB |
| after_add_3 | 509.42 MB | 514.11 MB | 127.07 MB | 128.38 MB | 146.25 MB | 147.92 MB | 67.06 MB | 67.48 MB |
| before_add_4 | 509.52 MB | 514.15 MB | 127.11 MB | 128.38 MB | 146.25 MB | 147.92 MB | 67 MB | 67.48 MB |
| after_add_4_selector_open | 508.49 MB | 512.61 MB | 126.82 MB | 126.88 MB | 146.49 MB | 148.07 MB | 67.06 MB | 67.54 MB |
| after_add_4_selector_search | 509.08 MB | 513.37 MB | 126.48 MB | 127.22 MB | 146.73 MB | 148.22 MB | 67.06 MB | 67.54 MB |
| after_add_4_click | 511.27 MB | 516.39 MB | 128.65 MB | 129.89 MB | 147.05 MB | 148.76 MB | 67.25 MB | 67.71 MB |
| after_add_4_store_update | 510.54 MB | 515.54 MB | 128.75 MB | 129.31 MB | 146.29 MB | 148.41 MB | 67.25 MB | 67.71 MB |
| after_add_4_series_ready | 510.63 MB | 514.98 MB | 128.75 MB | 129.31 MB | 146.29 MB | 148.03 MB | 67.25 MB | 67.71 MB |
| after_add_4_dom_settle | 510.55 MB | 515.01 MB | 128.75 MB | 129.31 MB | 146.29 MB | 147.99 MB | 67.25 MB | 67.71 MB |
| after_add_4 | 510.59 MB | 514.87 MB | 128.77 MB | 129.31 MB | 146.29 MB | 147.93 MB | 67.25 MB | 67.66 MB |
| before_add_5 | 510.52 MB | 514.89 MB | 128.77 MB | 129.31 MB | 146.29 MB | 147.93 MB | 67.20 MB | 67.65 MB |
| after_add_5_selector_open | 510.04 MB | 514.05 MB | 127.36 MB | 128.02 MB | 146.59 MB | 148.24 MB | 67.26 MB | 67.71 MB |
| after_add_5_selector_search | 509.92 MB | 514.53 MB | 127.61 MB | 128.51 MB | 146.40 MB | 148.24 MB | 67.27 MB | 67.72 MB |
| after_add_5_click | 591.41 MB | 592.76 MB | 131.82 MB | 131.87 MB | 219.48 MB | 221.46 MB | 67.26 MB | 67.73 MB |
| after_add_5_store_update | 588.18 MB | 589.39 MB | 130.96 MB | 130.98 MB | 218.25 MB | 220.12 MB | 67.26 MB | 67.73 MB |
| after_add_5_series_ready | 588.31 MB | 589.50 MB | 131 MB | 131 MB | 218.25 MB | 220.12 MB | 67.26 MB | 67.73 MB |
| after_add_5_dom_settle | 588.33 MB | 589.37 MB | 131 MB | 131 MB | 218.25 MB | 220.04 MB | 67.26 MB | 67.73 MB |
| after_add_5 | 588.35 MB | 589.45 MB | 131 MB | 131 MB | 218.25 MB | 220.04 MB | 67.26 MB | 67.67 MB |
| after_chart_canvas_painted | 596 MB | 596.41 MB | 135.45 MB | 135.45 MB | 221.46 MB | 222.68 MB | 67.20 MB | 67.67 MB |
| after_chart_visible | 588.86 MB | 595.81 MB | 135.45 MB | 135.49 MB | 214.46 MB | 221.98 MB | 67.20 MB | 67.67 MB |
| after_chart_ready | 588.95 MB | 595.61 MB | 135.45 MB | 135.51 MB | 214.46 MB | 221.98 MB | 67.20 MB | 67.67 MB |
| before_report_tab | 582.98 MB | 590.32 MB | 135.45 MB | 135.76 MB | 210.51 MB | 216.58 MB | 67.20 MB | 67.67 MB |
| after_report_tab_open | 597.74 MB | 601.02 MB | 133.91 MB | 135.55 MB | 221.55 MB | 225.68 MB | 68.91 MB | 69.03 MB |
| before_pdf | 595.70 MB | 599.73 MB | 133.98 MB | 134.69 MB | 220.90 MB | 225.32 MB | 68.91 MB | 69.03 MB |
| after_pdf | 590.23 MB | 593.18 MB | 132.55 MB | 133.22 MB | 216.75 MB | 219.12 MB | 69.51 MB | 69.56 MB |
| before_xlsx | 590.05 MB | 591.99 MB | 132.51 MB | 133.19 MB | 216.71 MB | 218.31 MB | 69.51 MB | 69.56 MB |
| after_xlsx | 588.68 MB | 590.66 MB | 132.68 MB | 133.45 MB | 215.02 MB | 216.68 MB | 69.55 MB | 69.60 MB |
| after_gc_hint | 577.75 MB | 578.55 MB | 121.65 MB | 123.42 MB | 214 MB | 215.60 MB | 69.45 MB | 69.50 MB |
| after_export_gc_hint | 577.78 MB | 578.71 MB | 121.72 MB | 123.46 MB | 214 MB | 215.60 MB | 69.45 MB | 69.50 MB |
| before_route_leave | 577.34 MB | 578.48 MB | 121.75 MB | 123.50 MB | 213.61 MB | 215.47 MB | 69.45 MB | 69.47 MB |
| after_comparison_store_clear | 577.48 MB | 579.76 MB | 122 MB | 122.64 MB | 214.51 MB | 216.38 MB | 69.45 MB | 69.47 MB |
| after_route_leave | 582.03 MB | 582.69 MB | 124.96 MB | 126.96 MB | 214.71 MB | 216.29 MB | 69.53 MB | 69.56 MB |
| after_chart_unmount_settle | 580.29 MB | 581.86 MB | 124.32 MB | 125.48 MB | 214.52 MB | 216.11 MB | 69.53 MB | 69.53 MB |
| after_second_gc_hint | 569.21 MB | 574.62 MB | 120.84 MB | 123.12 MB | 207.14 MB | 211.36 MB | 69.53 MB | 69.53 MB |

## App-Owned Renderer Stats

| Phase | JS heap p50 | Series cache p50 | Rust series entries p50 | Rust series cache p50 | Rust series hits p50 | Rust series misses p50 | Cmp raw p50 | Cmp columnar p50 | Parse cache entries p50 | Parse cache points p50 | DOM nodes p50 | Canvas count p50 | Canvas pixels p50 | uPlot count p50 | Cmp page root p50 | Cmp chart root p50 | Cmp chart uPlot p50 | Cmp chart canvas p50 | Cmp report root p50 | Dash chart root p50 | Dash chart uPlot p50 | Dash chart canvas p50 | uPlot init total p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| app_start | 8.35 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_setup | 8.42 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_1_dashboard_goto | 8.45 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_fixture_1_dashboard_goto | 8.48 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_1_upload | 8.51 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_fixture_1_upload | 10.67 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 143 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_1_parse_wait | 11.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_parse | 11.66 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_1_save_dialog | 11.69 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_save_dialog_open | 12.63 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 595 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_1_save_commit | 16.50 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 600 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_save_persist | 15.83 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 386 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_save | 15.96 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_post_save_settle | 15.99 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_1_cleanup | 9.99 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_2_dashboard_goto | 9.87 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_2_dashboard_goto | 9.92 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| before_fixture_2_upload | 9.95 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 4.10 ms |
| after_fixture_2_upload | 16.04 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_2_parse_wait | 11.88 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_2_parse | 11.99 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| before_fixture_2_save_dialog | 12.02 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_2_save_dialog_open | 17.30 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 724 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| before_fixture_2_save_commit | 21 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 726 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_2_save_persist | 16.81 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 512 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_2_save | 16.93 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_2_post_save_settle | 16.96 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_2_cleanup | 16.96 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| before_fixture_3_dashboard_goto | 10.79 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_3_dashboard_goto | 10.84 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| before_fixture_3_upload | 10.87 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1.30 ms |
| after_fixture_3_upload | 19.11 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_3_parse_wait | 14.45 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_3_parse | 14.55 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| before_fixture_3_save_dialog | 14.58 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_3_save_dialog_open | 11.91 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 823 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| before_fixture_3_save_commit | 12.49 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 824 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_3_save_persist | 12.18 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 680 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_3_save | 12.34 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_3_post_save_settle | 12.38 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_3_cleanup | 12.41 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| before_fixture_4_dashboard_goto | 12.44 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_4_dashboard_goto | 12.49 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| before_fixture_4_upload | 12.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2.60 ms |
| after_fixture_4_upload | 12.45 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_4_parse_wait | 19.60 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_4_parse | 19.70 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| before_fixture_4_save_dialog | 19.73 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_4_save_dialog_open | 15.12 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 529 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| before_fixture_4_save_commit | 15.23 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 530 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_4_save_persist | 14.65 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 386 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_4_save | 14.76 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_4_post_save_settle | 14.80 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_4_cleanup | 14.83 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| before_fixture_5_dashboard_goto | 14.86 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_dashboard_goto | 14.89 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| before_fixture_5_upload | 13.78 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.80 ms |
| after_fixture_5_upload | 20.49 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_fixture_5_parse_wait | 14.46 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_5_parse | 14.56 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| before_fixture_5_save_dialog | 14.59 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_5_save_dialog_open | 13.90 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 592 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| before_fixture_5_save_commit | 13.47 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 593 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_5_save_persist | 13.41 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 449 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_5_save | 13.53 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_5_post_save_settle | 13.56 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_fixture_5_cleanup | 13.59 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_setup | 13.62 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| before_comparison_open | 13.66 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.90 ms |
| after_comparison_open | 11.11 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 206 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| before_add_1 | 11.21 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 206 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_selector_open | 11.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 281 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_selector_search | 11.77 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 237 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_click | 11.77 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 215 | 0 | 0 B | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| after_add_1_store_update | 12.29 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_1_series_ready | 12.25 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_1_dom_settle | 11.78 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_1 | 11.81 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| before_add_2 | 11.85 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_2_selector_open | 12.09 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 278 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_2_selector_search | 12.26 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 278 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_2_click | 12.46 MB | 28.49 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 251 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_2_store_update | 12.72 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_2_series_ready | 12.63 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_2_dom_settle | 12.66 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_2 | 12.69 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| before_add_3 | 12.72 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_3_selector_open | 12.96 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 292 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_3_selector_search | 13.13 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 292 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_3_click | 13.39 MB | 96.14 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 265 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_3_store_update | 12.40 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_3_series_ready | 12.44 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_3_dom_settle | 12.52 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_3 | 12.58 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| before_add_4 | 12.65 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_4_selector_open | 12.92 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 306 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_4_selector_search | 13.10 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 306 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_4_click | 13.34 MB | 162.80 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 279 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.40 ms |
| after_add_4_store_update | 13.80 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_4_series_ready | 13.74 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_4_dom_settle | 13.77 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_4 | 13.81 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| before_add_5 | 13.84 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_5_selector_open | 14.06 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 320 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_5_selector_search | 13.83 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 320 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_5_click | 14.24 MB | 205.57 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 293 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms |
| after_add_5_store_update | 14.89 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_5_series_ready | 14.96 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_5_dom_settle | 15 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_add_5 | 15.03 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_chart_canvas_painted | 16.82 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_chart_visible | 16.87 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_chart_ready | 16.90 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| before_report_tab | 16.93 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms |
| after_report_tab_open | 18.10 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 272 | 0 | 0 B | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | n/a |
| before_pdf | 16 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.50 ms |
| after_pdf | 13.89 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.50 ms |
| before_xlsx | 13.92 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.50 ms |
| after_xlsx | 14.10 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.50 ms |
| after_gc_hint | 11.47 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.50 ms |
| after_export_gc_hint | 11.51 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.50 ms |
| before_route_leave | 11.54 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.50 ms |
| after_comparison_store_clear | 11.66 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 215 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | n/a |
| after_route_leave | 11.91 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 307 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms |
| after_chart_unmount_settle | 12.27 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 453 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms |
| after_second_gc_hint | 11.16 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 453 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms |

## P50 Deltas

| Delta | Total | Renderer | GPU | Tauri |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup -> after_add_5 | 99.54 MB | 2.43 MB | 94.97 MB | 1.61 MB |
| after_add_5 -> after_chart_canvas_painted | 7.65 MB | 4.45 MB | 3.21 MB | -0.06 MB |
| after_xlsx - after_export_gc_hint | 10.90 MB | 10.96 MB | 1.02 MB | 0.10 MB |
| after_export_gc_hint - after_route_leave | -4.25 MB | -3.24 MB | -0.71 MB | -0.08 MB |
| after_route_leave - after_chart_visible | -6.83 MB | -10.49 MB | 0.25 MB | 2.33 MB |

## Readout

- `after_xlsx - after_export_gc_hint` estimates reclaimable post-export RSS
  after product-side buffer cleanup plus a diagnostic GC hint.
- `after_export_gc_hint - after_route_leave` shows whether navigation releases
  additional app-controlled state. Near-zero renderer deltas here suggest the
  remaining RSS is mostly WebView2/runtime retention.
- `after_route_leave - after_chart_visible` should not be interpreted as a
  leak by itself; WebView2/GPU memory may shift across phases and processes.

