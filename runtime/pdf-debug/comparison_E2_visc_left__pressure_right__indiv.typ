
#set page(paper: "a4", margin: (x: 28pt, y: 30pt))
#set text(font: "Roboto", size: 7pt, fill: rgb("#334155"))

// --- Styles ---
#let section_header(title) = block(
  fill: rgb("#F1F5F9"),
  width: 100%,
  inset: 6pt,
  radius: 2pt,
  text(weight: "bold", fill: rgb("#1E293B"), size: 9pt)[#title]
)

#let label(content) = text(fill: rgb("#64748B"), size: 8pt)[#content]
#let val(content) = text(fill: rgb("#0F172A"), size: 8pt, weight: "medium")[#content]

#let header_cell(content) = block(
  width: 100%,
  inset: (x: 4pt, y: 8pt),
  align(center + horizon)[
    #text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[#content]
  ]
)

// Smaller muted text for unit labels inside header cells
#let unit_text(u) = text(size: 6pt, weight: "regular", fill: rgb("#64748B"))[#u]

#let cell(content) = block(
  inset: 4pt,
  align(left + horizon)[
    #text(size: 7.5pt, weight: "regular", fill: rgb("#334155"))[#content]
  ]
)

// --- Global Layout & Definitions ---
#let report_header = {
  v(15pt)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    stack(dir: ltr, spacing: 10pt,
      none,
      align(horizon)[#text(size: 18pt, weight: "bold", fill: rgb("#0F172A"))[RheoLab Enterprise]]
    ),
    align(right)[
      #text(size: 8pt, fill: rgb("#64748B"))[Отчет о тестировании жидкости ГРП]\
      #text(size: 8pt, fill: rgb("#64748B"))[ID: T-146]
    ]
  )
  v(8pt)
  line(length: 100%, stroke: 1pt + rgb("#CBD5E1"))
  v(7pt)
}

#let report_footer = grid(
  columns: (1fr, 1fr, 1fr),
  align: (left, center, right),
  text(size: 7pt, fill: rgb("#94a3b8"))[RheoLab Enterprise],
  text(size: 7pt, fill: rgb("#94a3b8"))[Сгенерировано: -],
  text(size: 7pt, fill: rgb("#94a3b8"))[Страница #counter(page).display() / 6]
)

#set page(
  paper: "a4",
  margin: (top: 3.5cm, bottom: 2cm, x: 1cm),
  header: report_header,
  footer: report_footer
)

#page(paper: "a4", flipped: true, margin: (top: 2.5cm, bottom: 1.2cm, left: 57pt, right: 57pt))[
    #set par(spacing: 0pt)
    #set block(spacing: 0pt)
    // Chart SVG with side labels and ticks
    #block(width: 100%)[
        #image("comparison_chart.svg", width: 100%)

        // Ticks + axis titles overlay (generated per-axis, anchored via % of SVG width)
        #place(top + left, dy: 382.8pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[-200]]]]
#place(top + left, dy: 360.4pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[0]]]]
#place(top + left, dy: 338.0pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[200]]]]
#place(top + left, dy: 315.6pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[400]]]]
#place(top + left, dy: 293.2pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[600]]]]
#place(top + left, dy: 270.8pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[800]]]]
#place(top + left, dy: 248.4pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[1000]]]]
#place(top + left, dy: 226.0pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[1200]]]]
#place(top + left, dy: 203.6pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[1400]]]]
#place(top + left, dy: 181.2pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[1600]]]]
#place(top + left, dy: 158.8pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[1800]]]]
#place(top + left, dy: 136.4pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[2000]]]]
#place(top + left, dy: 114.0pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[2200]]]]
#place(top + left, dy: 91.6pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[2400]]]]
#place(top + left, dy: 69.2pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[2600]]]]
#place(top + left, dy: 46.8pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[2800]]]]
#place(top + left, dy: 24.4pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[3000]]]]
#place(top + left, dy: 2.0pt, dx: -21.2pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: rgb(59, 130, 246))[3200]]]]
#place(top + left, dy: 192.4pt, dx: -171.2pt)[#rotate(-90deg)[#box(width: 300pt, height: 10pt)[#align(center)[#text(size: 9pt, weight: "bold", fill: rgb(59, 130, 246))[Вязкость (mPa·s)]]]]]#linebreak()
#place(top + left, dy: 382.8pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[0]]]]
#place(top + left, dy: 359.0pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[5]]]]
#place(top + left, dy: 335.2pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[10]]]]
#place(top + left, dy: 311.4pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[15]]]]
#place(top + left, dy: 287.6pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[20]]]]
#place(top + left, dy: 263.8pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[25]]]]
#place(top + left, dy: 240.0pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[30]]]]
#place(top + left, dy: 216.2pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[35]]]]
#place(top + left, dy: 192.4pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[40]]]]
#place(top + left, dy: 168.6pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[45]]]]
#place(top + left, dy: 144.8pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[50]]]]
#place(top + left, dy: 121.0pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[55]]]]
#place(top + left, dy: 97.2pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[60]]]]
#place(top + left, dy: 73.4pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[65]]]]
#place(top + left, dy: 49.6pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[70]]]]
#place(top + left, dy: 25.8pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[75]]]]
#place(top + left, dy: 2.0pt, dx: 727.2pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: rgb(147, 51, 234))[80]]]]
#place(top + left, dy: 192.4pt, dx: 599.2pt)[#rotate(90deg)[#box(width: 300pt, height: 10pt)[#align(center)[#text(size: 9pt, weight: "bold", fill: rgb(147, 51, 234))[Давление (bar)]]]]]#linebreak()
#place(top + left, dx: 7.0pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 7.0pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[0]]]]
#place(top + left, dx: 108.8pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 108.8pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[100]]]]
#place(top + left, dx: 210.6pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 210.6pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[200]]]]
#place(top + left, dx: 312.3pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 312.3pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[300]]]]
#place(top + left, dx: 414.1pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 414.1pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[400]]]]
#place(top + left, dx: 515.9pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 515.9pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[500]]]]
#place(top + left, dx: 617.7pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 617.7pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[600]]]]
#place(top + left, dx: 719.5pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + rgb(51, 65, 85))]
#place(top + left, dx: 719.5pt, dy: 401.8pt)[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: rgb(51, 65, 85))[700]]]]
#place(top + left, dx: 27.4pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 47.7pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 68.1pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 88.4pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 129.1pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 149.5pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 169.9pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 190.2pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 230.9pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 251.3pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 271.6pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 292.0pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 332.7pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 353.1pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 373.4pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 393.8pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 434.5pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 454.8pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 475.2pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 495.6pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 536.3pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 556.6pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 577.0pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 597.3pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 638.0pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 658.4pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 678.8pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]
#place(top + left, dx: 699.1pt, dy: 394.8pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]

    ]
    #v(12pt)
    #align(center)[#text(size: 9pt, weight: "bold", fill: rgb(51, 65, 85))[Время (мин)]]
    // ~5 mm spacer between the bottom axis label and the legend box
    #v(16pt)
    // Legend
    #align(center)[
        #block(stroke: 0.5pt + gray, inset: 3pt, radius: 3pt, fill: white)[
            #text(size: 8pt)[#box(baseline: -1pt)[#line(length: 18pt, stroke: 2pt + rgb(30, 144, 255))] #h(3pt) [\[Отчёт Grace \#146 (09.01.2027)\]] #h(12pt) #box(baseline: -1pt)[#line(length: 18pt, stroke: 2pt + rgb(255, 0, 0))] #h(3pt) [\[Отчёт Chandler \#296 (09.01.2027)\]] #h(12pt) #box(baseline: -1pt)[#line(length: 18pt, stroke: 2pt + rgb(0, 128, 0))] #h(3pt) [\[8958 SWB Mamontovskoe\_(lake\_274\_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)\@96C 30.10.25 \#482 (09.01.2027)\]] #h(12pt) #box(baseline: -1pt)[#line(length: 18pt, stroke: 2pt + rgb(128, 0, 128))] #h(3pt) [\[3.8\_2.0\_1.0\_41C(7801\_78)+18BorCat+RCP BorProp(con1000) \#56 (09.01.2027)\]]]
        ]
    ]
]

#pagebreak()
#page(paper: "a4", flipped: false, margin: (top: 2.5cm, bottom: 1.2cm, left: 2cm, right: 2cm))[

#text(size: 14pt, weight: "bold", fill: rgb("#0F172A"))[Сравнение экспериментов]
#v(12pt)

#section_header("Сводная таблица")
#v(8pt)

#table(
  columns: (2.8fr, 0.9fr, 1.3fr, 1.5fr, 1.5fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  table.header(
    header_cell[Эксперимент],
    header_cell[Точек],
    header_cell[Длительность (мин)],
    header_cell[Макс. вязкость],
    header_cell[Финал. вязкость]
  ),
  [\[Отчёт Grace \#146 (09.01.2027)\]], [360], [179.5], [3005.1 mPa·s], [94.4 mPa·s],
  [\[Отчёт Chandler \#296 (09.01.2027)\]], [300], [149.5], [2305.1 mPa·s], [50.0 mPa·s],
  [\[8958 SWB Mamontovskoe\_(lake\_274\_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)\@96C 30.10.25 \#482 (09.01.2027)\]], [216], [107.5], [2255.1 mPa·s], [50.0 mPa·s],
  [\[3.8\_2.0\_1.0\_41C(7801\_78)+18BorCat+RCP BorProp(con1000) \#56 (09.01.2027)\]], [1404], [701.5], [906.9 mPa·s], [98.1 mPa·s],

)


#v(10pt)
#section_header("Точки касания (порог 400 mPa·s)")
#v(5pt)
#table(
  columns: (3fr, 1fr, 1.2fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  table.header(
    header_cell[Название теста],
    header_cell[Время (мин)],
    header_cell[Вязкость (mPa·s)]
  ),
  [\[Отчёт Grace \#146 (09.01.2027)\]], [154.5], [140],
  [\[Отчёт Chandler \#296 (09.01.2027)\]], [60.5], [399],
  [\[8958 SWB Mamontovskoe\_(lake\_274\_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)\@96C 30.10.25 \#482 (09.01.2027)\]], [44.5], [400],
  [\[3.8\_2.0\_1.0\_41C(7801\_78)+18BorCat+RCP BorProp(con1000) \#56 (09.01.2027)\]], [353.0], [284],

)

#v(10pt)
#section_header("Вязкость в заданное время (60 мин)")
#v(5pt)
#table(
  columns: (3fr, 1fr, 1.2fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  table.header(
    header_cell[Название теста],
    header_cell[Время (мин)],
    header_cell[Вязкость (mPa·s)]
  ),
  [\[Отчёт Grace \#146 (09.01.2027)\]], [60.0], [936],
  [\[Отчёт Chandler \#296 (09.01.2027)\]], [60.0], [406],
  [\[8958 SWB Mamontovskoe\_(lake\_274\_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)\@96C 30.10.25 \#482 (09.01.2027)\]], [60.0], [227],
  [\[3.8\_2.0\_1.0\_41C(7801\_78)+18BorCat+RCP BorProp(con1000) \#56 (09.01.2027)\]], [60.0], [753],

)

]

#pagebreak()

// --- Page 1 Content ---
#v(-20pt)
#grid(
  columns: (1fr, 1.4fr),
  column-gutter: 24pt,
  row-gutter: 20pt,
  align: top + left,

  // -- Row 1 Left: Passport + Calibration --
  [
    #section_header("Паспорт теста")
    #v(5pt)
    #grid(
      columns: (85pt, 1fr),
      row-gutter: 8pt,
      label[ID / Файл:], val[T-146.dat],
      label[Дата:], val[-],
      label[Оператор:], val[-],
      label[Лаборатория:],  val[-],
      label[Месторождение:], val[-],
      label[Скважина:], val[-],
      label[Прибор:], val[-],
    )
    #v(20pt)
    
  ],

  // -- Row 1 Right: Recipe --
  [
    #section_header("Рецептура жидкости")
    #v(5pt)
    #table(
      columns: (2.2fr, 1.2fr, 1.6fr, 0.8fr, 0.8fr),
      stroke: 0.5pt + rgb("#E2E8F0"),
      fill: none,
      table.header(
        header_cell[Наименование],
        header_cell[Лот.номер],
        header_cell[Тип\ реагента],
        header_cell[ЕИ],
        header_cell[Конц.]
      ),
     
    )
  ],

  // -- Row 2 Left: Water Analysis --
  [
    #section_header("Анализ воды")
    #v(5pt)
    #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[Источник воды: -]
    #v(5pt)
    #table(
       columns: (1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
       align: center + horizon,
       stroke: 0.5pt + rgb("#E2E8F0"),
       fill: (_, y) => if y == 1 { rgb("#F8FAFC") } else { none },
       [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[pH]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Fe]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Ca]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Mg]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Cl]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[SO4]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[HCO3]], 
       [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[ед.]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], 
       [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], 
    )
  ],

  // -- Row 2 Right: Touch Points --
  [
    
  ]
)

#v(25pt)

// --- Statistics ---
#section_header("Реологическая статистика")
#v(5pt)



#show table.cell.where(y: 0): it => header_cell(it.body)
#set text(size: 6.5pt, weight: "regular", fill: rgb("#334155"))

#table(
  columns: (0.5fr, 0.8fr, 0.8fr, 0.8fr, 0.8fr, 1fr, 0.9fr, 0.9fr, 0.8fr, 1fr, 1fr, 1fr, 1.1fr, 1.1fr, 0.8fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,

  table.header(
    header_cell[Цикл], header_cell[Время\ #unit_text[(мин)]], header_cell[T\ #unit_text[(°C)]], header_cell[P\ #unit_text[(bar)]], header_cell[n'], header_cell[K'\ #unit_text[(Pa·s^n)]], header_cell[Ks\ #unit_text[(Pa·s^n)]], header_cell[Kp\ #unit_text[(Pa·s^n)]], header_cell[R²], header_cell[η\@40 #unit_text[(mPa·s)]], header_cell[η\@100 #unit_text[(mPa·s)]], header_cell[η\@170 #unit_text[(mPa·s)]], header_cell[PV\ #unit_text[(Pa·s)]], header_cell[YP\ #unit_text[(Pa)]], header_cell[R²B]
  ),
  
)






#pagebreak()

// --- Page 1 Content ---
#v(-20pt)
#grid(
  columns: (1fr, 1.4fr),
  column-gutter: 24pt,
  row-gutter: 20pt,
  align: top + left,

  // -- Row 1 Left: Passport + Calibration --
  [
    #section_header("Паспорт теста")
    #v(5pt)
    #grid(
      columns: (85pt, 1fr),
      row-gutter: 8pt,
      label[ID / Файл:], val[T-296.dat],
      label[Дата:], val[-],
      label[Оператор:], val[-],
      label[Лаборатория:],  val[-],
      label[Месторождение:], val[-],
      label[Скважина:], val[-],
      label[Прибор:], val[-],
    )
    #v(20pt)
    
  ],

  // -- Row 1 Right: Recipe --
  [
    #section_header("Рецептура жидкости")
    #v(5pt)
    #table(
      columns: (2.2fr, 1.2fr, 1.6fr, 0.8fr, 0.8fr),
      stroke: 0.5pt + rgb("#E2E8F0"),
      fill: none,
      table.header(
        header_cell[Наименование],
        header_cell[Лот.номер],
        header_cell[Тип\ реагента],
        header_cell[ЕИ],
        header_cell[Конц.]
      ),
     
    )
  ],

  // -- Row 2 Left: Water Analysis --
  [
    #section_header("Анализ воды")
    #v(5pt)
    #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[Источник воды: -]
    #v(5pt)
    #table(
       columns: (1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
       align: center + horizon,
       stroke: 0.5pt + rgb("#E2E8F0"),
       fill: (_, y) => if y == 1 { rgb("#F8FAFC") } else { none },
       [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[pH]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Fe]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Ca]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Mg]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Cl]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[SO4]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[HCO3]], 
       [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[ед.]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], 
       [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], 
    )
  ],

  // -- Row 2 Right: Touch Points --
  [
    
  ]
)

#v(25pt)

// --- Statistics ---
#section_header("Реологическая статистика")
#v(5pt)



#show table.cell.where(y: 0): it => header_cell(it.body)
#set text(size: 6.5pt, weight: "regular", fill: rgb("#334155"))

#table(
  columns: (0.5fr, 0.8fr, 0.8fr, 0.8fr, 0.8fr, 1fr, 0.9fr, 0.9fr, 0.8fr, 1fr, 1fr, 1fr, 1.1fr, 1.1fr, 0.8fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,

  table.header(
    header_cell[Цикл], header_cell[Время\ #unit_text[(мин)]], header_cell[T\ #unit_text[(°C)]], header_cell[P\ #unit_text[(bar)]], header_cell[n'], header_cell[K'\ #unit_text[(Pa·s^n)]], header_cell[Ks\ #unit_text[(Pa·s^n)]], header_cell[Kp\ #unit_text[(Pa·s^n)]], header_cell[R²], header_cell[η\@40 #unit_text[(mPa·s)]], header_cell[η\@100 #unit_text[(mPa·s)]], header_cell[η\@170 #unit_text[(mPa·s)]], header_cell[PV\ #unit_text[(Pa·s)]], header_cell[YP\ #unit_text[(Pa)]], header_cell[R²B]
  ),
  
)






#pagebreak()

// --- Page 1 Content ---
#v(-20pt)
#grid(
  columns: (1fr, 1.4fr),
  column-gutter: 24pt,
  row-gutter: 20pt,
  align: top + left,

  // -- Row 1 Left: Passport + Calibration --
  [
    #section_header("Паспорт теста")
    #v(5pt)
    #grid(
      columns: (85pt, 1fr),
      row-gutter: 8pt,
      label[ID / Файл:], val[T-482.dat],
      label[Дата:], val[-],
      label[Оператор:], val[-],
      label[Лаборатория:],  val[-],
      label[Месторождение:], val[-],
      label[Скважина:], val[-],
      label[Прибор:], val[-],
    )
    #v(20pt)
    
  ],

  // -- Row 1 Right: Recipe --
  [
    #section_header("Рецептура жидкости")
    #v(5pt)
    #table(
      columns: (2.2fr, 1.2fr, 1.6fr, 0.8fr, 0.8fr),
      stroke: 0.5pt + rgb("#E2E8F0"),
      fill: none,
      table.header(
        header_cell[Наименование],
        header_cell[Лот.номер],
        header_cell[Тип\ реагента],
        header_cell[ЕИ],
        header_cell[Конц.]
      ),
     
    )
  ],

  // -- Row 2 Left: Water Analysis --
  [
    #section_header("Анализ воды")
    #v(5pt)
    #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[Источник воды: -]
    #v(5pt)
    #table(
       columns: (1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
       align: center + horizon,
       stroke: 0.5pt + rgb("#E2E8F0"),
       fill: (_, y) => if y == 1 { rgb("#F8FAFC") } else { none },
       [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[pH]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Fe]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Ca]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Mg]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Cl]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[SO4]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[HCO3]], 
       [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[ед.]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], 
       [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], 
    )
  ],

  // -- Row 2 Right: Touch Points --
  [
    
  ]
)

#v(25pt)

// --- Statistics ---
#section_header("Реологическая статистика")
#v(5pt)



#show table.cell.where(y: 0): it => header_cell(it.body)
#set text(size: 6.5pt, weight: "regular", fill: rgb("#334155"))

#table(
  columns: (0.5fr, 0.8fr, 0.8fr, 0.8fr, 0.8fr, 1fr, 0.9fr, 0.9fr, 0.8fr, 1fr, 1fr, 1fr, 1.1fr, 1.1fr, 0.8fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,

  table.header(
    header_cell[Цикл], header_cell[Время\ #unit_text[(мин)]], header_cell[T\ #unit_text[(°C)]], header_cell[P\ #unit_text[(bar)]], header_cell[n'], header_cell[K'\ #unit_text[(Pa·s^n)]], header_cell[Ks\ #unit_text[(Pa·s^n)]], header_cell[Kp\ #unit_text[(Pa·s^n)]], header_cell[R²], header_cell[η\@40 #unit_text[(mPa·s)]], header_cell[η\@100 #unit_text[(mPa·s)]], header_cell[η\@170 #unit_text[(mPa·s)]], header_cell[PV\ #unit_text[(Pa·s)]], header_cell[YP\ #unit_text[(Pa)]], header_cell[R²B]
  ),
  
)






#pagebreak()

// --- Page 1 Content ---
#v(-20pt)
#grid(
  columns: (1fr, 1.4fr),
  column-gutter: 24pt,
  row-gutter: 20pt,
  align: top + left,

  // -- Row 1 Left: Passport + Calibration --
  [
    #section_header("Паспорт теста")
    #v(5pt)
    #grid(
      columns: (85pt, 1fr),
      row-gutter: 8pt,
      label[ID / Файл:], val[T-56.dat],
      label[Дата:], val[-],
      label[Оператор:], val[-],
      label[Лаборатория:],  val[-],
      label[Месторождение:], val[-],
      label[Скважина:], val[-],
      label[Прибор:], val[-],
    )
    #v(20pt)
    
  ],

  // -- Row 1 Right: Recipe --
  [
    #section_header("Рецептура жидкости")
    #v(5pt)
    #table(
      columns: (2.2fr, 1.2fr, 1.6fr, 0.8fr, 0.8fr),
      stroke: 0.5pt + rgb("#E2E8F0"),
      fill: none,
      table.header(
        header_cell[Наименование],
        header_cell[Лот.номер],
        header_cell[Тип\ реагента],
        header_cell[ЕИ],
        header_cell[Конц.]
      ),
     
    )
  ],

  // -- Row 2 Left: Water Analysis --
  [
    #section_header("Анализ воды")
    #v(5pt)
    #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[Источник воды: -]
    #v(5pt)
    #table(
       columns: (1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
       align: center + horizon,
       stroke: 0.5pt + rgb("#E2E8F0"),
       fill: (_, y) => if y == 1 { rgb("#F8FAFC") } else { none },
       [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[pH]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Fe]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Ca]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Mg]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[Cl]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[SO4]], [#text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[HCO3]], 
       [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[ед.]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], [#text(weight: "regular", fill: rgb("#64748B"), size: 7pt)[мг/л]], 
       [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], [#text(weight: "regular", fill: rgb("#0F172A"), size: 7.5pt)[-]], 
    )
  ],

  // -- Row 2 Right: Touch Points --
  [
    
  ]
)

#v(25pt)

// --- Statistics ---
#section_header("Реологическая статистика")
#v(5pt)



#show table.cell.where(y: 0): it => header_cell(it.body)
#set text(size: 6.5pt, weight: "regular", fill: rgb("#334155"))

#table(
  columns: (0.5fr, 0.8fr, 0.8fr, 0.8fr, 0.8fr, 1fr, 0.9fr, 0.9fr, 0.8fr, 1fr, 1fr, 1fr, 1.1fr, 1.1fr, 0.8fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,

  table.header(
    header_cell[Цикл], header_cell[Время\ #unit_text[(мин)]], header_cell[T\ #unit_text[(°C)]], header_cell[P\ #unit_text[(bar)]], header_cell[n'], header_cell[K'\ #unit_text[(Pa·s^n)]], header_cell[Ks\ #unit_text[(Pa·s^n)]], header_cell[Kp\ #unit_text[(Pa·s^n)]], header_cell[R²], header_cell[η\@40 #unit_text[(mPa·s)]], header_cell[η\@100 #unit_text[(mPa·s)]], header_cell[η\@170 #unit_text[(mPa·s)]], header_cell[PV\ #unit_text[(Pa·s)]], header_cell[YP\ #unit_text[(Pa)]], header_cell[R²B]
  ),
  
)





