# Документация по RheoLab License Server

Эта директория описывает PHP-сервер лицензирования и обновлений, который обслуживает настольное приложение.

## Содержание

1. [Руководство по установке](INSTALLATION.md)
2. [Руководство администратора](ADMINISTRATION.md)
3. [Резервное копирование и восстановление](BACKUP_AND_RESTORE_RU.md)
4. [Руководство пользователя](USER_GUIDE_RU.md)

## Быстрый старт

Для нового Ubuntu 24.04-хоста:

1. Загрузите или склонируйте **всю** директорию `license-server/` на сервер.
   `install.sh` ожидает рядом остальные файлы проекта.
2. Выберите режим установки:
   автоматический `install.sh` или ручной deploy через `config.example.php`.
3. Если используете `install.sh`, запускайте его изнутри загруженной директории `license-server/`.
   Скрипт сгенерирует `config.php`, RSA-ключ и файл с credentials.
4. Проверьте deployment через PHP lint / PHPUnit в окружении с реальным PHP runtime.

Пример:

```bash
scp -r license-server root@your-server:/root/
ssh root@your-server
cd /root/license-server
chmod +x install.sh
./install.sh
```

## Важные замечания

- Не используйте plaintext credential-файлы внутри репозитория как источник правды.
- В автоматическом сценарии сгенерированные credentials лежат на сервере в `/root/.rheolab-credentials`.
- Пароль администратора задаётся через `ADMIN_PASS_HASH`, а не через `ADMIN_PASS`.
- Актуальный файл схемы — `database.sql`.
- Маршрутизация обновлений сейчас завязана и на `releases.htaccess`, и на `api/update-channel.php`, поэтому перед изменениями сверяйтесь с верхнеуровневыми release docs.

См. также:

- [../../docs/RELEASE_AND_DEPLOY.md](../../docs/RELEASE_AND_DEPLOY.md)
- [../../docs/SERVER_ACCESS.md](../../docs/SERVER_ACCESS.md)
