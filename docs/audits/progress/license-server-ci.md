# License Server CI Proof

Date: 2026-06-14
Work item: W1-01
Branch: `ci/license-server-openssl-proof`
GitHub PR: `#14` — https://github.com/lunin02118-ops/rheolab/pull/14

## Purpose

Make `license-server` verifiable in CI with PHP `openssl`, Composer validation,
reproducible dependency installation, and PHPUnit execution.

## Scope

Files changed:

- `.github/workflows/license-server.yml`
- `license-server/composer.json`
- `docs/audits/progress/license-server-ci.md`

No runtime license-server PHP endpoint, helper, signing, activation, validation,
or database migration code was changed.

## 30-Day Trial Safety

This work does not change 30-day trial behavior.

Unaffected areas:

- `license-server/api/activate.php`
- `license-server/api/validate.php`
- `license-server/includes/helpers.php`
- signed license payload fields
- `expires_at`
- `grace_period_days`
- trial/developer/corporate license semantics

The CI job runs existing PHPUnit coverage, including the test that treats a
license expiring in `+30 days` as valid.

## Local Environment Check

Local commands attempted:

| Command | Result | Notes |
|---|---|---|
| `php -v` | PASS | PHP 8.5.5 CLI available. |
| `php -m \| grep openssl` | BLOCKED | Local PHP does not list `openssl`. |
| `php -r "extension_loaded('openssl')"` | BLOCKED | Returns false in the local shell. |
| `composer --version` | BLOCKED | Composer is not installed in the local shell. |
| `composer --working-dir=license-server validate` | BLOCKED | Composer is not installed in the local shell. |

The local blocker is the reason this CI proof exists. The GitHub job installs a
known PHP runtime with `openssl`, installs Composer v2, and runs the checks in a
reproducible Ubuntu environment.

## CI Validation

The new workflow runs on PRs touching `license-server/**`, its workflow, or this
progress document, and can also be run manually.

Workflow checks:

```bash
php -m | grep -i '^openssl$'
php -r 'extension_loaded("openssl") || exit(1);'
composer --working-dir=license-server validate
composer --working-dir=license-server install --no-interaction --prefer-dist --no-progress
composer --working-dir=license-server test
```

The workflow generates an ephemeral dev RSA keypair under `src-tauri/keys/` on
the runner before PHPUnit. Those files are gitignored and are not product
signing material.

## Acceptance Criteria Mapping

| Criterion | Status |
|---|---|
| CI proves PHP `openssl` is present. | Implemented in workflow. |
| Composer validation passes. | Implemented in workflow. |
| Dependencies install reproducibly. | Implemented via Composer install from lockfile. |
| PHPUnit/license-server tests pass. | Implemented via `composer test`. |
| Job can run on PR and manually. | Implemented via `pull_request` and `workflow_dispatch`. |

## Risks

- The local shell cannot run Composer/PHPUnit until Composer and PHP `openssl`
  are installed locally.
- CI may reveal pre-existing PHPUnit failures that were previously hidden by the
  missing local PHP environment.

## Rollback

Revert this PR. Since no runtime license logic changed, rollback removes only
the workflow, Composer test alias, and this progress note.
