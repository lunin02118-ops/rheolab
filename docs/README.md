# Карта документации

В репозитории смешаны живая документация, сгенерированные audit-артефакты, исторические планы и справочные материалы по домену. Этот файл нужен, чтобы быстро находить текущий источник правды.

## Живые документы

Эти файлы должны описывать систему в её текущем состоянии:

- [ARCHITECTURE.md](ARCHITECTURE.md) — структура репозитория, runtime-архитектура, модель данных и границы доверия
- [CONTRIBUTING.md](CONTRIBUTING.md) — процесс работы для разработчиков, правила изменения схемы, требования к тестам
- [RELEASE_AND_DEPLOY.md](RELEASE_AND_DEPLOY.md) — релизный конвейер, updater flow и проверка деплоя
- [SERVER_ACCESS.md](SERVER_ACCESS.md) — SSH/key-based доступ к deploy-серверу
- [testing/TEST_METHODOLOGY.md](testing/TEST_METHODOLOGY.md) — основные точки входа в тестирование и аудит
- [testing/LICENSE_TESTING_METHODOLOGY.md](testing/LICENSE_TESTING_METHODOLOGY.md) — покрытие и проверки для licensing-контура
- [database/DEVELOPER_GUIDE.md](database/DEVELOPER_GUIDE.md) — внутренности БД и заметки по схеме
- [adr/](adr/) — архитектурные решения, которые сохраняют историческую актуальность

## Документация подсистем вне `docs/`

Часть важных руководств лежит рядом со своей подсистемой:

- [license-server/docs/README.md](../license-server/docs/README.md) — документация PHP license/update server
- [scripts/README.md](../scripts/README.md) — вспомогательные скрипты и npm-команды
- [website/README.md](../website/README.md) — Astro-сайт
- [website/SPECIFICATION.md](../website/SPECIFICATION.md) — спецификация сайта/продукта

## Исторические и сгенерированные материалы

Эти папки полезны как контекст, но не являются главным источником правды по текущему поведению:

- [audit/](audit/) — политика и указатели на generated audit output
- [plans/](plans/) — исторические planning-документы
- [performance/](performance/) — baseline-ы, датированные отчёты и deep audits
- [reagents/](reagents/) — исходные материалы и исследовательские assets по реагентам

Сгенерированные audit и QA артефакты пишутся в:

```text
runtime/audit/<run-id>/
runtime/reports/
```

Если есть выбор между ними и старой рукописной audit-заметкой, доверять нужно сгенерированным артефактам.

## Порядок чтения для новых участников

1. [../README.md](../README.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [CONTRIBUTING.md](CONTRIBUTING.md)
4. [testing/TEST_METHODOLOGY.md](testing/TEST_METHODOLOGY.md)
5. [RELEASE_AND_DEPLOY.md](RELEASE_AND_DEPLOY.md), если вы трогаете updater/release/deploy paths

## Политика по документации

- Живые документы должны быть сфокусированы на текущей реализации.
- Датированные находки и разовые расследования лучше складывать в `runtime/` или в dated reports.
- Не хардкодьте быстро устаревающие величины, например количество команд или тестов.
- Если workflow зависит от окружения, это нужно писать прямо.
