# Release Gate Decision

- Decision: **NO-GO**
- Mode: `quick`
- Generated at: 2026-04-22T20:14:31.474Z
- Baseline ref: n/a

## Gate Policy

- Blocking severities: `critical`, `high`
- Failed blocking checks are always blockers

## Stats

- Checks executed: 13
- Checks passed: 10
- Checks failed: 3
- Failed blocking checks: 3
- Severity blockers: 3
- Open medium findings: 0

## Failed Blocking Checks

| Check | Name | Exit | Log |
|---|---|---|---|
| 03 | PHP version | 1 | `runtime/audit/2026-04-22-enterprise-deep-audit/logs/03_php_v.log` |
| 05 | ESLint gate | 1 | `runtime/audit/2026-04-22-enterprise-deep-audit/logs/05_npx_eslint.log` |
| 18 | License-server PHP lint | 127 | `runtime/audit/2026-04-22-enterprise-deep-audit/logs/18_node_scripts_audit_php_lint_license_server_js.log` |

## Severity Blockers

| ID | Severity | Title |
|---|---|---|
| ENV-005 | HIGH | PHP runtime is unavailable for license-server checks |
| LIC-PHP-LINT | HIGH | License-server PHP lint failed |
| QG-ESLINT | HIGH | ESLint gate is red |

