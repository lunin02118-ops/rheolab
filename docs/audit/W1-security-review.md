# Отчёт: оценка качества рефакторинга — Фаза 1 (Security / W1)

> **Ревьюер:** copilot (agent)  
> **Дата:** 2026-04-17  
> **База:** `origin/main` @ `9dbf740`  
> **Документ-план:** [`docs/REFACTORING_DEEP_PLAN.md`](../REFACTORING_DEEP_PLAN.md) — раздел «Фаза 1 — Безопасность»  
> **Статус:** ✅ Фаза 1 принята с замечаниями (см. § Quality debt)

---

## 1. Scope проверки

Оцениваются коммиты на `origin/main`, относящиеся к **Фазе 1 «Безопасность»** плана рефакторинга:

| Коммит | Автор | Дата | WP |
|---|---|---|---|
| `2e745b1` | 70lunin021189-ux | 2026-04-17 13:00 | WP-1.1 + WP-1.2 |
| `3add774` | 70lunin021189-ux | 2026-04-17 13:03 | WP-1.3 + WP-1.4 (аудит) |
| `9dbf740` | 70lunin021189-ux | 2026-04-17 13:38 | WP-1.3 (фактическое удаление xlsx) |

Цель Фазы 1: устранить Critical-уязвимости — лишние `panic!` в прод-коде, timing-side-channel в HMAC, уязвимые зависимости, SQL-конкатенации.

---

## 2. Методология

Проверка велась по следующим измерениям:
1. **Корректность.** Реализация соответствует заявленной цели WP и не ломает инварианты плана (лицензионный wire-формат, схема БД, имена 88+ IPC-команд, формат отчётов).
2. **Минимальность.** Изменения соразмерны задаче, нет «drive-by» правок.
3. **Тестовое покрытие.** Изменения покрыты существующими или новыми тестами.
4. **Соответствие плану.** Все пункты WP закрыты; расхождения с планом задокументированы.
5. **Регрессивная безопасность.** Введены ли меры, блокирующие возврат проблемы (CI-gate, helper, ADR).

Источники: `git show <sha>`, `grep` по HEAD `origin/main`, проверка `docs/REFACTORING_DEEP_PLAN.md`.

---

## 3. Результаты по WP

### 3.1 WP-1.1 — Устранение `panic!` в прод-коде — ✅ 5/5

**Ожидалось планом.** Заменить `panic!` в четырёх местах на возврат `Result`/`debug_assert!`.

**Фактически.** Audit-only: правки не потребовались.

**Проверка HEAD:**
```
src-tauri/src/commands/licensing/types.rs:195, 202   — внутри #[cfg(not(debug_assertions))]
src-tauri/src/db/columnar.rs:378                      — внутри #[cfg(test)] mod tests
src/rust/rheolab-core/src/report_generator/chart_generator.rs:1367 — внутри #[cfg(test)] mod tests
```

- `types.rs:195, 202` — **намеренный** build-time guard: защита от сборки release-бинарника с dev-ключом `INTEGRITY_SECRET_KEY` / `BETA_CHANNEL_SECRET`. Корректно оставлено.
- `columnar.rs:378`, `chart_generator.rs:1367` — физически в `mod tests`, `grep` сматчил их из-за `unwrap_or_else`/`matches(...)`. Корректно оставлено.

**Вывод.** Производственный код не содержит ни одного `panic!`/`todo!`/`unimplemented!` вне намеренных build-guard'ов. План излишне пессимистично оценил ситуацию — фактическое состояние уже удовлетворяло критерию.

**Замечания.** Нет.

---

### 3.2 WP-1.2 — Constant-time сравнение HMAC — ✅ 5/5

**Файл:** `src-tauri/src/commands/licensing/crypto.rs:132-150`.

**До:**
```rust
let expected = sign_data(value);
if expected.len() != signature.len() { return false; }
expected.as_bytes().iter()
    .zip(signature.as_bytes().iter())
    .fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
```

**После:**
```rust
let Ok(sig_bytes) = hex::decode(signature) else { return false; };
let key = get_integrity_key();
let Ok(mut mac) = <HmacSha256 as Mac>::new_from_slice(key.as_bytes()) else { return false; };
mac.update(value.as_bytes());
mac.verify_slice(&sig_bytes).is_ok()
```

**Оценка качества:**
| Критерий | Оценка |
|---|---|
| Constant-time на байтовом уровне | ✅ `hmac::Mac::verify_slice` использует `subtle::ConstantTimeEq` внутри digest-стека |
| Сравнение по декодированным байтам (32) вместо hex-строки (64) | ✅ устраняет утечку информации о hex-структуре |
| Без новых зависимостей | ✅ `hmac 0.12` уже в `Cargo.toml` (план предлагал добавить `subtle` — оказалось лишним) |
| Безопасный fail-closed на битом hex | ✅ `return false` |
| Обратная совместимость wire-формата | ✅ hex-представление HMAC-SHA256 сохранено |

**Реализация превзошла план** — использование `verify_slice` даёт меньше кода и меньше площадь ошибки, чем предлагавшийся ручной `subtle::ConstantTimeEq`.

**Дополнительная проверка других точек локального сравнения HMAC:**
| Файл | Строка | Роль | Статус |
|---|---|---|---|
| `licensing/crypto.rs:132` | `verify_signature()` | проверка HMAC `SystemState` | ✅ исправлено |
| `licensing/mod.rs:386-389` | `make_beta_channel_token()` | только генерация токена, compare на сервере | ✅ не требует правок |
| `licensing/crypto.rs:176` | `derive_storage_key_legacy()` | KDF, не сравнение | ✅ не применимо |

Все локальные точки сравнения покрыты.

**Тесты:** `crypto_tests::hmac_sign_verify`, `hmac_constant_time_comparison`, `system_state_hmac_roundtrip` — покрывают positive / tampered / разная длина / round-trip с БД.

**Замечания.** Нет.

---

### 3.3 WP-1.3 — Удаление `xlsx@0.18.5` — ✅ 5/5

**Advisory:**
- **SheetJS ReDoS** — GHSA, affected `< 0.20.2`, **patched: not available**.
- **SheetJS Prototype Pollution** — GHSA, affected `< 0.19.3`, **patched: not available**.

Оба advisory имеют статус *no fix* — SheetJS CE (npm-пакет `xlsx`) не публикует фиксы в npm с 2023 года, апгрейд невозможен. Единственный корректный путь — **удаление зависимости**.

**Что сделано** (commit `9dbf740`):
1. Конвертация `.xls`/`.xlsx` фикстур в JSON-снапшоты:
   - `tests/fixtures/t-20.02.26-1-561-110C.json` — 670 точек
   - `tests/fixtures/grace-fixture.json` — 1219 точек
2. Перевод `tests/utils/touch-point-fixture.test.ts` на `readFileSync(json)`.
3. Перевод `website/src/data/fixtureProfiles.ts` на `readFileSync(json)`.
4. One-time скрипты-конвертеры закоммичены (`scripts/utils/xls-to-json.mjs`, `grace-xlsx-to-json.mjs`) — обеспечивают воспроизводимость.
5. `npm uninstall xlsx` — пакет полностью удалён из `package.json` и `package-lock.json`.

**Проверка HEAD `origin/main`:**
```
git show origin/main:package.json | grep -c '"xlsx"'          → 0
git show origin/main:package-lock.json | grep -c 'xlsx'       → 0
grep -rn "from 'xlsx'\|require('xlsx')" src tests website      → 0 matches
```

**Оценка.**
| Критерий | Оценка |
|---|---|
| Оба advisory устранены (пакет физически отсутствует) | ✅ |
| Архитектурно правильный выбор (remove vs upgrade impossible) | ✅ |
| Воспроизводимость (конвертеры в репо) | ✅ |
| Обратная совместимость теста (тот же контракт, новый источник) | ✅ |

**Замечания.**
1. Коммит `3add774` изначально заявлял «оставить xlsx в devDeps, раз ExcelJS не читает .xls». Через 35 минут команда пересмотрела решение в `9dbf740` и полностью убрала пакет. Финальное состояние корректно, но промежуточный коммит в истории остался — **в changelog/release-notes должна быть отражена финальная позиция**, чтобы не запутать ревьюера.
2. JSON-фикстуры объёмные (~16 900 строк суммарно). Рекомендация: пометить в `.gitattributes`:
   ```
   tests/fixtures/*.json linguist-generated=true -diff
   ```
   Иначе они будут шуметь в будущих `git blame` и PR-review.

---

### 3.4 WP-1.4 — Аудит SQL-конкатенаций — ✅ 4/5

**Цель.** Проверить все `format!("SELECT|INSERT|UPDATE|DELETE …")` на наличие SQL-injection.

**Три места найдено:**

| Файл:строка | Строка | Вердикт |
|---|---|---|
| `experiments/export/mod.rs:206` | `format!("SELECT id FROM Experiment {} ORDER BY testDate DESC", where_clause)` | ✅ `where_clause` во всех 4 ветках собирается только из **литералов и `?`-плейсхолдеров**; значения идут через `params_ref: Vec<&dyn ToSql>` |
| `experiments/crud.rs:58` | `format!("SELECT id FROM Experiment WHERE id IN ({ph})")` где `ph = "?, ?, ?"` | ✅ значения передаются `params_from_iter(ids)` |
| `db/migration.rs:597` | `format!("SELECT COUNT(*) FROM {table}")` | ✅ внутри `#[cfg(test)] mod tests` — не prod |

**Вывод аудита корректен:** SQL-injection отсутствует.

**Замечания (причина -1 балла):**
1. **Не выполнен превентивный пункт плана** «helper `db::utils::placeholders(n)` + CI-grep запрет `format!(SELECT…)` без `#[allow]`». Без этого нет защиты от будущего регресса — кто-то может написать `format!("SELECT {user_filter} …")` и аудит пропустит.
2. Рекомендация — открыть follow-up issue на Фазу 5 (DX / гигиена).

---

### 3.5 WP-1.5 — Валидация входов `#[tauri::command]` — ⏳ TODO

Не начат. В плане отмечен как TODO — корректно.

**⚠️ Скрытый риск:** количество команд выросло с 88 (baseline в плане) до **93** (HEAD `main`). Значит, за период Фазы 1 добавлено 5 новых команд, и **нет свидетельств**, что они прошли валидационный чек-лист WP-1.5.

**Рекомендация.** Перед выполнением WP-1.5 провести gap-audit: 5 новых команд → отдельный чек-лист → при необходимости patch.

---

### 3.6 WP-1.6 — Упрочнение `.gitleaks.toml` — ⏳ TODO

Не начат, помечен TODO — корректно.

---

## 4. Общая сводка

| WP | План | Факт | Оценка | Критерий принятия |
|---|---|---|---|---|
| 1.1 | panic→Result в 4 местах | audit-only, правок не потребовалось | 5/5 | ✅ zero prod panic! |
| 1.2 | subtle::ConstantTimeEq | `Mac::verify_slice` (лучше) | 5/5 | ✅ constant-time |
| 1.3 | remove xlsx / replace with exceljs | JSON fixtures + remove | 5/5 | ✅ 0 advisories |
| 1.4 | audit + helper + CI-gate | audit only | 4/5 | ✅ audit, ⏳ prevention |
| 1.5 | валидация 88 IPC | — | n/a | ⏳ TODO |
| 1.6 | gitleaks hardening | — | n/a | ⏳ TODO |

**Итоговая оценка Фазы 1: 4.7/5 (принято с замечаниями).**

---

## 5. Соответствие инвариантам плана

| Инвариант | Соблюдён? | Доказательство |
|---|---|---|
| Лицензионный wire-формат стабилен | ✅ | HMAC hex-формат сохранён, RSA verify не менялась |
| Схема БД не менялась | ✅ | В diff нет миграций |
| Имена IPC-команд стабильны | ✅ | В diff нет переименований |
| Формат отчётов (PDF/Excel) не менялся | ✅ | report_generator не затронут |
| Machine fingerprint не менялся | ✅ | hardware.rs не затронут |

Все инварианты соблюдены.

---

## 6. Quality debt W1

Перечень мелких замечаний, не блокирующих переход к Фазе 2, но которые **должны** быть закрыты до релиза:

| # | Замечание | Приоритет | Куда относить |
|---|---|---|---|
| D-1 | Нет helper `db::utils::placeholders(n)` — дубли `"?, ?, ?"` | M | Фаза 5 (DX) |
| D-2 | Нет CI-grep запрета `format!("SELECT…")` без `#[allow]` | M | Фаза 5 / WP-5.4 |
| D-3 | 5 новых IPC-команд (88→93) не прошли WP-1.5 чек-лист | H | gap-audit перед WP-1.5 |
| D-4 | Нет `.gitattributes linguist-generated=true` для `tests/fixtures/*.json` | L | chore |
| D-5 | Нет ADR-записи о решении удалить SheetJS CE | M | docs/adr — см. ADR-0004 ниже |
| D-6 | В `crypto.rs` (и ряде файлов licensing/) видны остатки WINDOWS-1251 мусора в комментариях (строки 3, 23, 46 `crypto.rs`); WP-0.3 не полностью дотронулся до этого файла, либо регрессировало | M | Фаза 0 / re-run WP-0.3 |
| D-7 | `npm overrides` для блокировки повторного появления `xlsx` не настроены | M | chore |
| D-8 | Промежуточный коммит `3add774` декларировал «keep xlsx» — в release-notes должна быть финальная позиция | L | release-notes |

---

## 7. Регрессивная защита

Меры, чтобы W1-дефекты не вернулись:

### 7.1 Уже на месте
- Тесты `crypto_tests.rs` (HMAC round-trip, tamper-resistance).
- `cargo test --manifest-path src-tauri/Cargo.toml` покрывает licensing.
- JSON-фикстуры вместо бинарных xlsx → нет возможности случайно импортировать `xlsx`.

### 7.2 Рекомендуется добавить
1. `package.json` → `"overrides": { "xlsx": "npm:@empty/noop@*" }` либо `resolutions` (yarn).
2. CI workflow step:
   ```yaml
   - name: Ban SheetJS CE
     run: |
       npm ls xlsx 2>/dev/null && { echo "xlsx is banned (W1/D-7)"; exit 1; } || true
   ```
3. Кастомное eslint-правило `no-restricted-imports`:
   ```js
   { "patterns": [{ "group": ["xlsx"], "message": "xlsx banned (see ADR-0004)" }] }
   ```
4. Перевести `format!(...SELECT/INSERT/UPDATE/DELETE)` в clippy-lint через `disallowed_macros` в `clippy.toml` или pre-commit regex-check.

---

## 8. Рекомендации по Фазе 2

Перед запуском Фазы 2 (Reliability):
1. **Закрыть D-6** (моджибейк в `licensing/` — безопасно-критичный модуль не должен содержать повреждённых комментариев).
2. **Закрыть D-3** (gap-audit для 5 новых команд).
3. **Открыть issue** по каждому пункту quality debt (D-1..D-8) с меткой `refactor/phase-1/quality-debt`.
4. **ADR-0004** (см. рядом в `docs/adr/`) — зафиксировать решение «no SheetJS CE» архитектурно, чтобы следующее поколение разработчиков не вернуло пакет.

---

## 9. Вердикт

**Фаза 1 «Безопасность» принята.**

Все заявленные цели достигнуты, критические уязвимости устранены, инварианты плана соблюдены. Реализация WP-1.2 качественнее, чем предполагалось планом. WP-1.3 выполнен в архитектурно правильной форме (remove вместо невозможного upgrade).

Перед переходом к Фазе 2 — закрыть позиции `D-3` и `D-6` из § 6, остальные могут быть распределены по фазам 2–5.

---

## Приложения

- **ADR-0004 «No SheetJS CE»** — [`docs/adr/ADR-0004-no-sheetjs-ce.md`](../adr/ADR-0004-no-sheetjs-ce.md)
- Оригинальные advisory для `xlsx@0.18.5`:
  - SheetJS ReDoS (affected `< 0.20.2`, patched: not available)
  - SheetJS Prototype Pollution (affected `< 0.19.3`, patched: not available)
- План рефакторинга — [`docs/REFACTORING_DEEP_PLAN.md`](../REFACTORING_DEEP_PLAN.md)
