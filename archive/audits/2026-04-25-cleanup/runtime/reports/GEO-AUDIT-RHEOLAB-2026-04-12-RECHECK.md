# GEO Audit Recheck: RheoLab

**Recheck Date:** 2026-04-12  
**URL:** https://rheolab.site/  
**Method:** `geo-seo-claude` scripts (citability, llms, fetch headers, brand scan)

---

## Executive Summary

**Estimated GEO Score: 46/100 (Poor, +5)**

After the deploy, the technical GEO layer improved meaningfully: `llms.txt` is live, security headers are present, `www` now 301-redirects, and the site exposes a richer JSON-LD entity graph (Organization + WebSite + FAQ/Breadcrumb schemas). However, the largest GEO drivers — citability, E‑E‑A‑T depth, and external brand authority — remain unchanged because content and public presence were intentionally not rewritten.  

This means the site is now **better understood and safer to crawl**, but still **not very quoteable** by AI systems. The largest score lift will only come from the deferred content rewrite and verified external entity links (`sameAs`).

---

## Key Deltas vs 2026-04-12 Baseline

### ✅ Fixed / Improved

- **`llms.txt` + `llms-full.txt` now exist**
  - Evidence: `fetch_page.py` confirms both files present.
- **Security headers now present**
  - `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **`www` now 301 redirects to apex**
  - `https://www.rheolab.site/` → `https://rheolab.site/`.
- **Entity graph upgraded**
  - JSON‑LD `@graph` now includes `Organization`, `WebSite`, `SoftwareApplication`, plus page‑level `WebPage`.
- **FAQ and Docs schema now present**
  - `FAQPage` on `/faq/` and `/docs/faq/`.
  - `BreadcrumbList` on docs pages.

### ❗️Unchanged (Expected)

- **Citability scores**
  - No content rewrite was done, so scores stayed at the same baseline.
- **Brand authority**
  - No Wikipedia/Wikidata/LinkedIn/YouTube/Reddit presence added.
- **E‑E‑A‑T depth**
  - No author/updates/case studies added beyond docs “last updated” label.

---

## Citability Recheck (unchanged)

Average citability across sampled pages: **23.8/100**  
No optimal‑length passages (`134–167` words) detected.

| URL | Avg Citability | Optimal Passages |
|---|---:|---:|
| `/` | 27.7 | 0 |
| `/faq/` | 27.8 | 0 |
| `/docs/` | 19.8 | 0 |
| `/docs/quick-start/` | 22.5 | 0 |
| `/download/latest/` | 21.0 | 0 |

---

## Evidence Snapshots

### Security Headers (now present)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy: default-src 'self'; ... connect-src 'self' https://license.vizbuka.ru`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: accelerometer=(), autoplay=(), ...`

### llms.txt status
- `https://rheolab.site/llms.txt` → **200 OK**
- `https://rheolab.site/llms-full.txt` → **200 OK**

### Schema Types Found
- `Organization`
- `WebSite`
- `SoftwareApplication`
- `WebPage`
- `FAQPage` (FAQ pages)
- `BreadcrumbList` (docs pages)

---

## Next Steps (Ordered)

1. **(Optional) Add `sameAs`** — only if there are verified public profiles.
2. **Deepen sitemap/robots/metadata** — add more explicit discovery hints.
3. **Citability rewrite (deferred)** — biggest score lift once you want it.

---

## Script Outputs Used

`d:/Development/Rheolab/runtime/reports/geo-recheck/citability-*.json`  
`d:/Development/Rheolab/runtime/reports/geo-recheck/llms-validate.json`  
`d:/Development/Rheolab/runtime/reports/geo-recheck/fetch-full.json`  
`d:/Development/Rheolab/runtime/reports/geo-recheck/brand.json`

