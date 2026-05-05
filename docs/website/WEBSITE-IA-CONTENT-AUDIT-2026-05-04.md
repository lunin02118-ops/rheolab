# Website IA / Content Audit - 2026-05-04

Target: local website at `http://127.0.0.1:4321/`.

Context: user feedback on 2026-05-04 says the site still does not feel cohesive, top tabs navigate to separate pages, and the useful product value is concentrated on the homepage. The user also clarified the real core value:

1. file recognition/import from rheometer exports;
2. local experiment database;
3. comparison of analyses/experiments;
4. calculations on raw data using a unified method, excluding differences in each rheometer's own settings/calculation logic.

## Executive Verdict

The site should be treated as a one-page product landing page with secondary support pages, not as a multi-page marketing/documentation website.

Current issue is not just visual style. It is information architecture:

- the header makes `FAQ` and `О компании` look as important as product value;
- `О компании` actually describes the product, not the company;
- docs/instructions are unlikely to be read before download and should move to video/support materials;
- separate top-level pages create a feeling of transition to another section rather than one coherent product story;
- the strongest value proposition is hidden inside several blocks instead of being stated as four clear product capabilities.

Recommended direction:

- keep `/` as the primary public route;
- make top navigation mostly anchor-based inside `/`;
- remove `FAQ` and `О компании` from the main nav;
- keep FAQ/docs/legal pages as secondary footer/support/SEO pages;
- rewrite the homepage around four concrete capabilities.

## Current Navigation Problem

Current top nav:

| Item | Current target | Audit |
|---|---|---|
| `Возможности` | `/#features` | Useful, but section content is too broad and workflow-like. |
| `FAQ` | `/faq` | Not primary for first-time visitors; should not be a top tab. |
| `О компании` | `/about` | Misleading: page explains the product more than the company. |
| `Контакты` | `/#contact` | Useful. |
| `Скачать` | `/download/latest` | Correct primary CTA. |

Primary problem: top nav mixes page transitions and in-page anchors. This makes the site feel fragmented.

## Recommended Top Navigation

Use a minimal one-page nav:

```text
RheoLab Enterprise | Возможности | Как работает | Видео | Контакты | Скачать
```

Alternative, even tighter:

```text
RheoLab Enterprise | Возможности | Скачать | Контакты
```

Recommendation: use the tighter version for alpha. Add `Видео` only when actual video materials are present. Do not show a permanent "Видео" nav item while the section is still placeholders.

Secondary links should move to footer:

- FAQ;
- документация;
- политика конфиденциальности;
- условия использования;
- support email.

## What To Do With Existing Pages

| Page | Keep? | Navigation placement | Reason |
|---|---:|---|---|
| `/` | Yes | primary | Main conversion page. |
| `/faq` | Yes | footer/support only | Useful after user has questions, not a top-level tab. |
| `/about` | Hide from nav or rewrite | footer only if rewritten | Current content is about product, not company. |
| `/docs/*` | Keep | footer/support/video links | Good for support/SEO, not first path. |
| `/download/latest` | Yes | CTA | Should visually remain in same brand shell. |
| `/privacy`, `/terms` | Yes | footer/legal | Required support pages. |

## Homepage Content Recommendation

The homepage should be rebuilt around four capabilities, not generic problem cards.

### Hero

Goal: immediately say what the product does.

Possible headline:

```text
Единая база и сравнение реологических экспериментов
```

Possible subheadline:

```text
RheoLab Enterprise импортирует файлы разных реометров, приводит данные к единому виду, хранит результаты локально и считает параметры по сырым данным по единой методике.
```

Primary CTA:

```text
Скачать для Windows
```

Secondary CTA:

```text
Написать нам
```

Avoid making the H1 too long. The current H1 is credible, but visually heavy and hard to scan.

### Main Capabilities Section

Replace the current broad workflow framing with four direct cards/blocks:

| Capability | Message |
|---|---|
| Распознавание файлов | Открывает `.xls`, `.xlsx`, `.csv`, `.txt`, `.dat`; поддерживает Grace, Chandler, Fann, OFITE, BSL-R1, Brookfield; приводит названия, единицы и ряды к единой структуре. |
| Локальная база данных | Сохраняет эксперименты в локальную библиотеку, позволяет искать, повторно открывать и не терять результаты после первого просмотра. |
| Сравнение экспериментов | Накладывает несколько анализов на общие оси: вязкость, температура, давление, скорость, скорость/напряжение сдвига. |
| Расчёты по единой методике | Считает параметры на сырых данных по унифицированной логике, чтобы сравнение не зависело от настроек конкретного реометра. |

This should become the core "Возможности" section.

### Workflow Section

Keep, but compress:

```text
1. Импортируйте файл
2. Проверьте график и расчёты
3. Сохраните в базу
4. Сравните серии или выгрузите отчёт
```

This section should support the capability cards, not duplicate them.

### Videos Section

Keep as future support, but reduce prominence until actual videos exist.

Recommended video topics:

- первый импорт файла;
- работа с базой экспериментов;
- сравнение нескольких анализов;
- расчёт параметров по сырым данным;
- экспорт отчёта.

Once videos exist, docs/instructions can move behind "Видео" and footer support links.

### About Section

Do not keep the current `/about` in main navigation.

If an "about" section is needed on the homepage, make it a short credibility strip:

```text
RheoLab создаётся инженерами, работавшими с лабораторной реометрией и BSL-R1. Фокус продукта — практическая обработка, сравнение и хранение данных экспериментов.
```

Do not make it a full top-level page unless there is real company content:

- юридическое лицо;
- команда;
- история;
- партнёры;
- контакты;
- реквизиты.

## Content To Remove Or De-prioritize

Recommended removals from primary path:

- long FAQ as top-level navigation;
- "О компании" top nav;
- generic pain cards if they duplicate the capability blocks;
- placeholder-heavy video cards above core product content;
- deep docs links before the user has downloaded/tried the app.

Recommended to keep but move lower/footer:

- FAQ;
- docs;
- privacy/terms;
- detailed setup instructions.

## Proposed One-Page Structure

Recommended alpha structure:

1. Header:
   - logo;
   - `Возможности`;
   - `Скачать`;
   - `Контакты`;
   - CTA `Скачать`.
2. Hero:
   - shorter product headline;
   - one paragraph with the four core values;
   - app screenshot/mockup;
   - Windows download CTA.
3. Four capabilities:
   - files/import;
   - database;
   - comparison;
   - unified raw-data calculations.
4. How it works:
   - import -> calculate -> save -> compare/report.
5. Supported instruments/formats:
   - compact strip/table.
6. Video materials:
   - only if real videos or clear "coming soon" below the fold.
7. Download/contact.
8. Footer:
   - FAQ, docs, legal, support email.

## Implementation Plan

### Sprint 1 - IA Cleanup

1. Change `website/src/components/site/Navbar.astro`:
   - remove `FAQ` and `О компании`;
   - keep only one-page anchors and download CTA.
2. Update footer:
   - move FAQ/docs/about/legal links there.
3. Keep `/faq` and `/about` routes for now, but remove them from the primary user path.

Acceptance:

- header no longer sends users to secondary pages except download;
- top navigation feels like one product screen.

### Sprint 2 - Rewrite Core Homepage

1. Rewrite `Hero.astro` with a shorter headline and explicit four-value subheadline.
2. Replace or refactor `Features.astro` into four product capability blocks:
   - recognition/import;
   - local database;
   - comparison;
   - unified calculations from raw data.
3. Compress `Pains.astro` or remove it if it duplicates the new capability section.

Acceptance:

- a first-time visitor understands the product in 10 seconds;
- "Возможности" matches the real application value.

### Sprint 3 - Secondary Content

1. Keep FAQ/docs as support pages.
2. Replace instruction-heavy docs emphasis with video material links once videos exist.
3. Rewrite `/about` or demote it to a short footer-only page.

Acceptance:

- no placeholder/instruction content competes with the product story.

## Recommended Decision

GO: convert the site into a one-page alpha landing page with secondary support routes.

NO-GO: keep the current top-level nav with `FAQ` and `О компании` as equal tabs.

NO-GO: build more documentation pages before the core product page is clear.

The next practical code change should be:

```text
feat(website): simplify navigation and refocus homepage capabilities
```

with scope limited to `website/src/components/site/*`, `website/src/pages/index.astro`, and footer links.
