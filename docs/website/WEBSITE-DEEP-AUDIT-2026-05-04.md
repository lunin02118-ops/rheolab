# Website Deep Audit - 2026-05-04

Audited target: `website/` Astro site, local dev server `http://127.0.0.1:4321`, plus live scroll profile for `https://rheolab.site`.

## Executive Verdict

The website is technically buildable and fast enough for an alpha/beta public surface, but it does not feel like one coherent product site yet.

The main issue is not a single CSS bug. The site currently contains two parallel visual systems:

- New product site system: `SiteLayout`, `components/site/*`, used by `/`, `/faq`, `/about`, `/team`.
- Legacy/global system: `Layout`, `components/*`, used by `/docs/*`, `/privacy`, `/terms`.
- Standalone download page: `/download/latest`, no shared site shell/header/footer.

This is why navigation between "tabs" or top-level sections feels broken: a user moves from one visual language, header model and mobile behavior into another.

## Audit Scope

Routes checked:

| Route | Status | System | Notes |
| --- | ---: | --- | --- |
| `/` | 200 | new `site-theme` | Main product page |
| `/faq` | 200 | new `site-theme` | Matches home style |
| `/about` | 200 | new `site-theme` | Matches home style |
| `/docs` | 200 | legacy/global | Different navbar, logo, spacing, cards |
| `/docs/comparison` | 200 | legacy/global | Same legacy docs shell |
| `/privacy` | 200 | legacy/global | Different navbar/footer and mobile overflow |
| `/terms` | 200 | legacy/global | Different navbar/footer |
| `/download/latest` | 200 | standalone | No navigation shell |

Viewport checks:

- Desktop: `1440x900`
- Mobile: `390x844`

Generated audit artifacts:

- `website/outputs/site-audit-2026-05-04/site-audit-metrics.json`
- screenshots in `website/outputs/site-audit-2026-05-04/`

## Key Metrics

### Build

Command:

```powershell
cd website
npm run build
```

Result:

- Build passed.
- 18 static pages generated.
- Largest HTML page: `/index.html`, `54.6 KB`.
- Total `_astro` assets in build folder: `88 files`, about `1.48 MB`.

### Live Scroll Performance

Command:

```powershell
npm run perf:website:scroll
```

Target: `https://rheolab.site`

Result:

| Metric | Value | Verdict |
| --- | ---: | --- |
| FCP | `704 ms` | Good |
| LCP | `704 ms` | Good |
| CLS | `0.0361` | Good |
| DOM nodes | `491` | Healthy |
| Load event | `782.8 ms` | Good |
| Scroll avg frame | `16.78 ms` | Borderline 60 FPS |
| Scroll p95 frame | `16.8 ms` | Acceptable |
| Frames over 16 ms | `20.47%` | Watch item |
| Frames over 33 ms | `2` | Acceptable |
| Long tasks | `1`, max `102 ms` | Watch item |

Performance verdict: the live homepage is not the blocker. The main risk is UX/design consistency and mobile layout, not raw load speed.

## Findings

### P0 - Site Shell Is Split Across Two Designs

Evidence:

- New pages use `website/src/layouts/SiteLayout.astro` and `website/src/components/site/Navbar.astro`.
- Docs use `website/src/layouts/DocsLayout.astro`, which imports legacy `website/src/components/Navbar.astro` and `website/src/components/Footer.astro`.
- Legal pages `privacy.astro` and `terms.astro` also import legacy `Layout`, `Navbar`, `Footer`.

Measured difference:

| Route group | Header | Position | Height | Visible desktop nav |
| --- | --- | --- | ---: | --- |
| `/`, `/faq`, `/about` | `header.site-header` | `sticky` | `77 px` | RheoLab Enterprise, Возможности, FAQ, О компании, Контакты, Скачать |
| `/docs/*`, `/privacy`, `/terms` | `nav.navbar` | `fixed` | `86 px` | RheoLab для лаборатории, Возможности, Скачать, Вопросы и ответы, О компании, Контакты |
| `/download/latest` | none | none | none | none |

Impact:

Users perceive page transitions as jumps between different products. The header logo changes, nav labels change, active context changes and mobile menu behavior changes. This directly matches the complaint that transitions between tabs/pages do not feel whole.

Recommended fix:

Unify all public routes under one shell:

- Move docs to a `SiteDocsLayout` built on `SiteLayout`.
- Move `/privacy` and `/terms` to `SiteLayout` + `components/site/Navbar/Footer`.
- Give `/download/latest` at least a minimal shared header or explicit "back to site" affordance.

### P0 - Mobile Navigation Is Inconsistent And Sometimes Missing

Evidence:

- New `site/Navbar.astro` hides `.site-nav-links` at `max-width: 768px`.
- It does not provide a burger menu replacement.
- Legacy navbar does provide a burger menu.

Measured mobile nav:

| Route group | Visible mobile nav |
| --- | --- |
| `/`, `/faq`, `/about` | `RheoLab Enterprise`, `Скачать` only |
| `/docs/*`, `/privacy`, `/terms` | `RheoLab для лаборатории`, burger menu |
| `/download/latest` | no nav |

Impact:

On mobile, the main pages have no path to FAQ/About/Contacts except scrolling or footer discovery, while docs/legal pages suddenly show a burger menu. This makes the site feel inconsistent and makes "tab" transitions hard to reason about.

Recommended fix:

Add one mobile navigation pattern to `components/site/Navbar.astro` and reuse it everywhere:

- hamburger/menu button;
- same route list as desktop;
- close on link click;
- `aria-expanded` / `aria-controls`;
- active/current state.

### P1 - Mobile Headings Are Clipped

Evidence:

- Home hero title uses `font-size: clamp(3.1rem, 4.85vw, 4.35rem)` in `components/site/Hero.astro`.
- Legal pages use fixed `font-size: 3rem` for `.legal-page h1`.

Measured overflow:

| Route | Viewport | Horizontal overflow |
| --- | --- | ---: |
| `/privacy` | `390x844` | `142 px` |
| `/download/latest` | `390x844` | `34 px` |

Visual evidence:

- Mobile home hero clips the right side of the long Russian H1.
- Mobile privacy page clips `Политика конфиденциальности`.

Impact:

This is a visible quality bug on common mobile widths. Even if `body { overflow-x: hidden }` masks some overflow, it clips content instead of solving layout.

Recommended fix:

- Add mobile-specific H1 sizing to hero: lower min size around `2.35rem-2.6rem`.
- Add `overflow-wrap: anywhere` or better line breaks for long legal titles.
- Use `max-width: 100%` and avoid large fixed min font sizes on mobile.

### P1 - `/download/latest` Is Detached From The Product Site

Evidence:

- `download/latest.astro` is a standalone document, not `Layout` or `SiteLayout`.
- It has no header, no footer, no route back except a text link to mail.
- It points to `stable.json` and falls back to a hardcoded `0.2.0-beta.4` installer.

Impact:

The primary CTA "Скачать" drops users into a page that visually does not belong to the site. If the auto-redirect is delayed or blocked, this looks like a different micro-site. The hardcoded beta fallback is also risky if public download expectations change.

Recommended fix:

- Wrap download page in the shared site shell, or create a minimal branded download shell using the same navbar/logo.
- Replace hardcoded fallback with a generated release value or explicit channel policy.
- If public website must always serve stable, say so in code comments and copy. If alpha/beta users are expected, add channel-specific routes.

### P1 - Docs Navigation Looks Like A Separate Product

Evidence:

- Docs top nav is old pill-centered navbar.
- Docs page has its own horizontal "docs-links" pill list.
- New top navbar does not contain "Документация", but footer does.

Impact:

Docs are useful, but the entry/exit path feels bolted on. A user who clicks from footer to docs sees a different header and brand subtitle, then has two competing navigation systems.

Recommended fix:

- Keep docs-specific section pills, but put them inside the new site shell.
- Add "Документация" to the new main nav or make docs discoverability consistent through footer and FAQ.
- Add a clear active state in the main nav for `/docs/*`.

### P2 - Fake App Tabs In Hero Are Semantically Ambiguous

Evidence:

- Hero mockup renders `Анализ`, `Библиотека`, `Сравнение`, `Отчёты` as `.site-tab` divs.
- They are visually tab-like but non-interactive.

Impact:

On desktop, this is acceptable as mock UI if users understand it is an illustration. But because the product itself is tab-heavy, visitors may expect those tabs to switch the mockup. This can amplify the "tabs do not feel cohesive" impression.

Recommended fix:

Choose one:

- Make the mock tabs obviously illustrative and mark the container `aria-hidden="true"`.
- Or make them real lightweight tabs that switch between static mock states.

### P2 - Content Promises Drift

Evidence:

- Privacy text says the site form may use an external service.
- Current new contact section is mailto-only, not a web form.

Impact:

Not a functional blocker, but it weakens trust in legal/product copy.

Recommended fix:

Either update privacy wording to "email/contact links" or reintroduce a clearly disclosed form.

### P2 - Visual System Still Carries Deprecated Components

Evidence:

`website/src/components/` contains older components (`Capabilities`, `Download`, `Workflow`, old `Navbar`, old `Footer`) while `website/src/components/site/` contains the active newer system.

Impact:

Future edits can easily patch the wrong component, and pages can accidentally keep drifting.

Recommended fix:

- Keep old variants only under `archive/`.
- Rename active components clearly.
- Add a short `website/AGENTS.md` or README note: active site shell is `components/site/*`.

## What Is Already Good

- Astro build is clean.
- Homepage load performance is good: FCP/LCP around `704 ms` on live profile.
- No console warnings/errors were captured in the checked route set.
- Desktop homepage has a strong product signal and credible visual language.
- `/faq` and `/about` already match the new design.
- Documentation content itself is useful; the problem is shell integration, not the text.

## Recommended Fix Plan

### Sprint 1 - Shell Unification

Goal: make every top-level page feel like one site.

Tasks:

1. Create a shared `SitePageShell` or extend `SiteLayout` for ordinary pages.
2. Convert `/privacy` and `/terms` to `SiteLayout` + `components/site/Navbar/Footer`.
3. Convert `DocsLayout` to use the new `site` navbar/footer while preserving docs content and docs-links.
4. Give `/download/latest` a minimal shared branded shell.
5. Add active/current nav state.

Acceptance:

- Desktop route matrix shows one header class/system across all public pages.
- Mobile route matrix shows one mobile nav behavior across all public pages.
- No route has missing navigation except intentional pure redirect states.

### Sprint 2 - Mobile Polish

Goal: no clipped text and no awkward section starts.

Tasks:

1. Fix hero H1 mobile sizing.
2. Fix legal/download title wrapping.
3. Re-test `390x844`, `375x812`, `430x932`.
4. Add a lightweight Playwright visual/layout smoke for overflow:
   - `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
   - checked for `/`, `/faq`, `/about`, `/docs`, `/privacy`, `/terms`, `/download/latest`.

Acceptance:

- `overflowX = 0` on all checked mobile routes.
- H1s are readable and not clipped.

### Sprint 3 - Navigation Semantics

Goal: users understand where they are and how to move.

Tasks:

1. Add mobile menu to new navbar.
2. Add "Документация" to the main nav or create a deliberate docs entry path.
3. Decide whether hero mock tabs are decorative or interactive.
4. Align footer link names with header names.

Acceptance:

- Same nav labels across header/footer/docs.
- Current route is visibly marked.
- Fake tabs no longer look like broken controls.

## Release Recommendation

Do not deploy the current website as a "polished alpha landing" without at least Sprint 1 and the mobile H1 fix.

The app release can continue, but the website should be treated as alpha-internal until:

- design shell is unified;
- mobile navigation is consistent;
- mobile heading clipping is fixed;
- `/download/latest` no longer feels detached from the product site.

