## Описание

<!-- Краткое описание изменений и причины их внесения -->

## Тип изменения

- [ ] `feat` — новая функция
- [ ] `fix` — исправление бага
- [ ] `refactor` — рефакторинг (без изменения поведения)
- [ ] `docs` — только документация
- [ ] `test` — тесты
- [ ] `perf` — улучшение производительности
- [ ] `chore` — сборка, зависимости, tooling

## Связанные задачи / Issue

<!-- Closes #NNN -->

## Чек-лист перед мержем

- [ ] `cargo test` — 0 failures (52 тестов)
- [ ] `npm test` — 0 failures (489 тестов)
- [ ] `npm run test:desktop-core` — golden suite парсера зелёная при любых изменениях parsing
- [ ] Real Groq smoke tests, если менялся AI parsing: `RUN_REAL_GROQ_AI_TESTS=1` + `GROQ_API_KEY` + `cargo test --manifest-path src-tauri/Cargo.toml --test ai_parsing test_ai_smoke_ -- --nocapture`
- [ ] Unsanitized Groq fixture tests, если нужен ручной боевой прогон: `RUN_REAL_GROQ_FIXTURE_TESTS=1` + `GROQ_API_KEY` + `cargo test --manifest-path src-tauri/Cargo.toml --test ai_parsing test_ai_ -- --nocapture`
- [ ] `cargo clippy -- -D warnings` — 0 предупреждений
- [ ] Нет `unwrap()` в продакшн-путях (используется `?`)
- [ ] Нет `console.log` в TypeScript
- [ ] Новые Tauri-команды покрыты Rust unit-тестом
- [ ] Изменения схемы БД: обновлён `V1_DDL` + добавлена `migrate_vN` + обновлён `DEVELOPER_GUIDE.md`
- [ ] Документация обновлена (если изменились публичные интерфейсы)

## Скриншоты / Запись экрана

<!-- При изменениях UI -->
