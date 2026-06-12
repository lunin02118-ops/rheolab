# Implementation Plans / Планы внедрения

Сгенерировано скиллом improve 2026-06-11 на коммите `37e9202`.
Исполнять в указанном порядке. Каждый исполнитель: прочитай план целиком до
старта, соблюдай его условия STOP и обнови свою строку статуса по завершении.

## Порядок исполнения и статус

| План | Название | Приоритет | Трудозатраты | Зависит от | Статус |
|------|----------|-----------|--------------|------------|--------|
| 001  | Мета-документация, мусор в корне, churn version.ts — с полной регрессией | P1 | M | — | DONE (2026-06-11, ветка advisor/001-repo-hygiene; этапы 0–5 зелёные: vitest 1501, rust 546, e2e:smoke 13, audit:enterprise:quick — все exit 0; ограничений прогона нет) |
| 002  | Закоммитить Windows-фикс Vitest-раннера, привести working tree в консистентность | P1 | S | — | DONE (2026-06-12, ветка advisor/002-vitest-windows-fix; test/typecheck/lint/version:validate — exit 0) |
| 003  | Закрыть moderate-advisory uuid (GHSA-w5hq-g745-h8pq) в dev-deps через npm overrides | P2 | S | 002 | DONE (2026-06-12, ветка advisor/003-uuid-override; npm audit/audit --omit=dev/test — exit 0) |
| 004  | Release-gate проверка боевого license_public.der (не dev-ключ) | P2 | S | — (удобнее после 002) | DONE (2026-06-12, ветка advisor/004-license-key-gate; check-license-key/lint/prerelease:prepare — exit 0) |
| 005  | Spike: crash/panic-телеметрия WP-6.3 — локальный crash.log + design-док отправки | P3 | M | 002 | DONE (2026-06-12, ветка advisor/005-crash-telemetry; crash_reporter/lint/typecheck/cargo test — exit 0; verified by advisor) |
| 006  | Подготовка промоушена 0.2.3 alpha → beta: readiness-отчёт + репетиция (без деплоя) | P3 | M | 002 (желательно после 003, 004) | BLOCKED (ожидает решения владельца по `docs/release/BETA-0.2.3-READINESS.md`) |
| 007  | Убрать последний LOWER(name)-скан в resolve_by_id_or_name (остаток F1) | P3 | S | — | DONE (2026-06-12, ветка advisor/007-reagent-nocase; grep/reagent/full cargo test — exit 0) |
| 008  | Окно «О программе» с вкладками лицензии и поддержки | P2 | M | — | DONE (2026-06-12, ветка codex/008-about-support-dialog; version:validate/lint/typecheck/targeted Vitest/Playwright smoke — exit 0) |

Значения статуса: TODO | IN PROGRESS | DONE | BLOCKED (с причиной в одну строку) | REJECTED (с обоснованием).

Планы 002–004 составлены deep-аудитом 2026-06-11 на коммите `6d9035e`
(полная регрессия перед аудитом: vitest 1501 ✓, rust 546 ✓, lint/typecheck/
version:validate ✓, npm audit prod 0 ✓, cargo audit 884 deps / 0 advisories ✓).

## Заметки о зависимостях

- 002 первым: он приводит working tree в чистое состояние и фиксирует
  рабочий `npm run test` — на это полагаются drift-проверки 003 и 004.
- 003 требует 002, потому что верификация 003 — полный Vitest-прогон через
  закоммиченный раннер.
- 004 независим, но запускать после 002, чтобы `git status`-критерий чистоты
  не был замусорен посторонними файлами.
- 005 и 006 — direction-планы по запросу владельца (2026-06-11); оба требуют
  002 (рабочий `npm run test` и чистое дерево).
- 006 желательно последним: его readiness-отчёт честнее, если 003 (uuid
  advisory) и 004 (license-key gate) уже влиты — иначе отчёт обязан
  перечислить их как открытые пункты.
- 006 по построению НЕ деплоит: финальный статус — BLOCKED до решения
  владельца по `docs/release/BETA-0.2.3-READINESS.md`.
- 007 независим от release-цепочки; это микро-fix DB-паттерна
  `COLLATE NOCASE`.
- 008 независим от release-цепочки; UI-only, но должен сохранить
  блокирующий сценарий `LicenseGuard`.

## Рассмотренные и отклонённые находки (чтобы не аудировать повторно)

- Разбиение `src-tauri/src/commands/reports.rs` (4 566 строк): команда только
  что завершила осознанный глубокий рефакторинг (`docs/REFACTORING_DEEP_PLAN.md`
  — все WP выполнены), файл хорошо покрыт inline-тестами. Сейчас не стоит.
- `exec()` в `license-server/includes/helpers.php:194`: sudo-обёртка с жёстко
  заданным путём и корректным экранированием — так задумано.
- 2 пустых блока `catch {}` (`useExperimentSeriesOverview.ts:257`,
  `useSaveDialogInit.ts:149`): задокументированные намеренные fallback.
- `unwrap()` в `db/columnar.rs` и `commands/reports.rs`: все внутри
  `#[cfg(test)]`.
- Хранение API-ключей: machine-bound AES-256-GCM с миграцией legacy — грамотно.
- Обход HMAC канала обновлений: уже исправлен 2026-04-19
  (`license-server/releases.htaccess`); в плане 001 лишь актуализируется
  запись в `progress.txt`.

Дополнено deep-аудитом 2026-06-11:

- `reports.rs` вырос 3 620 → 4 236 строк с мая (+17%). Сплит по-прежнему
  отклонён, но установлен tripwire: пересмотреть решение при превышении
  ~5 000 строк или при первом баге, локализация которого займёт >1 часа
  из-за размера файла.
- `license-server/includes/db.php:30` — текст ошибки подключения к БД
  уходит клиенту только при `DEBUG=true`: by design, не находка.
- SQL-инъекции в `license-server/`: не обнаружены — все запросы через PDO
  prepared statements, `ATTR_EMULATE_PREPARES=false`; auth админки —
  `password_verify` + fail-closed rate limit + CSRF (`hash_equals`) +
  hardened session cookies. Чисто.
- Оффлайн-активация (`engine/offline.rs`): RSA-подпись проверяется до
  доверия payload, machine binding, corporate-only, перманентность и
  hardwareBound принудительны; cfg-гейтинг dev/prod ключа корректен;
  приватные ключи в git-истории отсутствуют. Чисто (остаточный риск закрыт
  планом 004).
- TS escape hatches: 0 `ts-ignore`, 3 задокументированных `eslint-disable`;
  0 TODO/FIXME/HACK во всём `src/` + `src-tauri/src/`. Находок нет.
- Направление: (а) crash-телеметрия WP-6.3 — alpha-флот и канал доставки
  есть, сбора крашей нет; (б) промоушен 0.2.3 из alpha (19 итераций с мая) —
  блокеров аудит не нашёл, решение продуктовое. По запросу владельца
  2026-06-11 оба оформлены планами 005 и 006.

## Не аудировалось

Аудит 2026-06-11: `website/` вглубь, `Regents/`, `archive/`, `tools/`,
качество каждого Playwright-спека, рантайм-профилирование; `npm run build`
и e2e smoke не перепрогнаны в сессии аудита (команды прерывались
окружением; последний зелёный прогон — план 001, 2026-06-11).
