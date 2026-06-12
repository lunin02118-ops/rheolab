# План 008: Окно «О программе» с лицензией и каналами поддержки

> **Инструкция исполнителю**: выполняй план строго по шагам. После каждого
> шага запускай указанную проверку. При любом условии из «Условия STOP» —
> остановись и доложи. По завершении обнови строку статуса этого плана в
> `plans/README.md`.
>
> **Проверка дрейфа (выполнить первой)**:
> `git grep -n "LicenseStatusBadge" -- src/app src/components`
>
> Ожидаемо:
> - `src/app/dashboard/DashboardLayoutClient.tsx` использует badge как
>   header action.
> - `src/components/licensing/LicenseStatusBadge.tsx` содержит label
>   `Лицензия`.
>
> Если кнопка лицензии уже заменена на «О программе» — пометить план
> `REJECTED` в индексе как уже выполненный. Если точек входа больше двух —
> STOP и сначала сверить UX с владельцем.

## Статус

- **Приоритет**: P2
- **Трудозатраты**: M
- **Риск**: MEDIUM
- **Зависит от**: нет
- **Категория**: UX + supportability
- **Составлен на**: коммит `a7615b9`, 2026-06-12

## Цель

Заменить header-кнопку «Лицензия» на «О программе». Новая кнопка открывает
одно модальное окно с двумя вкладками:

1. **О программе** — версия, сайт, контакты поддержки, обучающие видео,
   MAX QR и QR раздела видео.
2. **Лицензия** — текущий статус и существующая активация лицензии.

Сценарий принудительной блокировки (`LicenseGuard`) должен остаться
лицензионным и не превращаться в support/about-экран: когда приложение
заблокировано, пользователь должен сразу видеть форму активации.

## Контакты для вкладки «О программе»

- Сайт: `https://rheolab.site/`
- Обучающие видео: `https://rheolab.site/#videos`
- Коммерческие вопросы и лицензии: `info@rheolab.site`
- Техническая поддержка: `support@rheolab.site`
- Телефон 1: `+77058030863` (отображать как `+7 705 803 08 63`)
- Телефон 2: `+79828801822` (отображать как `+7 982 880 18 22`)
- MAX: `https://max.ru/u/f9LHodD0cOLW63HIbnNK90e5lAP3IS6U_IUOXd6wLaSn6rG1aA2-zACiIUE`
- QR-исходник от владельца:
  `C:\Users\VladimirWorkPC\Desktop\photo_2026-06-12_09-23-19.jpg`

Email-адреса подтверждены локальным сайтом:
`website/src/components/Contact.astro`, `website/src/pages/about.astro`,
`website/public/llms.txt`.

Раздел обучающих видео подтверждён локальным сайтом:
`website/src/components/site/Navbar.astro` содержит ссылку `/#videos`,
`website/src/components/site/Videos.astro` содержит секцию `id="videos"`.

## UX-решение

- В header справа вместо `LicenseStatusBadge` показать компактную кнопку
  `О программе` с иконкой `Info` из `lucide-react`.
  - `aria-label`: `О программе, поддержка и лицензия`.
  - Tooltip/title: `Версия, поддержка, обучение и лицензия`.
- Кнопка открывает новый компонент, например
  `src/components/about/AboutProgramDialog.tsx`.
- Модалка использует существующие `Dialog` + `Tabs`:
  - `TabsTrigger value="about"`: `О программе`
  - `TabsTrigger value="license"`: `Лицензия`
- При обычном открытии активна вкладка `О программе`.
- При клике из `TrialBanner` активна вкладка `Лицензия`, чтобы CTA
  `Активировать корпоративную лицензию` сохранил прямой смысл.
- `LicenseGuard` продолжает использовать `LicenseActivationDialog`
  напрямую с `forceBlock=true`.

### Пользовательская логика окна

Окно должно отвечать на три простых вопроса без чтения инструкции:

1. **Что это за программа?** Название, версия, дата сборки, сайт.
2. **Как получить помощь?** Поддержка по email, MAX, телефоны, копирование.
3. **Где научиться пользоваться?** Явная кнопка `Обучающие видео` и QR.

Структура вкладки `О программе`:

1. Верхний блок:
   - `RheoLab Enterprise`
   - версия/сборка/коммит
   - короткое описание: `Профессиональный анализ реологических данных`
2. Блок `Быстрые действия` первым после версии:
   - primary/выделенная кнопка `Обучающие видео`
   - кнопка `Написать в поддержку`
   - кнопка `Коммерческие вопросы`
   - кнопка `Открыть MAX`
   - вторичная кнопка `Открыть сайт`
3. Блок `QR-коды`:
   - `Связаться в MAX` + QR MAX + подпись `Наведите камеру телефона`
   - `Обучающие видео` + QR видео + подпись `Откроет раздел видео на сайте`
4. Блок `Контакты`:
   - email и телефоны показывать человекочитаемо
   - рядом с каждым действием давать кнопку открыть и кнопку скопировать
   - после копирования показывать короткий статус `Скопировано`

Копирайтинг должен быть глагольным и понятным:

- хорошо: `Обучающие видео`, `Написать в поддержку`, `Открыть MAX`,
  `Скопировать телефон`.
- плохо: голые URL как основная кнопка, `Info`, `Contact`, `QR 1`, `QR 2`.

Визуально окно должно быть спокойным рабочим интерфейсом, а не промо-страницей:
без hero-блоков, без декоративных градиентов, без карточек внутри карточек.
Использовать простые секции с заголовками, иконками и ровной сеткой. На узком
экране все блоки идут одной колонкой, QR не должен вытеснять контакты.

## Объём

**В объёме**:

- `src/app/dashboard/DashboardLayoutClient.tsx`
  - заменить state `showActivation` на состояние about-dialog:
    `showAboutDialog` + `aboutInitialTab`.
  - заменить lazy import `LicenseActivationDialog` на новый
    `AboutProgramDialog` для обычного header/trial entrypoint.
  - оставить `LicenseGuard` без изменений.
- `src/components/about/AboutProgramDialog.tsx` (новый)
  - модальное окно `sm:max-w-2xl` или близко к существующему размеру.
  - вкладка «О программе» с версией, быстрыми действиями, контактами,
    обучающими видео, QR и кнопками открытия/копирования.
  - вкладка «Лицензия» с переиспользованным содержимым лицензии.
- `src/components/licensing/LicenseActivationDialog.tsx`
  - вынести внутреннее содержимое лицензии в компонент без собственного
    `Dialog`, например `LicenseActivationPanel`.
  - сохранить текущий `LicenseActivationDialog` как thin wrapper для
    `LicenseGuard` и обратной совместимости.
- `src/components/licensing/LicenseStatusBadge.tsx`
  - либо удалить из header-пути, либо оставить только для будущих мест.
    Если остаётся, его label `Лицензия` не должен быть видимой header-кнопкой.
- `src/assets/support/max-vladimir-qr.jpg` или
  `src/assets/support/max-vladimir-qr.png`
  - добавить QR asset из предоставленного изображения.
  - Предпочтительно подготовить чистый квадратный QR без лишнего фона; если
    быстро не получается, использовать предоставленное изображение как есть,
    но ограничить размеры в UI.
- `src/assets/support/rheolab-videos-qr.png` или
  `src/assets/support/rheolab-videos-qr.svg`
  - добавить статический QR asset, кодирующий
    `https://rheolab.site/#videos`.
  - Не использовать внешний QR-сервис в runtime. Если для генерации нужен
    новый npm/cargo dependency, STOP и согласовать зависимость с владельцем.
- `tests/components/AboutProgramDialog.test.tsx` (новый)
- При необходимости `tests/components/LicenseActivationDialog.test.tsx`
  или точечный тест на `LicenseActivationPanel`.

**Вне объёма**:

- Не менять сервер лицензий, update-channel, alpha/beta/stable политику.
- Не менять `version.json`.
- Не добавлять форму обратной связи или отправку тикета на сервер.
- Не реализовывать сбор логов/краш-репортов из этого окна.
- Не добавлять новые runtime-зависимости для QR, если можно использовать
  статический asset.

## Технические детали

### Открытие внешних ссылок

Использовать Tauri opener:

```ts
import { openUrl } from '@tauri-apps/plugin-opener';
```

Capability уже есть: `src-tauri/capabilities/default.json` содержит
`opener:default`, а `src-tauri/src/lib.rs` регистрирует
`tauri_plugin_opener::init()`.

Ссылки:

- сайт: `openUrl('https://rheolab.site/')`
- обучающие видео: `openUrl('https://rheolab.site/#videos')`
- MAX: `openUrl(MAX_URL)`
- email: `openUrl('mailto:support@rheolab.site')` и
  `openUrl('mailto:info@rheolab.site')`
- phone: `openUrl('tel:+77058030863')`,
  `openUrl('tel:+79828801822')`

Если `openUrl` падает в web/test окружении, fallback в компоненте:
скопировать значение в clipboard и показать короткий статус, но не делать
`window.open` как основной desktop-путь.

### Содержимое вкладки «О программе»

Обязательная иерархия:

1. `RheoLab Enterprise`
2. `Версия: ${APP_VERSION}`
3. `Сборка: ${BUILD_DATE}` если не `dev`
4. `Коммит: ${COMMIT_HASH}` если не `dev`
5. краткое назначение: `Профессиональный анализ реологических данных`
6. блок `Быстрые действия`
   - `Обучающие видео` -> `https://rheolab.site/#videos`
   - `Написать в поддержку` -> `mailto:support@rheolab.site`
   - `Коммерческие вопросы` -> `mailto:info@rheolab.site`
   - `Открыть MAX` -> MAX URL
   - `Открыть сайт` -> `https://rheolab.site/`
7. блок `QR-коды`
   - MAX QR
   - QR раздела обучающих видео
8. блок `Контакты`
   - `support@rheolab.site`
   - `info@rheolab.site`
   - `+7 705 803 08 63`
   - `+7 982 880 18 22`

Для иконок использовать `lucide-react`: `Video`, `Mail`, `MessageCircle`,
`Globe`, `Phone`, `Copy`, `ExternalLink`, `Info`. Если какой-то иконки нет в
локальной версии, выбрать ближайшую из `lucide-react`, не рисовать SVG руками.

Импортировать версию из `src/lib/version.ts`.

### Поведение действий

- Кнопка `Обучающие видео` открывает `https://rheolab.site/#videos`.
- QR `Обучающие видео` кодирует тот же URL.
- Кнопка `Написать в поддержку` открывает `mailto:support@rheolab.site`.
- Кнопка `Коммерческие вопросы` или email `info@rheolab.site` открывает
  `mailto:info@rheolab.site`.
- Телефоны открываются через `tel:` и имеют отдельную кнопку копирования.
- MAX открывается через MAX URL и имеет отдельную кнопку копирования ссылки.
- При ошибке `openUrl` значение копируется в clipboard, а пользователь видит
  короткий статус. Ошибка не должна выглядеть как падение приложения.

### Содержимое вкладки «Лицензия»

Не дублировать руками форму лицензии. Вынести из
`LicenseActivationDialog.tsx`:

```tsx
export function LicenseActivationPanel({
  forceBlock = false,
  blockMessage,
  onClose,
}: LicenseActivationPanelProps) { ... }
```

`LicenseActivationDialog` становится:

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent>
    <LicenseActivationPanel
      forceBlock={forceBlock}
      blockMessage={blockMessage}
      onClose={() => onOpenChange(false)}
    />
  </DialogContent>
</Dialog>
```

Новый `AboutProgramDialog` использует тот же `LicenseActivationPanel` внутри
`TabsContent value="license"`.

## Шаги

### Шаг 1: Drift-check и подготовка assets

1. Выполнить drift-check из шапки.
2. Создать папку `src/assets/support/`.
3. Скопировать/подготовить QR asset из:
   `C:\Users\VladimirWorkPC\Desktop\photo_2026-06-12_09-23-19.jpg`
   в `src/assets/support/max-vladimir-qr.jpg`.
4. Сгенерировать статический QR asset для
   `https://rheolab.site/#videos` в
   `src/assets/support/rheolab-videos-qr.png`.
5. Проверить, что оба файла открываются и вес каждого разумный (<300 KB).

**Verify**:

```powershell
Get-Item src\assets\support\max-vladimir-qr.jpg
Get-Item src\assets\support\rheolab-videos-qr.png
```

### Шаг 2: Вынести лицензионную панель

1. В `LicenseActivationDialog.tsx` выделить `LicenseActivationPanel`.
2. Не менять бизнес-логику активации, offline corporate, dev-mode section,
   machine-id load и reload после успешной активации.
3. Сохранить внешний API `LicenseActivationDialog`.

**Verify**:

```powershell
npm run typecheck
```

### Шаг 3: Добавить AboutProgramDialog

1. Создать `src/components/about/AboutProgramDialog.tsx`.
2. Использовать `Dialog`, `Tabs`, `Button` и простые секции без вложенных
   карточек.
3. Добавить `initialTab?: 'about' | 'license'`.
4. Сделать вкладку `О программе` в порядке:
   - версия и краткое описание
   - `Быстрые действия`
   - `QR-коды`
   - `Контакты`
5. Добавить кнопки:
   - `Обучающие видео`
   - `Написать в поддержку`
   - `Коммерческие вопросы`
   - `Открыть MAX`
   - `Открыть сайт`
   - `Скопировать ...` для email/телефонов/ссылок
6. QR: `<img src={maxQr} alt="QR-код MAX для связи с поддержкой RheoLab" />`.
7. QR видео: `<img src={videosQr} alt="QR-код раздела обучающих видео RheoLab" />`.
8. Проверить responsive layout: при ширине около 360 px текст кнопок и
   подписи QR не должны переноситься некрасиво или обрезаться.

**Verify**:

```powershell
npm run typecheck
```

### Шаг 4: Заменить header entrypoint

1. В `DashboardLayoutClient.tsx` заменить header `LicenseStatusBadge` на
   кнопку `О программе`.
2. `TrialBanner onActivate` должен открывать `AboutProgramDialog` на вкладке
   `license`.
3. Обычная кнопка header открывает вкладку `about`.
4. `LicenseGuard` не трогать.

**Verify**:

```powershell
npm run lint
npm run typecheck
```

### Шаг 5: Тесты

Добавить Vitest/RTL тесты:

1. `AboutProgramDialog` рендерит:
   - `О программе`
   - `Лицензия`
   - `RheoLab Enterprise`
   - `Быстрые действия`
   - `QR-коды`
   - `Контакты`
   - `info@rheolab.site`
   - `support@rheolab.site`
   - оба телефона
   - `MAX`
   - `Обучающие видео`
   - `https://rheolab.site/#videos`
   - QR image с alt text для MAX.
   - QR image с alt text для обучающих видео.
2. Клик по `Обучающие видео` вызывает `openUrl` с
   `https://rheolab.site/#videos`.
3. Клик по `Написать в поддержку` вызывает `openUrl` с
   `mailto:support@rheolab.site`.
4. Клик по tab `Лицензия` показывает лицензионную панель.
5. `DashboardLayoutClient` или более узкий тест header-пути:
   - видима кнопка `О программе`
   - видимая header-кнопка `Лицензия` больше не появляется для active status.
6. Тест fallback: если `openUrl` rejected, вызывается clipboard/copy helper и
   показывается статус `Скопировано` или близкий текст.

**Verify**:

```powershell
npm run test -- tests/components/AboutProgramDialog.test.tsx
npm run test -- tests/components/AboutProgramDialog.test.tsx tests/components/DashboardContent.test.tsx
```

### Шаг 6: Финальная проверка

```powershell
npm run version:validate
npm run lint
npm run typecheck
npm run test -- tests/components/AboutProgramDialog.test.tsx
```

Если изменение затронуло layout ширину header или видимые кнопки:

```powershell
npm run test:e2e:smoke
```

## Критерии готовности

- [ ] В header нет видимой кнопки `Лицензия`; есть `О программе`.
- [ ] Окно `О программе` имеет две вкладки: `О программе`, `Лицензия`.
- [ ] Вкладка `О программе` понятна без инструкции: версия, быстрые действия,
      QR-коды и контакты разделены видимыми секциями.
- [ ] Вкладка `Лицензия` сохраняет текущую online/offline corporate
      активацию.
- [ ] `LicenseGuard` по-прежнему блокирует приложение формой лицензии.
- [ ] Контакты: сайт, два email, два телефона, MAX link, MAX QR, действия
      открыть/скопировать.
- [ ] Есть ссылка и QR на раздел обучающих видео:
      `https://rheolab.site/#videos`.
- [ ] Внешние ссылки открываются через Tauri opener.
- [ ] QR asset находится в `src/assets/support/`, не ссылается на Desktop path.
- [ ] На узкой ширине около 360 px нет обрезанного текста, наложений и
      нечитаемых QR-подписей.
- [ ] `npm run lint`, `npm run typecheck`, targeted Vitest — exit 0.
- [ ] `plans/README.md` обновлён.

## Условия STOP

- Нужно менять CSP/allowlist, потому что ссылки не открываются через
  `opener:default`. Остановиться и сверить security impact.
- QR из предоставленного изображения не сканируется после оптимизации.
  Остановиться и использовать исходное изображение без обрезки либо запросить
  новый QR.
- Секция сайта `#videos` исчезла или переименована. Остановиться и
  согласовать новый URL с владельцем до изменения приложения.
- Рефактор `LicenseActivationDialog` начинает менять поведение активации,
  offline corporate или `LicenseGuard`. Остановиться и сузить refactor.
- Возникает желание добавить отправку тикета/логов/краш-репорта на сервер.
  Это отдельный план поверх WP-6.3, не часть 008.

## Git-процесс

- Ветка: `codex/008-about-support-dialog`
- Один коммит: `feat(ui): add about dialog with support contacts`
- Не деплоить и не делать release bump в рамках этого плана.
