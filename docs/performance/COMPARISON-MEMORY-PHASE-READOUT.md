# Comparison Memory Phase Readout

**Generated:** 2026-05-02T21:11:46.539Z.

Diagnostic comparison-smoke memory run summary. These runs use direct Win32
RSS sampling and CDP GC hints, so use them for memory phase diagnosis, not
for user-facing latency budgets.

- N: 5
- Runs: 3
- Modes: tauri-debug-mocked
- Export save modes: direct
- Source sidecars:
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777755253910-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777755597254-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777755966787-tauri.json`

## Phase RSS

| Phase | Total p50 | Total p95 | Renderer p50 | Renderer p95 | GPU p50 | GPU p95 | Tauri p50 | Tauri p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| app_start | 425.08 MB | 426.39 MB | 87.58 MB | 89.81 MB | 115.51 MB | 117.81 MB | 56.75 MB | 57.07 MB |
| before_setup | 422.03 MB | 423.29 MB | 87.63 MB | 89.87 MB | 115.11 MB | 117.40 MB | 56.75 MB | 57.07 MB |
| before_fixture_1_dashboard_goto | 422.27 MB | 423.55 MB | 87.68 MB | 89.91 MB | 115.08 MB | 117.37 MB | 56.75 MB | 57.07 MB |
| after_fixture_1_dashboard_goto | 422.02 MB | 423.25 MB | 87.71 MB | 89.96 MB | 115.06 MB | 117.33 MB | 56.75 MB | 57.07 MB |
| before_fixture_1_upload | 422.13 MB | 423.38 MB | 87.75 MB | 89.99 MB | 115.06 MB | 117.33 MB | 56.72 MB | 57.04 MB |
| after_fixture_1_upload | 463.12 MB | 464.30 MB | 104.30 MB | 106.57 MB | 130.93 MB | 136.21 MB | 61.79 MB | 62.14 MB |
| before_fixture_1_parse_wait | 459.15 MB | 467.91 MB | 104.73 MB | 106.45 MB | 129.70 MB | 139.54 MB | 61.79 MB | 62.14 MB |
| after_fixture_1_parse | 458.34 MB | 465.97 MB | 103.37 MB | 105.33 MB | 129.70 MB | 139.16 MB | 61.79 MB | 62.14 MB |
| before_fixture_1_save_dialog | 458.06 MB | 466.59 MB | 103.75 MB | 105.63 MB | 129.29 MB | 139.15 MB | 61.79 MB | 62.14 MB |
| after_fixture_1_save_dialog_open | 499.44 MB | 513.22 MB | 123.54 MB | 128.47 MB | 146.39 MB | 164.31 MB | 61.88 MB | 62.23 MB |
| before_fixture_1_save_commit | 525.30 MB | 532.01 MB | 146.44 MB | 148.01 MB | 147.22 MB | 165.35 MB | 61.69 MB | 62.04 MB |
| after_fixture_1_save_persist | 530.91 MB | 537.07 MB | 146.50 MB | 149.26 MB | 151.22 MB | 165.50 MB | 62.65 MB | 63.49 MB |
| after_fixture_1_save | 528.96 MB | 535.55 MB | 146.79 MB | 147.72 MB | 151.04 MB | 165.61 MB | 62.65 MB | 63.48 MB |
| after_fixture_1_post_save_settle | 512.48 MB | 526.76 MB | 144.02 MB | 147.42 MB | 150.65 MB | 164.36 MB | 62.65 MB | 63.48 MB |
| after_fixture_1_cleanup | 490.77 MB | 500.25 MB | 114.90 MB | 120.58 MB | 149.56 MB | 150.24 MB | 62.65 MB | 63.48 MB |
| before_fixture_2_dashboard_goto | 485.76 MB | 488.43 MB | 114.02 MB | 117.87 MB | 140.53 MB | 144.08 MB | 62.65 MB | 63.48 MB |
| after_fixture_2_dashboard_goto | 476.61 MB | 479.43 MB | 114.23 MB | 116.98 MB | 132.42 MB | 134.73 MB | 62.65 MB | 63.48 MB |
| before_fixture_2_upload | 476.65 MB | 479.77 MB | 114.46 MB | 117.20 MB | 132.44 MB | 134.68 MB | 62.65 MB | 63.48 MB |
| after_fixture_2_upload | 500.25 MB | 503.65 MB | 126.69 MB | 127.98 MB | 142.34 MB | 145 MB | 63.88 MB | 64.05 MB |
| before_fixture_2_parse_wait | 495.63 MB | 499.02 MB | 124.26 MB | 127.28 MB | 140.50 MB | 143.11 MB | 63.88 MB | 64.05 MB |
| after_fixture_2_parse | 494.51 MB | 498.79 MB | 124.24 MB | 127.01 MB | 140.53 MB | 142.01 MB | 63.88 MB | 64.05 MB |
| before_fixture_2_save_dialog | 494.50 MB | 498.51 MB | 124.27 MB | 127.01 MB | 140.35 MB | 141.94 MB | 63.88 MB | 64.05 MB |
| after_fixture_2_save_dialog_open | 531.23 MB | 535.13 MB | 134.33 MB | 134.52 MB | 169.29 MB | 170.75 MB | 63.91 MB | 64.06 MB |
| before_fixture_2_save_commit | 546.96 MB | 550.51 MB | 149.74 MB | 150.18 MB | 169.20 MB | 169.88 MB | 63.85 MB | 64 MB |
| after_fixture_2_save_persist | 548.40 MB | 550.31 MB | 150.39 MB | 152.42 MB | 168.83 MB | 169.80 MB | 64.19 MB | 64.44 MB |
| after_fixture_2_save | 546.54 MB | 550.51 MB | 150.48 MB | 150.60 MB | 167.83 MB | 168.86 MB | 64.19 MB | 64.44 MB |
| after_fixture_2_post_save_settle | 537.04 MB | 540.12 MB | 149 MB | 150.49 MB | 159.58 MB | 161.04 MB | 64.14 MB | 64.44 MB |
| after_fixture_2_cleanup | 505.07 MB | 537.91 MB | 120.81 MB | 146.69 MB | 152.26 MB | 158.88 MB | 64.14 MB | 64.39 MB |
| before_fixture_3_dashboard_goto | 496.13 MB | 522.82 MB | 120.11 MB | 144.21 MB | 146.85 MB | 149.42 MB | 64.14 MB | 64.39 MB |
| after_fixture_3_dashboard_goto | 485.63 MB | 510.52 MB | 117.83 MB | 144.02 MB | 134.19 MB | 141.32 MB | 64.14 MB | 64.39 MB |
| before_fixture_3_upload | 484.57 MB | 509 MB | 118.03 MB | 142.59 MB | 134.19 MB | 141.16 MB | 64.13 MB | 64.39 MB |
| after_fixture_3_upload | 517.85 MB | 530.41 MB | 128.07 MB | 147.56 MB | 150.46 MB | 151.90 MB | 65.26 MB | 66.19 MB |
| before_fixture_3_parse_wait | 514.22 MB | 525.56 MB | 126.70 MB | 143.94 MB | 149.12 MB | 149.99 MB | 65.26 MB | 66.19 MB |
| after_fixture_3_parse | 512.09 MB | 523.03 MB | 124.68 MB | 143.69 MB | 149.12 MB | 150.03 MB | 65.26 MB | 66.19 MB |
| before_fixture_3_save_dialog | 510.89 MB | 511.32 MB | 124.47 MB | 131.94 MB | 145.06 MB | 148.26 MB | 65.26 MB | 66.19 MB |
| after_fixture_3_save_dialog_open | 551.67 MB | 564.23 MB | 127.66 MB | 134.54 MB | 183.70 MB | 201.99 MB | 65.26 MB | 66.19 MB |
| before_fixture_3_save_commit | 550.83 MB | 567.16 MB | 127.78 MB | 133.21 MB | 184.01 MB | 203.05 MB | 65.11 MB | 66.04 MB |
| after_fixture_3_save_persist | 552.54 MB | 566.48 MB | 128.86 MB | 135.77 MB | 183.25 MB | 203.61 MB | 64.86 MB | 65.04 MB |
| after_fixture_3_save | 549.52 MB | 566.90 MB | 126.94 MB | 132.61 MB | 183.40 MB | 204.72 MB | 64.86 MB | 65.04 MB |
| after_fixture_3_post_save_settle | 548.48 MB | 560.03 MB | 127.01 MB | 132.95 MB | 182.11 MB | 199.19 MB | 64.86 MB | 65.04 MB |
| after_fixture_3_cleanup | 529.10 MB | 543.16 MB | 126.96 MB | 132.22 MB | 173.05 MB | 178.50 MB | 64.86 MB | 65.04 MB |
| before_fixture_4_dashboard_goto | 519.74 MB | 536.22 MB | 127.06 MB | 132.80 MB | 163.52 MB | 171.12 MB | 64.86 MB | 65.04 MB |
| after_fixture_4_dashboard_goto | 500.41 MB | 501.44 MB | 126.36 MB | 129.96 MB | 137.33 MB | 141.88 MB | 64.86 MB | 65.04 MB |
| before_fixture_4_upload | 500.56 MB | 501.33 MB | 127.01 MB | 130.25 MB | 137.32 MB | 141.87 MB | 64.86 MB | 65.04 MB |
| after_fixture_4_upload | 532.13 MB | 540.92 MB | 142.65 MB | 146.81 MB | 147.02 MB | 156.77 MB | 66.91 MB | 67.18 MB |
| before_fixture_4_parse_wait | 527.25 MB | 537 MB | 142.59 MB | 145.75 MB | 146.09 MB | 155.71 MB | 66.91 MB | 67.18 MB |
| after_fixture_4_parse | 525.77 MB | 535.61 MB | 140.48 MB | 144.05 MB | 146.12 MB | 155.56 MB | 66.91 MB | 67.18 MB |
| before_fixture_4_save_dialog | 524.24 MB | 530.93 MB | 140.75 MB | 144.11 MB | 144.70 MB | 150.77 MB | 66.91 MB | 67.18 MB |
| after_fixture_4_save_dialog_open | 560.49 MB | 581.17 MB | 139.54 MB | 142.69 MB | 182.14 MB | 203.78 MB | 66.91 MB | 67.18 MB |
| before_fixture_4_save_commit | 560.13 MB | 579.91 MB | 141.37 MB | 143.87 MB | 181.40 MB | 202.46 MB | 66.62 MB | 66.72 MB |
| after_fixture_4_save_persist | 559.29 MB | 581.97 MB | 141.90 MB | 143.95 MB | 181.25 MB | 202.95 MB | 65.77 MB | 65.77 MB |
| after_fixture_4_save | 559.04 MB | 574.77 MB | 142.16 MB | 144.61 MB | 180.58 MB | 196.33 MB | 65.77 MB | 65.77 MB |
| after_fixture_4_post_save_settle | 558.54 MB | 571.33 MB | 141.45 MB | 144.02 MB | 180.54 MB | 193.27 MB | 65.77 MB | 65.77 MB |
| after_fixture_4_cleanup | 554.38 MB | 561.29 MB | 141.72 MB | 144.04 MB | 176.47 MB | 183.17 MB | 65.77 MB | 65.77 MB |
| before_fixture_5_dashboard_goto | 552.38 MB | 552.95 MB | 141.46 MB | 143.28 MB | 174.38 MB | 175.66 MB | 65.77 MB | 65.77 MB |
| after_fixture_5_dashboard_goto | 516.51 MB | 525.94 MB | 141.72 MB | 143.30 MB | 139.42 MB | 149.87 MB | 65.77 MB | 65.77 MB |
| before_fixture_5_upload | 516.32 MB | 525.85 MB | 141.77 MB | 143 MB | 139.45 MB | 149.99 MB | 65.77 MB | 65.77 MB |
| after_fixture_5_upload | 531.19 MB | 536.48 MB | 143.61 MB | 144.96 MB | 149.07 MB | 164.72 MB | 66.33 MB | 67.48 MB |
| before_fixture_5_parse_wait | 529.71 MB | 532.28 MB | 142.29 MB | 144.36 MB | 147.99 MB | 162.98 MB | 66.32 MB | 67.47 MB |
| after_fixture_5_parse | 524.22 MB | 525.93 MB | 140.67 MB | 142.32 MB | 147.71 MB | 156.03 MB | 66.32 MB | 67.47 MB |
| before_fixture_5_save_dialog | 523.46 MB | 526.03 MB | 140.68 MB | 142.35 MB | 147.75 MB | 155.40 MB | 66.32 MB | 67.47 MB |
| after_fixture_5_save_dialog_open | 537.35 MB | 569.84 MB | 134.34 MB | 143.43 MB | 164.48 MB | 201.03 MB | 66.32 MB | 67.47 MB |
| before_fixture_5_save_commit | 538.09 MB | 571.39 MB | 131.86 MB | 143.68 MB | 164.02 MB | 201.93 MB | 66.17 MB | 67.32 MB |
| after_fixture_5_save_persist | 530.98 MB | 564.50 MB | 132.14 MB | 133.34 MB | 164.29 MB | 199.55 MB | 65.36 MB | 65.45 MB |
| after_fixture_5_save | 525.73 MB | 563.35 MB | 128.39 MB | 133.05 MB | 162.75 MB | 199.52 MB | 65.36 MB | 65.44 MB |
| after_fixture_5_post_save_settle | 524.54 MB | 557.25 MB | 128.58 MB | 130.49 MB | 161.51 MB | 193.35 MB | 65.36 MB | 65.44 MB |
| after_fixture_5_cleanup | 523.48 MB | 543.19 MB | 128.13 MB | 129.02 MB | 161.04 MB | 179.39 MB | 65.36 MB | 65.44 MB |
| after_setup | 517.90 MB | 523.24 MB | 128.35 MB | 129.05 MB | 155.23 MB | 160.47 MB | 65.36 MB | 65.44 MB |
| before_comparison_open | 501.69 MB | 512.47 MB | 125.22 MB | 128.42 MB | 139.25 MB | 150.03 MB | 65.36 MB | 65.44 MB |
| after_comparison_open | 513 MB | 524.80 MB | 126.87 MB | 130.62 MB | 147.46 MB | 159.43 MB | 65.75 MB | 65.75 MB |
| before_add_1 | 512.83 MB | 520.71 MB | 126.76 MB | 130.49 MB | 147.31 MB | 158.30 MB | 65.75 MB | 65.75 MB |
| after_add_1_selector_open | 511.54 MB | 520.86 MB | 126.77 MB | 128.86 MB | 147.71 MB | 158.81 MB | 65.93 MB | 65.93 MB |
| after_add_1_selector_search | 512.56 MB | 518.34 MB | 125.44 MB | 129.40 MB | 147.78 MB | 157.91 MB | 65.98 MB | 65.98 MB |
| before_add_1_click | 510.79 MB | 516.60 MB | 125.69 MB | 128.40 MB | 147.29 MB | 155.92 MB | 65.98 MB | 65.98 MB |
| after_add_1_click | 513.38 MB | 526.22 MB | 127.39 MB | 130.15 MB | 147.08 MB | 162.82 MB | 66.34 MB | 66.35 MB |
| after_add_1_click_before_chart_commit | 511.87 MB | 524.99 MB | 127.43 MB | 130.21 MB | 146.20 MB | 162.24 MB | 66.34 MB | 66.35 MB |
| after_add_1_react_commit | 512.05 MB | 525.08 MB | 127.44 MB | 130.26 MB | 146.20 MB | 162.24 MB | 66.34 MB | 66.35 MB |
| after_add_1_store_update | 511.86 MB | 525.12 MB | 127.44 MB | 130.26 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.34 MB |
| after_add_1_uplot_init | 511.98 MB | 525.02 MB | 125.84 MB | 130.10 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.34 MB |
| after_add_1_uplot_set_data | 511.75 MB | 525.16 MB | 126.07 MB | 130.12 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| after_add_1_first_canvas_paint | 511.87 MB | 525.05 MB | 126.09 MB | 130.12 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| after_add_1_series_ready | 511.75 MB | 525.21 MB | 126.10 MB | 130.12 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| after_add_1_compositor_settle_100ms | 511.87 MB | 525.23 MB | 126.10 MB | 130.12 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| after_add_1_compositor_settle_500ms | 511.75 MB | 525.12 MB | 126.10 MB | 130.12 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| after_add_1_dom_settle | 511.89 MB | 525.27 MB | 126.13 MB | 130.13 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| after_add_1 | 511.77 MB | 525.15 MB | 126.14 MB | 130.13 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| before_add_2 | 511.76 MB | 525.27 MB | 126.14 MB | 130.13 MB | 146.13 MB | 162.23 MB | 66.28 MB | 66.29 MB |
| after_add_2_selector_open | 507.83 MB | 523.88 MB | 123.03 MB | 125.84 MB | 146.41 MB | 162.32 MB | 66.34 MB | 66.34 MB |
| after_add_2_selector_search | 506.56 MB | 523.19 MB | 123.68 MB | 124.89 MB | 146.41 MB | 161.96 MB | 66.34 MB | 66.34 MB |
| before_add_2_click | 506.97 MB | 522.01 MB | 122.40 MB | 125 MB | 146.43 MB | 160.68 MB | 66.34 MB | 66.34 MB |
| after_add_2_click | 510.57 MB | 525.69 MB | 124.54 MB | 127.43 MB | 147.36 MB | 161.05 MB | 66.62 MB | 66.67 MB |
| after_add_2_click_before_chart_commit | 509.32 MB | 524.31 MB | 124.64 MB | 126.79 MB | 146.71 MB | 160.73 MB | 66.62 MB | 66.67 MB |
| after_add_2_react_commit | 505.54 MB | 520.41 MB | 124.70 MB | 126.84 MB | 143.59 MB | 156.94 MB | 66.62 MB | 66.67 MB |
| after_add_2_store_update | 505.67 MB | 520.57 MB | 124.74 MB | 126.88 MB | 142.97 MB | 156.88 MB | 66.62 MB | 66.67 MB |
| after_add_2_uplot_init | 505.41 MB | 520.51 MB | 124.75 MB | 126.76 MB | 142.97 MB | 156.88 MB | 66.62 MB | 66.67 MB |
| after_add_2_uplot_set_data | 505.49 MB | 520.87 MB | 124.77 MB | 126.78 MB | 142.97 MB | 157.10 MB | 66.57 MB | 66.62 MB |
| after_add_2_first_canvas_paint | 505.16 MB | 520.78 MB | 124.32 MB | 126.73 MB | 143.03 MB | 157.11 MB | 66.57 MB | 66.62 MB |
| after_add_2_series_ready | 505.28 MB | 520.94 MB | 124.37 MB | 126.74 MB | 143.02 MB | 157.10 MB | 66.57 MB | 66.62 MB |
| after_add_2_compositor_settle_100ms | 504.36 MB | 520.81 MB | 124.41 MB | 126.02 MB | 142.97 MB | 157.10 MB | 66.57 MB | 66.62 MB |
| after_add_2_compositor_settle_500ms | 504.48 MB | 520.97 MB | 124.45 MB | 126.03 MB | 142.97 MB | 157.10 MB | 66.57 MB | 66.62 MB |
| after_add_2_dom_settle | 504.36 MB | 520.88 MB | 124.48 MB | 126.03 MB | 142.97 MB | 157.10 MB | 66.57 MB | 66.62 MB |
| after_add_2 | 504.46 MB | 521.03 MB | 124.52 MB | 126.03 MB | 142.97 MB | 157.10 MB | 66.57 MB | 66.62 MB |
| before_add_3 | 504.34 MB | 520.94 MB | 124.55 MB | 126.04 MB | 142.97 MB | 157.10 MB | 66.57 MB | 66.62 MB |
| after_add_3_selector_open | 504.23 MB | 521.13 MB | 124.30 MB | 125.47 MB | 143.24 MB | 157.38 MB | 66.62 MB | 66.67 MB |
| after_add_3_selector_search | 503.50 MB | 520.30 MB | 124.05 MB | 124.87 MB | 143.28 MB | 157.57 MB | 66.63 MB | 66.68 MB |
| before_add_3_click | 503.99 MB | 520.61 MB | 123.49 MB | 125.16 MB | 143.28 MB | 157.57 MB | 66.63 MB | 66.68 MB |
| after_add_3_click | 517.64 MB | 533.80 MB | 125.77 MB | 128.27 MB | 153.67 MB | 168.39 MB | 66.70 MB | 66.80 MB |
| after_add_3_click_before_chart_commit | 517.63 MB | 532.55 MB | 125.50 MB | 128.30 MB | 153.49 MB | 167.59 MB | 66.70 MB | 66.80 MB |
| after_add_3_react_commit | 517.19 MB | 530.41 MB | 125.07 MB | 128.26 MB | 153.16 MB | 165.58 MB | 66.70 MB | 66.80 MB |
| after_add_3_store_update | 517.30 MB | 530.53 MB | 125.07 MB | 128.26 MB | 153.16 MB | 165.58 MB | 66.70 MB | 66.80 MB |
| after_add_3_uplot_init | 516.77 MB | 529.92 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.70 MB | 66.80 MB |
| after_add_3_uplot_set_data | 516.82 MB | 529.98 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| after_add_3_first_canvas_paint | 516.71 MB | 529.76 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| after_add_3_series_ready | 516.82 MB | 529.88 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| after_add_3_compositor_settle_100ms | 516.71 MB | 529.76 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| after_add_3_compositor_settle_500ms | 516.82 MB | 529.88 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| after_add_3_dom_settle | 516.76 MB | 529.87 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| after_add_3 | 516.87 MB | 529.78 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| before_add_4 | 516.76 MB | 529.87 MB | 125.07 MB | 128.26 MB | 152.74 MB | 165.09 MB | 66.64 MB | 66.74 MB |
| after_add_4_selector_open | 515.89 MB | 528.89 MB | 125.06 MB | 127.03 MB | 153.02 MB | 165.42 MB | 66.72 MB | 66.80 MB |
| after_add_4_selector_search | 515.25 MB | 528.57 MB | 125.82 MB | 126.64 MB | 153.03 MB | 165.43 MB | 66.72 MB | 66.80 MB |
| before_add_4_click | 515.60 MB | 528.65 MB | 125.39 MB | 126.80 MB | 153.03 MB | 165.43 MB | 66.72 MB | 66.80 MB |
| after_add_4_click | 519.14 MB | 532.50 MB | 127.61 MB | 129.31 MB | 153.91 MB | 165.17 MB | 66.83 MB | 66.92 MB |
| after_add_4_click_before_chart_commit | 518.01 MB | 529.84 MB | 126.82 MB | 128.53 MB | 153.44 MB | 164.12 MB | 66.83 MB | 66.92 MB |
| after_add_4_react_commit | 516.12 MB | 529.87 MB | 127.09 MB | 128.67 MB | 151.55 MB | 163.93 MB | 66.83 MB | 66.92 MB |
| after_add_4_store_update | 516.24 MB | 529.79 MB | 127.09 MB | 128.67 MB | 151.55 MB | 163.93 MB | 66.83 MB | 66.92 MB |
| after_add_4_uplot_init | 516.14 MB | 528.21 MB | 127.09 MB | 128.68 MB | 151.55 MB | 162.36 MB | 66.83 MB | 66.92 MB |
| after_add_4_uplot_set_data | 516.23 MB | 528.07 MB | 127.09 MB | 128.70 MB | 151.55 MB | 162.36 MB | 66.77 MB | 66.87 MB |
| after_add_4_first_canvas_paint | 516.36 MB | 528.37 MB | 127.43 MB | 128.86 MB | 151.50 MB | 162.35 MB | 66.77 MB | 66.87 MB |
| after_add_4_series_ready | 516.32 MB | 527.12 MB | 127.43 MB | 128.88 MB | 151.50 MB | 162.35 MB | 66.77 MB | 66.87 MB |
| after_add_4_compositor_settle_100ms | 516.34 MB | 527.23 MB | 127.43 MB | 128.91 MB | 151.48 MB | 162.35 MB | 66.77 MB | 66.87 MB |
| after_add_4_compositor_settle_500ms | 516.22 MB | 527.12 MB | 127.43 MB | 128.95 MB | 151.47 MB | 162.35 MB | 66.77 MB | 66.87 MB |
| after_add_4_dom_settle | 516.30 MB | 527.24 MB | 127.43 MB | 128.99 MB | 151.47 MB | 162.35 MB | 66.77 MB | 66.87 MB |
| after_add_4 | 516.17 MB | 527.22 MB | 127.43 MB | 129.01 MB | 151.47 MB | 162.35 MB | 66.77 MB | 66.87 MB |
| before_add_5 | 516.33 MB | 527.13 MB | 127.43 MB | 129.05 MB | 151.47 MB | 162.35 MB | 66.77 MB | 66.87 MB |
| after_add_5_selector_open | 515.81 MB | 527.82 MB | 125.27 MB | 128.13 MB | 151.78 MB | 162.64 MB | 66.83 MB | 66.92 MB |
| after_add_5_selector_search | 516.83 MB | 528.75 MB | 125.68 MB | 128.86 MB | 151.85 MB | 162.88 MB | 66.88 MB | 66.93 MB |
| before_add_5_click | 516.05 MB | 529.02 MB | 125.71 MB | 128.55 MB | 151.58 MB | 162.85 MB | 66.88 MB | 66.93 MB |
| after_add_5_click | 604.32 MB | 615.62 MB | 128.05 MB | 130.34 MB | 236.75 MB | 247.51 MB | 66.88 MB | 66.99 MB |
| after_add_5_click_before_chart_commit | 602.28 MB | 614.94 MB | 127.78 MB | 130.49 MB | 235.85 MB | 246.75 MB | 66.88 MB | 66.99 MB |
| after_add_5_react_commit | 602.68 MB | 614.89 MB | 127.79 MB | 130.74 MB | 235.85 MB | 246.75 MB | 66.88 MB | 66.99 MB |
| after_add_5_store_update | 602.32 MB | 614.97 MB | 127.82 MB | 130.75 MB | 235.61 MB | 246.72 MB | 66.88 MB | 66.99 MB |
| after_add_5_uplot_init | 602.44 MB | 614.95 MB | 127.91 MB | 130.75 MB | 235.61 MB | 246.72 MB | 66.88 MB | 66.99 MB |
| after_add_5_uplot_set_data | 602.29 MB | 615.02 MB | 127.95 MB | 130.78 MB | 235.61 MB | 246.72 MB | 66.82 MB | 66.94 MB |
| after_add_5_first_canvas_paint | 602.41 MB | 614.97 MB | 128 MB | 130.78 MB | 235.61 MB | 246.72 MB | 66.82 MB | 66.94 MB |
| after_add_5_series_ready | 602.45 MB | 615.12 MB | 128.05 MB | 130.79 MB | 235.61 MB | 246.72 MB | 66.82 MB | 66.94 MB |
| after_add_5_compositor_settle_100ms | 602.29 MB | 615.03 MB | 128.09 MB | 130.79 MB | 235.61 MB | 246.72 MB | 66.82 MB | 66.94 MB |
| after_add_5_compositor_settle_500ms | 602.88 MB | 615.07 MB | 128.12 MB | 130.85 MB | 235.65 MB | 246.72 MB | 66.82 MB | 66.97 MB |
| after_add_5_dom_settle | 603.21 MB | 615.04 MB | 128.16 MB | 130.92 MB | 235.65 MB | 246.72 MB | 66.82 MB | 66.97 MB |
| after_add_5 | 603.25 MB | 615.19 MB | 128.21 MB | 130.93 MB | 235.65 MB | 246.72 MB | 66.82 MB | 66.96 MB |
| after_chart_canvas_painted | 610.18 MB | 621.96 MB | 132.80 MB | 135.34 MB | 238.54 MB | 249.10 MB | 66.82 MB | 66.96 MB |
| after_chart_visible | 610.28 MB | 622.01 MB | 132.85 MB | 135.34 MB | 238.53 MB | 248.98 MB | 66.82 MB | 66.96 MB |
| after_chart_ready | 610.15 MB | 621.89 MB | 132.85 MB | 135.34 MB | 238.53 MB | 248.98 MB | 66.82 MB | 66.96 MB |
| before_report_tab | 598 MB | 613.77 MB | 132.88 MB | 135.35 MB | 226.27 MB | 240.72 MB | 66.82 MB | 66.96 MB |
| after_report_tab_open | 620.41 MB | 625.95 MB | 136.42 MB | 138.86 MB | 243.32 MB | 250.62 MB | 68.75 MB | 69.20 MB |
| before_pdf | 620.28 MB | 625.53 MB | 136.52 MB | 138.98 MB | 242.96 MB | 250.10 MB | 68.75 MB | 69.20 MB |
| after_pdf | 616.52 MB | 622.14 MB | 135.93 MB | 137.60 MB | 240.24 MB | 248.02 MB | 69.29 MB | 69.76 MB |
| before_xlsx | 615.30 MB | 621.24 MB | 135.95 MB | 137.57 MB | 238.94 MB | 247.27 MB | 69.29 MB | 69.76 MB |
| after_xlsx | 613.79 MB | 618.17 MB | 136.22 MB | 137.83 MB | 237.24 MB | 244.23 MB | 69.32 MB | 69.80 MB |
| after_gc_hint | 596.58 MB | 606.06 MB | 121.18 MB | 121.22 MB | 236.75 MB | 242.60 MB | 69.22 MB | 69.70 MB |
| after_export_gc_hint | 595.29 MB | 605.66 MB | 121.23 MB | 121.26 MB | 235.68 MB | 242.30 MB | 69.22 MB | 69.70 MB |
| before_route_leave | 595.45 MB | 605.80 MB | 121.29 MB | 121.32 MB | 235.66 MB | 242.29 MB | 69.22 MB | 69.66 MB |
| after_comparison_store_clear | 595.09 MB | 604.93 MB | 120.76 MB | 121.03 MB | 235.72 MB | 242.61 MB | 69.22 MB | 69.66 MB |
| after_route_leave | 603.22 MB | 607.92 MB | 125.34 MB | 125.64 MB | 237.98 MB | 240.51 MB | 69.23 MB | 69.68 MB |
| after_chart_unmount_settle | 599.62 MB | 604.78 MB | 123.59 MB | 123.87 MB | 237.46 MB | 239.12 MB | 69.19 MB | 69.68 MB |
| after_second_gc_hint | 549.15 MB | 589.64 MB | 119.52 MB | 119.95 MB | 187.31 MB | 230.92 MB | 69.19 MB | 69.68 MB |

## App-Owned Renderer Stats

| Phase | JS heap p50 | Series cache p50 | Rust series entries p50 | Rust series cache p50 | Rust series hits p50 | Rust series misses p50 | Cmp raw p50 | Cmp columnar p50 | Parse cache entries p50 | Parse cache points p50 | DOM nodes p50 | Canvas count p50 | Canvas pixels p50 | uPlot count p50 | Cmp page root p50 | Cmp chart root p50 | Cmp chart uPlot p50 | Cmp chart canvas p50 | Cmp report root p50 | Dash chart root p50 | Dash chart uPlot p50 | Dash chart canvas p50 | uPlot init total p50 | Cmp lifecycle active p50 | Cmp lifecycle max active p50 | Cmp lifecycle creates p50 | Cmp lifecycle destroys p50 | Cmp lifecycle setData p50 | Cmp lifecycle setSize p50 | Cmp lifecycle redraws p50 | Cmp lifecycle first paints p50 | Cmp lifecycle events p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| app_start | 8.33 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_setup | 8.40 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_1_dashboard_goto | 8.44 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_dashboard_goto | 8.48 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_1_upload | 8.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_upload | 10.68 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 143 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_1_parse_wait | 11.55 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_parse | 11.69 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_1_save_dialog | 11.73 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_save_dialog_open | 14.95 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 595 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_1_save_commit | 16.25 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 600 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_save_persist | 15.75 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 386 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_save | 15.89 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_post_save_settle | 15.93 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_1_cleanup | 15.97 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_2_dashboard_goto | 9.89 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_dashboard_goto | 9.92 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_2_upload | 9.96 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_upload | 16.03 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_2_parse_wait | 11.89 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_parse | 12.01 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_2_save_dialog | 12.05 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_save_dialog_open | 17.56 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 724 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_2_save_commit | 17.39 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 726 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_save_persist | 24.58 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 512 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_save | 24.71 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_post_save_settle | 24.75 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_2_cleanup | 10.87 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_3_dashboard_goto | 10.87 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_dashboard_goto | 10.92 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_3_upload | 11.03 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 504 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_upload | 18.47 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_3_parse_wait | 14.41 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_parse | 14.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_3_save_dialog | 14.57 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_save_dialog_open | 12.15 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 823 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_3_save_commit | 12.69 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 824 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_save_persist | 12.71 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 680 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_save | 12.88 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_post_save_settle | 12.91 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_3_cleanup | 12.44 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_4_dashboard_goto | 12.48 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_dashboard_goto | 11.21 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_4_upload | 11.24 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 672 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 3.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_upload | 11.93 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_4_parse_wait | 19.62 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_parse | 19.72 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_4_save_dialog | 19.76 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_save_dialog_open | 15.14 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 529 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_4_save_commit | 15.21 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 530 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_save_persist | 14.74 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 386 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_save | 14.79 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_post_save_settle | 14.83 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_4_cleanup | 14.87 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_5_dashboard_goto | 14.91 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_dashboard_goto | 14.95 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_5_upload | 14.92 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 378 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_upload | 19.20 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_5_parse_wait | 14.24 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_parse | 14.12 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_5_save_dialog | 14.16 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_save_dialog_open | 15.06 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 592 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_fixture_5_save_commit | 14.32 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 593 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_save_persist | 13.10 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 449 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_save | 13.24 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_post_save_settle | 13.28 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_fixture_5_cleanup | 13.32 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_setup | 13.36 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_comparison_open | 13.40 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 441 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.70 ms | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_comparison_open | 14.14 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 206 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_add_1 | 14.24 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 206 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_add_1_selector_open | 14.52 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 281 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_add_1_selector_search | 14.78 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 237 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| before_add_1_click | 13.61 MB | 0 B | 0 | 0 B | 0 | 0 | 0 | 0 | 0 | 0 | 237 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_add_1_click | 14.09 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 215 | 0 | 0 B | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| after_add_1_click_before_chart_commit | 14.02 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_react_commit | 14.06 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_store_update | 14.11 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_uplot_init | 14.19 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_uplot_set_data | 14.23 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_first_canvas_paint | 14.28 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_series_ready | 14.33 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_compositor_settle_100ms | 14.37 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_compositor_settle_500ms | 14.41 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1_dom_settle | 14.45 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_1 | 14.49 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| before_add_2 | 14.52 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 247 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_2_selector_open | 11.20 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 278 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_2_selector_search | 11.36 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 278 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| before_add_2_click | 11.44 MB | 28.49 KB | 1 | 65.29 KB | 0 | 1 | 0 | 0 | 0 | 0 | 278 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_2_click | 11.68 MB | 28.49 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 251 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 1 | 0 | 1 | 3 | 1 | 1 | 13 |
| after_add_2_click_before_chart_commit | 12.61 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_react_commit | 12.67 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_store_update | 12.71 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_uplot_init | 12.79 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_uplot_set_data | 12.26 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_first_canvas_paint | 12.23 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_series_ready | 12.34 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_compositor_settle_100ms | 12.39 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_compositor_settle_500ms | 12.43 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2_dom_settle | 12.47 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_2 | 12.50 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| before_add_3 | 12.55 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 261 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_3_selector_open | 12.78 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 292 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_3_selector_search | 12.68 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 292 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| before_add_3_click | 12.40 MB | 96.14 KB | 2 | 220.07 KB | 0 | 2 | 0 | 0 | 0 | 0 | 292 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_3_click | 12.63 MB | 96.14 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 265 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 2 | 1 | 2 | 4 | 1 | 2 | 22 |
| after_add_3_click_before_chart_commit | 13.72 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_react_commit | 13.59 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_store_update | 13.10 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_uplot_init | 13.20 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_uplot_set_data | 13.24 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_first_canvas_paint | 13.29 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_series_ready | 13.34 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_compositor_settle_100ms | 13.38 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_compositor_settle_500ms | 13.42 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3_dom_settle | 13.45 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_3 | 13.50 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| before_add_4 | 13.54 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 275 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_4_selector_open | 13.80 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 306 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_4_selector_search | 13.43 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 306 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| before_add_4_click | 13.48 MB | 162.80 KB | 3 | 372.61 KB | 0 | 3 | 0 | 0 | 0 | 0 | 306 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_4_click | 13.70 MB | 162.80 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 279 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.70 ms | 1 | 1 | 3 | 2 | 3 | 5 | 1 | 3 | 31 |
| after_add_4_click_before_chart_commit | 14.17 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_react_commit | 14.13 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_store_update | 13.49 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_uplot_init | 13.57 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_uplot_set_data | 13.62 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_first_canvas_paint | 13.68 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_series_ready | 13.73 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_compositor_settle_100ms | 13.79 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_compositor_settle_500ms | 13.83 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4_dom_settle | 13.88 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_4 | 13.92 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| before_add_5 | 13.95 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 289 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_5_selector_open | 14.18 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 320 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_5_selector_search | 14.37 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 320 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| before_add_5_click | 13.81 MB | 205.57 KB | 4 | 659.14 KB | 0 | 4 | 0 | 0 | 0 | 0 | 320 | 2 | 2.34 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 6 | 1 | 4 | 40 |
| after_add_5_click | 14.28 MB | 205.57 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 293 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 4 | 3 | 4 | 7 | 1 | 4 | 42 |
| after_add_5_click_before_chart_commit | 14.30 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_react_commit | 14.21 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_store_update | 14.25 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_uplot_init | 14.34 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_uplot_set_data | 14.39 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_first_canvas_paint | 14.44 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_series_ready | 14.48 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_compositor_settle_100ms | 14.54 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_compositor_settle_500ms | 14.58 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5_dom_settle | 14.62 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_add_5 | 14.66 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_chart_canvas_painted | 16.99 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_chart_visible | 17.05 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_chart_ready | 17.02 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| before_report_tab | 16.93 MB | 258.95 KB | 5 | 766.03 KB | 0 | 5 | 0 | 0 | 0 | 0 | 303 | 2 | 2.29 MB | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.50 ms | 1 | 1 | 5 | 4 | 5 | 8 | 1 | 5 | 51 |
| after_report_tab_open | 17.99 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 272 | 0 | 0 B | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | n/a | 0 | 1 | 5 | 5 | 5 | 8 | 1 | 5 | 53 |
| before_pdf | 18.18 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 6 | 5 | 6 | 11 | 2 | 6 | 66 |
| after_pdf | 18.14 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 6 | 5 | 6 | 11 | 2 | 6 | 66 |
| before_xlsx | 18.19 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 6 | 5 | 6 | 11 | 2 | 6 | 66 |
| after_xlsx | 18.37 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 6 | 5 | 6 | 11 | 2 | 6 | 66 |
| after_gc_hint | 11.50 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 6 | 5 | 6 | 11 | 2 | 6 | 66 |
| after_export_gc_hint | 11.56 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 6 | 5 | 6 | 11 | 2 | 6 | 66 |
| before_route_leave | 11.60 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 312 | 2 | 1.65 MB | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0.60 ms | 1 | 1 | 6 | 5 | 6 | 11 | 2 | 6 | 66 |
| after_comparison_store_clear | 11.73 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 215 | 0 | 0 B | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | n/a | 0 | 1 | 6 | 6 | 6 | 11 | 2 | 6 | 68 |
| after_route_leave | 11.92 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 307 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.60 ms | 0 | 1 | 6 | 6 | 6 | 11 | 2 | 6 | 68 |
| after_chart_unmount_settle | 12.32 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 453 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.60 ms | 0 | 1 | 6 | 6 | 6 | 11 | 2 | 6 | 68 |
| after_second_gc_hint | 11.18 MB | 517.89 KB | 5 | 766.03 KB | 5 | 5 | 0 | 0 | 0 | 0 | 453 | 1 | 2.68 MB | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0.60 ms | 0 | 1 | 6 | 6 | 6 | 11 | 2 | 6 | 68 |

## P50 Deltas

| Delta | Total | Renderer | GPU | Tauri |
| --- | ---: | ---: | ---: | ---: |
| after_add_5_selector_search -> after_add_5_click | 87.49 MB | 2.37 MB | 84.90 MB | 0 MB |
| after_add_5_click -> after_add_5_uplot_init | -1.88 MB | -0.14 MB | -1.14 MB | 0 MB |
| after_add_5_uplot_init -> after_add_5_first_canvas_paint | -0.03 MB | 0.09 MB | 0 MB | -0.06 MB |
| after_add_5_first_canvas_paint -> after_add_5_compositor_settle_500ms | 0.47 MB | 0.12 MB | 0.04 MB | 0 MB |
| after_fixture_5_cleanup -> after_add_5 | 79.77 MB | 0.08 MB | 74.61 MB | 1.46 MB |
| after_add_5 -> after_chart_canvas_painted | 6.93 MB | 4.59 MB | 2.89 MB | 0 MB |
| after_xlsx - after_export_gc_hint | 18.50 MB | 14.99 MB | 1.56 MB | 0.10 MB |
| after_export_gc_hint - after_route_leave | -7.93 MB | -4.11 MB | -2.30 MB | -0.01 MB |
| after_route_leave - after_chart_visible | -7.06 MB | -7.51 MB | -0.55 MB | 2.41 MB |

## Readout

- `after_xlsx - after_export_gc_hint` estimates reclaimable post-export RSS
  after product-side buffer cleanup plus a diagnostic GC hint.
- `after_export_gc_hint - after_route_leave` shows whether navigation releases
  additional app-controlled state. Near-zero renderer deltas here suggest the
  remaining RSS is mostly WebView2/runtime retention.
- `after_route_leave - after_chart_visible` should not be interpreted as a
  leak by itself; WebView2/GPU memory may shift across phases and processes.

