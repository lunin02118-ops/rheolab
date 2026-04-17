# Доступ к серверу

Этот документ фиксирует постоянную схему доступа к серверу `license.vizbuka.ru`.

## Целевая схема

Повседневная работа должна идти только так:

1. Локальный файл `scripts/deploy/.env.server`
2. Выделенный ключ `C:\Users\<пользователь>\.ssh\rheolab_deploy`
3. Строгая проверка ключа сервера через `scripts/deploy/known_hosts`

Пароль допускается только на разовой стадии первичной настройки.

## Локальная конфигурация

1. Создайте локальный файл по образцу:

```powershell
Copy-Item scripts/deploy/.env.server.example scripts/deploy/.env.server
```

2. Оставьте в `scripts/deploy/.env.server` только постоянные параметры:

```env
LICENSE_SERVER_HOST=license.vizbuka.ru
LICENSE_SERVER_USER=root
LICENSE_SERVER_KEY_PATH=C:\Users\YOUR_USER\.ssh\rheolab_deploy
LICENSE_SERVER_ALLOW_UNKNOWN_HOST=0
LICENSE_SERVER_KEY_COMMENT=rheolab-deploy
```

`LICENSE_SERVER_PASS` в этот файл не записывается.

## Первичная настройка

Разовая настройка выполняется в таком порядке:

1. Зафиксировать ключ сервера:

```powershell
$env:LICENSE_SERVER_PASS='<одноразовый пароль>'
npm run server:hostkey
Remove-Item Env:LICENSE_SERVER_PASS
```

2. Установить рабочий ключ доступа:

```powershell
$env:LICENSE_SERVER_PASS='<одноразовый пароль>'
npm run server:bootstrap
Remove-Item Env:LICENSE_SERVER_PASS
```

3. Проверить, что дальше работает только штатная схема:

```powershell
npm run server:doctor
```

Что делает эта последовательность:

- `server:hostkey` записывает ключ сервера в `scripts/deploy/known_hosts`
- `server:bootstrap` создаёт локальную пару ключей и добавляет открытый ключ в `~/.ssh/authorized_keys` на сервере
- `server:doctor` подтверждает, что подключение проходит по ключу и со строгой проверкой хоста

## Повседневное использование

После первичной настройки пароль больше не нужен.

Основные команды:

```powershell
npm run server:doctor
npm run deploy:website
python scripts/deploy/deploy_admin.py
python scripts/deploy/download_admin.py
```

## Ротация ключа сервера

Если сервер перевыпущен или у него сменился SSH-ключ:

1. Сверьте новый отпечаток по доверенному каналу.
2. Обновите `scripts/deploy/known_hosts` командой:

```powershell
npm run server:hostkey
```

3. Закоммитьте изменение в репозиторий.

## Признаки правильной настройки

Схема считается настроенной правильно, если:

- `scripts/deploy/.env.server` существует только локально и не хранит пароль
- `npm run server:doctor` проходит без дополнительных переменных среды
- в выводе диагностики указан режим `ssh-key`
- `scripts/deploy/known_hosts` содержит актуальную запись для `license.vizbuka.ru`
