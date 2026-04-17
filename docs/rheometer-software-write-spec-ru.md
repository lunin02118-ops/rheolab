# Техническое задание: интеграция ПО реометра с базой данных RheoLab

**Версия:** 1.1 · **Дата:** 2026-04-17 · **Статус:** Актуально  
**Применяется к:** RheoLab Enterprise ≥ 0.2.0-beta.5, `schema_version = 1`

---

## 1. Назначение

Это ТЗ описывает минимально безопасный и совместимый способ записи данных из ПО реометра в SQLite-базу RheoLab.

Цель первой версии интеграции:

- обеспечить прямую запись эксперимента в базу;
- не ломать текущую модель чтения RheoLab;
- не требовать немедленной реализации бинарного формата `ExperimentData`;
- дать точный контракт по SQL, транзакциям и обязательным полям.

## 2. Принятый профиль интеграции

Для первой реализации обязателен профиль:

- `Compatibility Write v1`

Этот профиль означает:

- запись метаданных в `Experiment`;
- запись точек измерений в `Experiment.rawPoints` как JSON;
- запись реагентов в `ExperimentReagent`;
- `ExperimentData` не используется;
- `ImportBatch`, `ExperimentPayload`, `ParserArtifact`, `SearchProjectionLog`, `SyncOutbox` не создаются.

Важно:

- RheoLab умеет читать такой формат благодаря fallback-логике;
- это не полностью нативный режим хранения, но он совместим с текущим кодом приложения.

## 3. Условия совместимости

Перед началом записи внешнее ПО обязано проверить:

```sql
SELECT schema_version, app_version
FROM schema_meta
WHERE id = 1;
```

Ожидаемое условие:

- `schema_version = 1`

Если значение другое:

- запись запрещена;
- нужно переключать интеграцию на новый профиль схемы.

## 4. Обязательные таблицы

Для `Compatibility Write v1` используются только:

- `User`
- `Laboratory`
- `Experiment`
- `ExperimentReagent`

Дополнительно читать можно:

- `schema_meta`

## 5. Общие правила работы с SQLite

ПО реометра должно соблюдать следующие требования:

1. Открывать соединение в WAL-aware режиме.
2. Перед записью включать `foreign_keys`.
3. Использовать короткую транзакцию на один эксперимент.
4. Не использовать `INSERT OR REPLACE` для `Experiment`.
5. Использовать `busy_timeout >= 5000`.
6. На `SQLITE_BUSY` делать retry с backoff.

Рекомендуемые PRAGMA:

```sql
PRAGMA journal_mode = WAL;      -- убедиться, что БД открыта в WAL-режиме
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

## 6. Минимальный набор полей для записи в `Experiment`

Ниже перечислены поля, которые считаются обязательными для первой версии прямой записи.

### 6.1. Обязательные поля

| Поле | Тип | Обязательность | Комментарий |
|---|---|---|---|
| `id` | `TEXT` | Да | Уникальный идентификатор эксперимента |
| `createdAt` | `TEXT` | Да | ISO 8601 UTC |
| `updatedAt` | `TEXT` | Да | ISO 8601 UTC |
| `originalFilename` | `TEXT` | Да | Имя исходного файла реометра |
| `testDate` | `TEXT` | Да | Дата испытания |
| `instrumentType` | `TEXT` | Да | Тип прибора |
| `name` | `TEXT` | Да | Уникальное имя эксперимента |
| `waterSource` | `TEXT` | Да | Источник воды |
| `fluidType` | `TEXT` | Да | Тип жидкости |
| `testGroup` | `TEXT` | Да | Группа теста |
| `metrics` | `TEXT` | Да | JSON-объект |
| `rawPoints` | `TEXT` | Да | JSON-массив точек |
| `userId` | `TEXT` | Да | Существующий `User.id` |

### 6.2. Обязательные для корректной работы summary-поля

Эти поля должны быть вычислены на стороне ПО реометра перед записью:

| Поле | Тип | Обязательность | Комментарий |
|---|---|---|---|
| `durationSeconds` | `INTEGER` | Да | Длительность по точкам (секунды) |
| `avgTemperatureC` | `REAL` | Да | Средняя температура |
| `maxTemperatureC` | `REAL` | Да | Максимальная температура |
| `maxViscosity` | `INTEGER` | Да | Максимальная вязкость |
| `avgViscosity` | `INTEGER` | Да | Средняя вязкость |

### 6.3. Рекомендуемые, но не обязательные поля

| Поле | Тип |
|---|---|
| `fieldName` | `TEXT` |
| `operatorName` | `TEXT` |
| `wellNumber` | `TEXT` |
| `testId` | `TEXT` |
| `geometry` | `TEXT` |
| `geometrySource` | `TEXT` |
| `waterParams` | `TEXT` JSON |
| `testSubGroup` | `TEXT` |
| `calibration` | `TEXT` JSON |
| `laboratoryId` | `TEXT` |
| `parsedBy` | `TEXT` |
| `parseSource` | `TEXT` |
| `timeRangeMin` | `REAL` |
| `timeRangeMax` | `REAL` |
| `viscosityMin` | `INTEGER` |
| `pressureMax` | `REAL` |
| `extraFields` | `TEXT` JSON |
| `testCategory` | `TEXT` |
| `testType` | `TEXT` |
| `dominantPattern` | `TEXT` |
| `waterSourceId` | `TEXT` |

> **Примечание.** `waterSourceId` — FK на `WaterSourceCatalog(id)`. Заполнять только при наличии соответствующей записи в каталоге. `waterSource` (денормализованная текстовая копия) и `waterSourceId` (ссылка) независимы: допустимо заполнить оба или только `waterSource`.

## 7. Минимальный контракт по JSON

### 7.1. `metrics`

`metrics` должен быть сериализован как JSON-объект.

Минимально рекомендуемый состав:

```json
{
  "maxViscosity": 850,
  "avgViscosity": 600
}
```

### 7.2. `rawPoints`

`rawPoints` должен быть сериализован как JSON-массив объектов.

Минимально обязательный формат точки для `Compatibility Write v1`:

```json
[
  {
    "time_sec": 0,
    "viscosity_cp": 800,
    "temperature_c": 25.0
  },
  {
    "time_sec": 60,
    "viscosity_cp": 850,
    "temperature_c": 63.0
  }
]
```

Минимально обязательные ключи:

- `time_sec`
- `viscosity_cp`
- `temperature_c`

Но стек RheoLab понимает и дополнительные каналы.

Поддерживаемые расширенные ключи:

- `shear_rate`
- `shear_rate_s1`
- `shear_stress`
- `shear_stress_pa`
- `pressure_bar`
- `pressure`
- `rpm`
- `speed_rpm`
- `bath_temperature_c`

Также на frontend-уровне schema допускает:

- `ph`

Важно:

1. Для первой версии интеграции достаточно трех ключей:
   - `time_sec`
   - `viscosity_cp`
   - `temperature_c`
2. Если ПО реометра умеет отдавать больше каналов, их лучше записывать тоже.
3. Для typed-analysis и schedule/physics pipeline самые полезные дополнительные поля:
   - `shear_rate`
   - `shear_stress`
   - `pressure_bar`
   - `speed_rpm`
   - `bath_temperature_c`
4. При использовании alias-ключей совместимость частично есть, но в ТЗ рекомендуется писать канонические snake_case-имена.

Рекомендуемый расширенный формат точки:

```json
[
  {
    "time_sec": 0,
    "viscosity_cp": 800,
    "temperature_c": 25.0,
    "shear_rate": 170.0,
    "shear_stress": 8.5,
    "pressure_bar": 1.2,
    "speed_rpm": 300.0,
    "bath_temperature_c": 24.8
  }
]
```

### 7.2.a. Таблица полей `rawPoints`

Ниже указано:

- какое имя поля рекомендуется использовать при прямой записи в БД;
- какие алиасы реально понимает кодовая база;
- где это поле используется.

| Рекомендуемое имя при direct-write | Допустимые алиасы | Где используется в RheoLab | Статус |
|---|---|---|---|
| `time_sec` | `timeSec`, `time` | summary-вычисления длительности, core `RheoPoint`, schedule/analysis pipeline | Обязательно |
| `viscosity_cp` | `viscosityCp`, `viscosity` | summary-вычисления вязкости, core `RheoPoint`, analysis pipeline | Обязательно |
| `temperature_c` | `temperatureC`, `temperature` | summary-вычисления температуры, core `RheoPoint`, analysis pipeline | Обязательно |
| `shear_rate` | `shearRate`, `shear_rate_s1` | analysis pipeline, schedule grouping, physics/validation; в parser/frontend часто встречается `shear_rate_s1` | Рекомендуется |
| `shear_stress` | `shearStress`, `shear_stress_pa` | analysis pipeline, physics/validation | Рекомендуется |
| `pressure_bar` | `pressureBar`, `pressure` | analysis pipeline, parsing summary, pressure range | Рекомендуется |
| `rpm` | `speed_rpm`, `speedRpm` | parsing/frontend типы; Rust сериализует это поле как `rpm` — именно это имя используется при записи в `ExperimentData` | Рекомендуется |
| `bath_temperature_c` | `bathTemperatureC` | дополнительные thermal-данные, optional sensor channel | Опционально |
| `ph` | нет backend alias-контракта | допускается frontend schema, но backend summary/analysis на это поле не опирается | Опционально |

### 7.2.b. Практические правила по именованию каналов

1. Для обязательных полей всегда писать канонические snake_case имена:
   - `time_sec`
   - `viscosity_cp`
   - `temperature_c`
2. Для расширенных каналов в direct-write тоже рекомендуется snake_case:
   - `shear_rate`
   - `shear_stress`
   - `pressure_bar`
   - `rpm`
   - `bath_temperature_c`
3. Если внешний формат реометра уже отдает camelCase или parser-style имена, их можно маппить в канонические имена на стороне интегратора до записи в БД.
4. Не стоит смешивать в одной и той же точке сразу оба имени одного канала, например:
   - `shear_rate` и `shear_rate_s1`
   - `rpm` и `speed_rpm`
5. Для direct-write: один физический канал — один ключ.

### 7.2.c. Почему в ТЗ обязательны только 3 поля

Backend summary-логика при Compatibility Write v1 опирается исключительно на:

- `time_sec` / `timeSec`
- `viscosity_cp` / `viscosityCp`
- `temperature_c` / `temperatureC`

Именно по ним вычисляются:

- `durationSeconds`
- `avgTemperatureC`
- `maxTemperatureC`
- `avgViscosity`

Остальные каналы расширяют аналитическую ценность данных, но не являются минимальным blocking-контрактом для `Compatibility Write v1`.

## 8. Требования к генерации `id`

Идентификатор эксперимента должен быть уникальным в пределах базы.

Допустимые варианты:

1. UUID.
2. Собственный deterministic/hashed id.
3. Формат, совместимый с текущим стилем RheoLab, например `exp_<hash>`.

Требование:

- `id` не должен меняться при update того же эксперимента.

## 9. Требования к `User`

Так как `Experiment.userId` обязателен, перед записью должен существовать пользователь.

Разрешены два режима:

1. Использовать уже существующего пользователя.
2. Использовать локального технического пользователя.

Для технического пользователя рекомендуется:

- `id = 'desktop-local-admin'`
- `name = 'Local Admin'`
- `email = 'local@desktop'`
- `role = 'admin'`
- `isActive = 1`

SQL:

```sql
INSERT OR IGNORE INTO User
(
  id,
  name,
  email,
  role,
  isActive,
  createdAt,
  updatedAt
)
VALUES
(
  :user_id,
  :user_name,
  :user_email,
  :user_role,
  1,
  :now_iso,
  :now_iso
);
```

## 10. Требования к `Laboratory`

Если `laboratoryId` не используется:

- допускается `NULL`

Если `laboratoryId` заполняется:

- строка в `Laboratory` должна существовать до записи `Experiment`

SQL:

```sql
INSERT OR IGNORE INTO Laboratory
(
  id,
  name,
  createdAt,
  updatedAt
)
VALUES
(
  :lab_id,
  :lab_name,
  :now_iso,
  :now_iso
);
```

## 11. Порядок транзакции на запись одного эксперимента

Ниже приведен обязательный порядок операций.

### 11.1. Алгоритм

1. Проверить `schema_meta`.
2. Открыть соединение.
3. Выполнить `PRAGMA foreign_keys = ON`.
4. Выполнить `PRAGMA busy_timeout = 5000`.
5. Начать транзакцию `BEGIN IMMEDIATE`.
6. Обеспечить наличие строки в `User`.
7. При необходимости обеспечить наличие строки в `Laboratory`.
8. Выполнить pre-check по конфликту имени эксперимента.
9. Выполнить upsert в `Experiment`.
10. Удалить старые реагенты `ExperimentReagent` по `experimentId`.
11. Вставить новый набор реагентов.
12. Сделать post-write verification.
13. Выполнить `COMMIT`.

Если любой шаг завершился ошибкой:

- выполнить `ROLLBACK`

### 11.2. Почему именно такой порядок

- `User` и `Laboratory` нужны до вставки `Experiment` из-за FK.
- `Experiment` должен существовать до вставки `ExperimentReagent`.
- Реагенты удобнее пересобирать целиком, чем делать частичный merge.

## 12. SQL-схема операций

Ниже приведен рекомендованный SQL-контракт для `Compatibility Write v1`.

### 12.1. Начало транзакции

```sql
BEGIN IMMEDIATE;
```

### 12.2. Upsert в `Experiment`

### 12.2.a. Pre-check по имени эксперимента

Перед upsert рекомендуется выполнить прикладную проверку уникальности имени:

```sql
SELECT id, createdAt
FROM Experiment
WHERE name = :name COLLATE NOCASE
LIMIT 1;
```

Правило обработки:

- если строка не найдена, можно продолжать запись;
- если строка найдена и `id == :id`, это update того же эксперимента, можно продолжать;
- если строка найдена и `id != :id`, запись запрещена как конфликт имени.

Запрещено:

```sql
INSERT OR REPLACE INTO Experiment ...
```

Разрешено только через `ON CONFLICT(id) DO UPDATE`.

Рекомендуемый SQL:

```sql
INSERT INTO Experiment
(
  id,
  createdAt,
  updatedAt,
  originalFilename,
  testDate,
  instrumentType,
  geometry,
  geometrySource,
  durationSeconds,
  avgTemperatureC,
  maxTemperatureC,
  maxViscosity,
  avgViscosity,
  name,
  fieldName,
  operatorName,
  wellNumber,
  testId,
  waterSource,
  waterParams,
  fluidType,
  testGroup,
  testSubGroup,
  metrics,
  rawPoints,
  calibration,
  userId,
  laboratoryId,
  parsedBy,
  parseSource,
  timeRangeMin,
  timeRangeMax,
  viscosityMin,
  pressureMax,
  extraFields,
  testCategory,
  testType,
  dominantPattern
)
VALUES
(
  :id,
  :created_at,
  :updated_at,
  :original_filename,
  :test_date,
  :instrument_type,
  :geometry,
  :geometry_source,
  :duration_seconds,
  :avg_temperature_c,
  :max_temperature_c,
  :max_viscosity,
  :avg_viscosity,
  :name,
  :field_name,
  :operator_name,
  :well_number,
  :test_id,
  :water_source,
  :water_params_json,
  :fluid_type,
  :test_group,
  :test_sub_group,
  :metrics_json,
  :raw_points_json,
  :calibration_json,
  :user_id,
  :laboratory_id,
  :parsed_by,
  :parse_source,
  :time_range_min,
  :time_range_max,
  :viscosity_min,
  :pressure_max,
  :extra_fields_json,
  :test_category,
  :test_type,
  :dominant_pattern
)
ON CONFLICT(id) DO UPDATE SET
  updatedAt = excluded.updatedAt,
  originalFilename = excluded.originalFilename,
  testDate = excluded.testDate,
  instrumentType = excluded.instrumentType,
  geometry = excluded.geometry,
  geometrySource = excluded.geometrySource,
  durationSeconds = excluded.durationSeconds,
  avgTemperatureC = excluded.avgTemperatureC,
  maxTemperatureC = excluded.maxTemperatureC,
  maxViscosity = excluded.maxViscosity,
  avgViscosity = excluded.avgViscosity,
  name = excluded.name,
  fieldName = excluded.fieldName,
  operatorName = excluded.operatorName,
  wellNumber = excluded.wellNumber,
  testId = excluded.testId,
  waterSource = excluded.waterSource,
  waterParams = excluded.waterParams,
  fluidType = excluded.fluidType,
  testGroup = excluded.testGroup,
  testSubGroup = excluded.testSubGroup,
  metrics = excluded.metrics,
  rawPoints = excluded.rawPoints,
  calibration = excluded.calibration,
  userId = excluded.userId,
  laboratoryId = excluded.laboratoryId,
  parsedBy = excluded.parsedBy,
  parseSource = excluded.parseSource,
  timeRangeMin = excluded.timeRangeMin,
  timeRangeMax = excluded.timeRangeMax,
  viscosityMin = excluded.viscosityMin,
  pressureMax = excluded.pressureMax,
  extraFields = excluded.extraFields,
  testCategory = excluded.testCategory,
  testType = excluded.testType,
  dominantPattern = excluded.dominantPattern;
```

Критичное правило:

- `createdAt` не обновлять при конфликте.

### 12.3. Очистка старых реагентов

```sql
DELETE FROM ExperimentReagent
WHERE experimentId = :experiment_id;
```

### 12.4. Вставка новых реагентов

Для каждого реагента:

```sql
INSERT INTO ExperimentReagent
(
  id,
  experimentId,
  reagentId,
  reagentName,
  category,
  concentration,
  unit,
  batchNumber,
  productionDate
)
VALUES
(
  :reagent_row_id,
  :experiment_id,
  :reagent_id,
  :reagent_name,
  :category,
  :concentration,
  :unit,
  :batch_number,
  :production_date
);
```

Если реагентов нет:

- шаг удаления выполнять все равно;
- вставки пропустить.

### 12.5. Завершение транзакции

```sql
COMMIT;
```

При ошибке:

```sql
ROLLBACK;
```

## 13. Post-write verification

После записи обязательно выполнить контрольные запросы.

### 13.1. Проверка наличия эксперимента

```sql
SELECT COUNT(*)
FROM Experiment
WHERE id = :experiment_id;
```

Ожидается:

- `1`

### 13.2. Проверка валидности реагентов

```sql
SELECT COUNT(*)
FROM ExperimentReagent
WHERE experimentId = :experiment_id;
```

Ожидается:

- `N`, где `N` равно количеству отправленных реагентов

### 13.3. Проверка read-back

Рекомендуется выполнить:

```sql
SELECT
  id,
  name,
  rawPoints,
  metrics,
  maxViscosity,
  avgViscosity
FROM Experiment
WHERE id = :experiment_id;
```

И проверить:

- JSON в `rawPoints` валиден;
- JSON в `metrics` валиден;
- summary-поля не пустые.

## 14. Правила обновления существующего эксперимента

Если обновляется уже существующий эксперимент:

1. Использовать тот же `id`.
2. Сохранять исходный `createdAt`.
3. Обновлять `updatedAt`.
4. Полностью пересчитывать summary-поля.
5. Полностью пересобирать `ExperimentReagent`.

## 15. Правила обработки ошибок

### 15.1. Ошибки, при которых запись запрещена

- `schema_meta.schema_version != 1`
- отсутствует обязательный `User`
- `name` пустой
- `waterSource` пустой
- `rawPoints` невалидный JSON
- `metrics` невалидный JSON
- ошибка `FOREIGN KEY`

### 15.2. Ошибки, при которых делать retry

- `SQLITE_BUSY`
- кратковременные lock-conflicts

Рекомендуемая схема retry:

1. Первая попытка сразу.
2. Затем 3 повторные попытки.
3. Backoff: 200 ms, 500 ms, 1000 ms.

## 16. Что запрещено разработчику ПО реометра

Запрещено:

1. Использовать `INSERT OR REPLACE` для `Experiment`.
2. Писать напрямую в `fts_experiment`.
3. Менять `createdAt` при update.
4. Писать `laboratoryId`, если строки в `Laboratory` не существует.
5. Писать `userId`, если строки в `User` не существует.
6. Выполнять длинную транзакцию на много экспериментов в live-файле.
7. Писать в `ExperimentData` в первой версии интеграции.

## 17. Рекомендуемый объект параметров записи

Рекомендуемый внутренний DTO для записи одного эксперимента:

```json
{
  "id": "exp_1234567890",
  "createdAt": "2026-04-17T10:00:00Z",
  "updatedAt": "2026-04-17T10:00:00Z",
  "originalFilename": "test_001.xlsx",
  "testDate": "2026-04-17",
  "instrumentType": "BSL R1",
  "name": "Test BSL 63C",
  "waterSource": "Lake 274",
  "fluidType": "Crosslinked",
  "testGroup": "Completion",
  "metrics": {
    "maxViscosity": 850,
    "avgViscosity": 600
  },
  "rawPoints": [
    {
      "time_sec": 0,
      "viscosity_cp": 800,
      "temperature_c": 25.0
    },
    {
      "time_sec": 60,
      "viscosity_cp": 850,
      "temperature_c": 63.0
    }
  ],
  "durationSeconds": 60,
  "avgTemperatureC": 44.0,
  "maxTemperatureC": 63.0,
  "maxViscosity": 850,
  "avgViscosity": 825,
  "userId": "desktop-local-admin",
  "reagents": [
    {
      "id": "er_1",
      "reagentName": "WG-9000F",
      "category": "Viscosifier",
      "concentration": 3.4,
      "unit": "kg/m3",
      "batchNumber": "B42",
      "productionDate": null
    }
  ]
}
```

## 18. Объём реализации для версии 1

В первую версию должны войти:

1. Проверка `schema_meta`.
2. Поддержка `User`.
3. Поддержка `Laboratory` при необходимости.
4. Upsert в `Experiment`.
5. Пересборка `ExperimentReagent`.
6. Retry на `SQLITE_BUSY`.
7. Post-write verification.

Во вторую версию можно отложить:

1. `ExperimentData`
2. `SyncOutbox`
3. `ExperimentPayload`
4. `ParserArtifact`
5. `ImportBatch`
6. `SearchProjectionLog`

## 19. Критерии приёмки

Реализация считается принятой, если:

1. Новый эксперимент после записи открывается в RheoLab без ошибок.
2. Эксперимент виден в списке и корректно фильтруется.
3. Summary-поля отображаются корректно.
4. Реагенты отображаются корректно.
5. Повторная запись того же `id` не теряет `createdAt`.
6. Нет `FOREIGN KEY` ошибок.
7. Нет использования `INSERT OR REPLACE`.

## 20. Следующий этап после версии 1

После успешной реализации `Compatibility Write v1` следующим этапом может быть:

- переход на нативный режим `ExperimentData`
- запись `rawPoints = '[]'`
- реализация columnar binary + zstd

Но это не входит в текущее ТЗ.
