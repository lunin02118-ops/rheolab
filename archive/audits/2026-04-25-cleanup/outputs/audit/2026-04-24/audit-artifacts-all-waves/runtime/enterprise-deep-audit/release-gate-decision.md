# Release Gate Decision

- Decision: **NO-GO**
- Mode: `quick`
- Generated at: 2026-04-24T02:21:58.992Z
- Baseline ref: `runtime/audit/2026-04-22-enterprise-deep-audit/dynamic-checks-summary.tsv`

## Gate Policy

- Blocking severities: `critical`, `high`
- Failed blocking checks are always blockers

## Stats

- Checks executed: 13
- Checks passed: 8
- Checks failed: 5
- Failed blocking checks: 5
- Severity blockers: 5
- Open medium findings: 0

## Failed Blocking Checks

| Check | Name | Exit | Log |
|---|---|---|---|
| 03 | PHP version | 1 | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/03_php_v.log` |
| 04 | TypeScript gate | 1 | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/04_npx_tsc_noemit.log` |
| 05 | ESLint gate | 1 | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/05_npx_eslint.log` |
| 06 | Unit/Integration tests | 1 | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/06_npm_test.log` |
| 18 | License-server PHP lint | 127 | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/18_node_scripts_audit_php_lint_license_server_js.log` |

## Severity Blockers

| ID | Severity | Title |
|---|---|---|
| ENV-005 | HIGH | PHP runtime is unavailable for license-server checks |
| LIC-PHP-LINT | HIGH | License-server PHP lint failed |
| QG-ESLINT | HIGH | ESLint gate is red |
| QG-TEST | HIGH | Unit/integration test gate is red |
| QG-TSC | HIGH | TypeScript gate is red |

