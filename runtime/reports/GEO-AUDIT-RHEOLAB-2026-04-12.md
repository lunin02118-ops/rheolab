# GEO Audit Report: RheoLab

**Audit Date:** 2026-04-12  
**URL:** https://rheolab.site/  
**Business Type:** SaaS / B2B software for rheology data workflows  
**Pages Analyzed:** 5 public pages via `geo-seo-claude` scripts

---

## Executive Summary

**Overall GEO Score: 41/100 (Poor)**

`rheolab.site` has a solid technical base for crawlability: the site is server-rendered, fast, publicly accessible to major AI crawlers, and exposes a valid sitemap through `robots.txt`. The main GEO weakness is not transport or hosting quality but discoverability and citability: the site has a thin entity graph, weak structured data coverage, no `llms.txt`, and public content blocks that are too short and marketing-heavy for strong AI citation behavior.

The fastest gains will come from turning the site into a machine-readable entity and source: add `Organization` + `WebSite` JSON-LD with `sameAs`, publish `llms.txt`, add page-specific schema (`FAQPage`, `BreadcrumbList`), and rewrite key sections into direct answer blocks that AI systems can safely quote.

### Score Breakdown

| Category | Score | Weight | Weighted Score |
|---|---:|---:|---:|
| AI Citability | 46/100 | 25% | 11.5 |
| Brand Authority | 18/100 | 20% | 3.6 |
| Content E-E-A-T | 47/100 | 20% | 9.4 |
| Technical GEO | 72/100 | 15% | 10.8 |
| Schema & Structured Data | 32/100 | 10% | 3.2 |
| Platform Optimization | 27/100 | 10% | 2.7 |
| **Overall GEO Score** |  |  | **41.2/100** |

---

## High Priority Issues

1. **`llms.txt` and `llms-full.txt` are missing**
   Evidence: `geo-seo-claude/scripts/llmstxt_generator.py` validation returned `404` for both.

2. **Entity graph is too weak for AI systems**
   Evidence: public structured data is limited to `SoftwareApplication`; no `Organization`, no `sameAs`, no `WebSite/SearchAction`, no visible external entity mapping.

3. **Page-level schema is largely absent**
   Evidence: `/faq/` does not expose `FAQPage`; docs pages do not expose `BreadcrumbList` or article-like author/date schema.

4. **Citability is poor across analyzed pages**
   Evidence from `citability_scorer.py`:
   - `/` average citability: `27.7`
   - `/faq/` average citability: `27.8`
   - `/docs/` average citability: `19.8`
   - `/docs/quick-start/` average citability: `22.5`
   - all analyzed pages graded mostly `F`

5. **Security and trust headers are missing**
   Evidence from `fetch_page.py`: no `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy` detected on analyzed pages.

6. **Public brand authority signals are minimal**
   Evidence from `brand_scanner.py`: no confirmed Wikipedia/Wikidata entity, no confirmed LinkedIn company signal, no confirmed YouTube channel, no confirmed Reddit authority signal.

---

## Medium Priority Issues

1. **`www` variant is accessible without hard redirect**
   Evidence: `https://www.rheolab.site/` returns `200` and canonicalizes to non-`www`, but does not 301-redirect.

2. **Docs and product content lack freshness and author signals**
   Evidence: no visible author schema, no publication/update schema surfaced by the audited pages.

3. **Main content does not produce enough standalone answer blocks**
   Evidence: the tool found 0 optimal-length passages (`134-167` words) on the homepage.

4. **Footer/legal trust exists, but business identity is still thin**
   Evidence: privacy/terms/contact emails are present, but no visible company address, leadership, team page, or expertise profile surfaced in the public entity layer.

---

## Category Deep Dives

### AI Citability (46/100)

What is working:
- All major AI crawlers are currently allowed by default through `robots.txt`.
- The site is server-rendered, so bots can read the real content without JavaScript execution.
- The site exposes a sitemap in `robots.txt`.

What is weak:
- Content blocks are short and presentation-led rather than answer-led.
- No analyzed page produced `A`, `B`, or `C` citability grades in the tool.
- The homepage is persuasive, but not structured for direct extraction into AI answers.
- `llms.txt` is absent, so there is no explicit AI-oriented guide to the site.

### Brand Authority (18/100)

What is working:
- The brand has a canonical domain and a product-specific niche.
- The site clearly names supported instrument families and a specific use case.

What is weak:
- No strong public entity graph discovered by the tool.
- No confirmed Wikipedia/Wikidata presence.
- No confirmed LinkedIn / YouTube / Reddit authority footprint.
- No `sameAs` mapping inside schema to teach AI systems where this entity lives elsewhere.

### Content E-E-A-T (47/100)

What is working:
- The site demonstrates domain specificity: rheology, lab workflows, supported device families.
- Trust basics exist: HTTPS, contact emails, privacy policy, terms page.
- Documentation section exists and helps topical depth.

What is weak:
- No author or expert identity layer on docs/content.
- No visible update dates or freshness markers.
- Few original data points, benchmarks, or quantified claims.
- Limited first-hand evidence blocks such as case studies, implementation stories, research results, or measured outcomes.

### Technical GEO (72/100)

What is working:
- `http://rheolab.site/` redirects to `https://rheolab.site/`
- Homepage TTFB is about `0.42s`
- `/docs/quick-start/` TTFB is about `0.40s`
- Responses are compressed (`gzip`)
- SSR content is present in raw HTML
- `robots.txt` exists and is permissive
- `sitemap-index.xml` is reachable

What is weak:
- No modern security headers detected
- `www` version is not force-redirected to canonical non-`www`
- `llms.txt` is missing

### Schema & Structured Data (32/100)

What is working:
- JSON-LD is present
- The current schema type (`SoftwareApplication`) is server-rendered and parseable

What is weak:
- Missing `Organization`
- Missing `WebSite` with `SearchAction`
- Missing `sameAs`
- Missing `FAQPage` on `/faq/`
- Missing `BreadcrumbList` on docs pages
- Missing author/date-rich article schema for docs knowledge pages

### Platform Optimization (27/100)

Platform estimate by public signals:
- Google AI Overviews: `38/100`
- ChatGPT Web Search: `24/100`
- Perplexity: `19/100`
- Gemini: `32/100`
- Bing Copilot: `22/100`

Main reason for low platform readiness:
- The site is technically crawlable, but not yet embedded into the broader entity/web graph those platforms trust.

---

## Quick Wins (Implement This Week)

1. Publish `https://rheolab.site/llms.txt` and `llms-full.txt`.
2. Add `Organization` + `WebSite` JSON-LD with `sameAs` links.
3. Add `FAQPage` schema to `/faq/`.
4. Add `BreadcrumbList` to `/docs/` and nested docs pages.
5. Rewrite homepage hero and key sections into direct answer blocks of roughly `120-180` words.
6. Add visible “last updated” markers to docs pages.
7. Add modern security headers at Apache level.
8. Force `https://www.rheolab.site/` -> `https://rheolab.site/` with `301`.

---

## 30-Day Action Plan

### Week 1: Machine-Readable Foundation
- [ ] Publish `llms.txt`
- [ ] Publish `llms-full.txt`
- [ ] Add `Organization` JSON-LD
- [ ] Add `WebSite` + `SearchAction` JSON-LD
- [ ] Add `sameAs` array for all verified social/company profiles

### Week 2: Page-Level Schema and Technical Trust
- [ ] Add `FAQPage` schema
- [ ] Add `BreadcrumbList` across docs
- [ ] Add security headers in Apache
- [ ] Add hard `www` -> apex redirect

### Week 3: Citability Rewrite
- [ ] Rewrite homepage sections into question/answer format
- [ ] Add summary blocks with direct factual claims
- [ ] Expand `/docs/quick-start/` into more extractable, standalone passages
- [ ] Add comparison tables and definition blocks where appropriate

### Week 4: Authority Layer
- [ ] Create /about or /team page with expertise signals
- [ ] Add author / maintainer identity to docs
- [ ] Establish at least LinkedIn + YouTube + GitHub/other relevant public profiles
- [ ] Add case study / implementation evidence / measurable outcomes

---

## Appendix: Public Evidence Collected

### `geo-seo-claude` installation
- Skills installed to: `C:\Users\VladimirWorkPC\.claude\skills\geo`
- Subskills installed: `geo-audit`, `geo-citability`, `geo-crawlers`, `geo-content`, `geo-schema`, `geo-platform-optimizer`, etc.
- Claude CLI installed: `2.1.101 (Claude Code)`

### Script outputs used
- `fetch_page.py https://rheolab.site/ full`
- `citability_scorer.py https://rheolab.site/`
- `llmstxt_generator.py https://rheolab.site/ validate`
- `brand_scanner.py RheoLab rheolab.site`

### Page sample
| URL | Word Count | Citability Avg | Structured Data |
|---|---:|---:|---|
| `/` | 756 | 27.7 | `SoftwareApplication` |
| `/faq/` | 259 | 27.8 | `SoftwareApplication` |
| `/docs/` | 278 | 19.8 | `SoftwareApplication` |
| `/docs/quick-start/` | 387 | 22.5 | `SoftwareApplication` |
| `/download/latest/` | 38 | 21.0 | none |

