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

1. **О программе** — версия, сайт, контакты поддержки, MAX QR.
2. **Лицензия** — текущий статус и существующая активация лицензии.

Сценарий принудительной блокировки (`LicenseGuard`) должен остаться
лицензионным и не превращаться в support/about-экран: когда приложение
заблокировано, пользователь должен сразу видеть форму активации.

## Контакты для вкладки «О программе»

- Сайт: `https://rheolab.site/`
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

## UX-решение

- В header справа вместо `LicenseStatusBadge` показать компактную кнопку
  `О программе` с иконкой `Info` или `CircleHelp` из `lucide-react`.
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
  - вкладка «О программе» с контактами, QR и кнопками открытия ссылок.
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
- MAX: `openUrl(MAX_URL)`
- email: `openUrl('mailto:support@rheolab.site')` и
  `openUrl('mailto:info@rheolab.site')`
- phone: `openUrl('tel:+77058030863')`,
  `openUrl('tel:+79828801822')`

Если `openUrl` падает в web/test окружении, fallback в компоненте:
скопировать значение в clipboard и показать короткий статус, но не делать
`window.open` как основной desktop-путь.

### Содержимое вкладки «О программе»

Минимальный набор:

- `RheoLab Enterprise`
- `Версия: ${APP_VERSION}`
- `Сборка: ${BUILD_DATE}` если не `dev`
- `Коммит: ${COMMIT_HASH}` если не `dev`
- краткое назначение: `Профессиональный анализ реологических данных`
- блок `Поддержка`
  - `support@rheolab.site`
  - `info@rheolab.site`
  - телефоны
  - сайт
  - MAX QR

Импортировать версию из `src/lib/version.ts`.

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

### Шаг 1: Drift-check и подготовка asset

1. Выполнить drift-check из шапки.
2. Создать папку `src/assets/support/`.
3. Скопировать/подготовить QR asset из:
   `C:\Users\VladimirWorkPC\Desktop\photo_2026-06-12_09-23-19.jpg`
   в `src/assets/support/max-vladimir-qr.jpg`.
4. Проверить, что файл открывается и вес разумный (<300 KB).

**Verify**:

```powershell
Get-Item src\assets\support\max-vladimir-qr.jpg
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
2. Использовать `Dialog`, `Tabs`, `Button`, `Card`/простые секции без
   вложенных карточек.
3. Добавить `initialTab?: 'about' | 'license'`.
4. Добавить кнопки:
   - открыть сайт
   - написать в поддержку
   - коммерческие вопросы
   - открыть MAX
   - скопировать телефон/email/link
5. QR: `<img src={maxQr} alt="QR-код MAX для связи с поддержкой RheoLab" />`.

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
   - `info@rheolab.site`
   - `support@rheolab.site`
   - оба телефона
   - `MAX`
   - QR image с alt text.
2. Клик по tab `Лицензия` показывает лицензионную панель.
3. `DashboardLayoutClient` или более узкий тест header-пути:
   - видима кнопка `О программе`
   - видимая header-кнопка `Лицензия` больше не появляется для active status.

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
- [ ] Вкладка `Лицензия` сохраняет текущую online/offline corporate
      активацию.
- [ ] `LicenseGuard` по-прежнему блокирует приложение формой лицензии.
- [ ] Контакты: сайт, два email, два телефона, MAX link, MAX QR.
- [ ] Внешние ссылки открываются через Tauri opener.
- [ ] QR asset находится в `src/assets/support/`, не ссылается на Desktop path.
- [ ] `npm run lint`, `npm run typecheck`, targeted Vitest — exit 0.
- [ ] `plans/README.md` обновлён.

## Условия STOP

- Нужно менять CSP/allowlist, потому что ссылки не открываются через
  `opener:default`. Остановиться и сверить security impact.
- QR из предоставленного изображения не сканируется после оптимизации.
  Остановиться и использовать исходное изображение без обрезки либо запросить
  новый QR.
- Рефактор `LicenseActivationDialog` начинает менять поведение активации,
  offline corporate или `LicenseGuard`. Остановиться и сузить refactor.
- Возникает желание добавить отправку тикета/логов/краш-репорта на сервер.
  Это отдельный план поверх WP-6.3, не часть 008.

## Git-процесс

- Ветка: `codex/008-about-support-dialog`
- Один коммит: `feat(ui): add about dialog with support contacts`
- Не деплоить и не делать release bump в рамках этого плана.
