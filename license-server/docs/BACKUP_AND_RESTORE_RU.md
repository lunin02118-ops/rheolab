# Руководство по резервному копированию и восстановлению

В этом руководстве объясняется, как создавать резервные копии сервера лицензирования RheoLab и восстанавливать его в случае сбоя или миграции.

## Система автоматического резервного копирования

Сервер настроен на автоматическое создание резервных копий базы данных и файлов каждый день в **3:00 утра**.

### Как это работает
- **Скрипт**: `/usr/local/bin/backup-license.sh`
- **Расположение**: `/var/backups/license-server/`
- **Формат**: `backup_ГГГГ-ММ-ДД_ЧЧ-ММ-СС.tar.gz`
- **Локальное хранение**: при настроенном S3 и успешной загрузке сервер держит 3 последних локальных архива, а более старые удаляет только после подтверждения соответствующего S3 daily-объекта и `.sha256`. Без S3 локальные архивы старше 7 дней удаляются автоматически.
- **S3 mirror**: при наличии `/root/.license-server-s3.env` архив дополнительно уходит в S3-совместимое хранилище как `latest/backup_latest.tar.gz` и `daily/backup_<timestamp>.tar.gz`. Удалённое хранение daily-архивов по умолчанию — 30 дней, если не задан `S3_RETENTION_DAYS`.

### Содержимое резервной копии
Каждый архив содержит:
1.  `database.sql.gz`: Сжатый дамп базы данных `rheolab_license`.
2.  `files.tar.gz`: Сжатый архив веб-директории `/var/www/license-server`.

### Проверка резервных копий
Чтобы проверить наличие резервных копий на сервере:
```bash
ls -lh /var/backups/license-server
```

Чтобы проверить S3-настройки на сервере:
```bash
sudo test -f /root/.license-server-s3.env && echo "S3 backup config exists"
```

### Ручное создание резервной копии
Вы можете запустить резервное копирование вручную в любое время:
```bash
sudo /usr/local/bin/backup-license.sh
```

Из админки также доступны две кнопки:
1. `Создать backup` — запускает полный backup сразу.
2. `Проверить восстановление` — делает dry-run проверку последнего локального архива и, если настроен S3, объекта `latest`.

Ручная dry-run проверка из консоли:
```bash
sudo /usr/local/bin/license-admin-verify-backup.sh
```

Проверка не перезаписывает текущую базу. Она только убеждается, что архив реально пригоден для восстановления на другом сервере:
1. Архив распаковывается во временный каталог.
2. Проверяется структура backup.
3. Валидируется `database.sql.gz`.
4. Валидируется `files.tar.gz`.
5. Проверяется наличие `config.php` и `keys/license_private.pem`.
6. При настроенном S3 дополнительно скачивается и сверяется `latest/backup_latest.tar.gz`.

Схема хранения в S3:
1. `s3://<bucket>/license-server/latest/backup_latest.tar.gz` — всегда последняя полная копия с перезаписью.
2. `s3://<bucket>/license-server/daily/backup_<timestamp>.tar.gz` — ежедневные архивы для отката к предыдущим состояниям.

### Скачивание резервной копии на локальный ПК
Для Windows-пк добавлен скрипт `license-server/download-backup.ps1`, который по SSH скачивает последнюю резервную копию или отдельный дамп БД на локальную машину.

Примеры:
```powershell
# Скачать последний архив backup_*.tar.gz
powershell -ExecutionPolicy Bypass -File .\license-server\download-backup.ps1 -Server your.server.example -OutDir .\backups

# Сначала принудительно создать свежий backup на сервере, затем скачать его
powershell -ExecutionPolicy Bypass -File .\license-server\download-backup.ps1 -Server your.server.example -OutDir .\backups -TriggerBackup

# Скачать только SQL-дамп БД лицензий
powershell -ExecutionPolicy Bypass -File .\license-server\download-backup.ps1 -Server your.server.example -OutDir .\backups -DbOnly
```

Требования:
1. На локальном ПК должны быть доступны `ssh` и `scp`.
2. У пользователя должен быть SSH-доступ к серверу.
3. Для режима `-DbOnly` удалённый пользователь должен иметь доступ к `/root/.my.cnf` и `mysqldump`.

### Очистка логов и мусора на сервере
Добавлен скрипт `/usr/local/bin/cleanup-license.sh`.

Он делает следующее:
1. Удаляет истёкшие записи из `rate_limits`.
2. Обрезает и архивирует слишком большой `/var/log/license-backup.log`.
3. Удаляет старые архивы логов, локальные backup-архивы старше 7 дней и временные каталоги старше retention-периода.

Ручной запуск:
```bash
sudo /usr/local/bin/cleanup-license.sh
```

---

## Восстановление и Миграция

Чтобы восстановить сервер из резервной копии (например, после сбоя или при переезде на новый VPS), выполните следующие действия.

### Требования
1.  Чистый сервер с установленным ПО License Server (см. [INSTALLATION_RU.md](INSTALLATION_RU.md)).
    *   *Примечание: Пароли могут отличаться, так как восстановление перезапишет базу данных, но файл `config.php` может потребовать ручной правки, если учетные данные MySQL на новом сервере отличаются.*
2.  Файл резервной копии (например, `backup_2025-12-28_12-00-00.tar.gz`).

### Процесс восстановления

Мы предоставляем скрипт-помощник `restore-license.sh` для автоматизации процесса.

#### 1. Загрузка бэкапа и скрипта восстановления
Загрузите файл бэкапа и скрипт восстановления на новый сервер:
```bash
scp path/to/backup_file.tar.gz root@<NEW_IP>:/root/
scp license-server/restore.sh root@<NEW_IP>:/usr/local/bin/restore-license.sh
```

#### 2. Запуск скрипта восстановления
Подключитесь по SSH и выполните:
```bash
ssh root@<NEW_IP>
chmod +x /usr/local/bin/restore-license.sh
/usr/local/bin/restore-license.sh /root/backup_file.tar.gz
```

Восстановление напрямую из S3:
```bash
/usr/local/bin/restore-license.sh latest
```

Или из конкретного объекта:
```bash
/usr/local/bin/restore-license.sh s3://<bucket>/license-server/daily/backup_2026-03-18_03-00-00.tar.gz
```

Скрипт выполнит:
1.  Распаковку архива.
2.  Восстановление базы данных MySQL (перезаписывая существующие данные).
3.  Восстановление веб-файлов в `/var/www/license-server`.
4.  Исправление прав доступа к файлам.

#### 3. Проверка конфигурации
После восстановления проверьте файл `/var/www/license-server/config.php`.
Если на новом сервере используются другие учетные данные для базы данных, чем на старом (а бэкап перезаписал `config.php` старым файлом), вам нужно обновить `config.php`.

```bash
nano /var/www/license-server/config.php
```
Убедитесь, что `DB_USER` и `DB_PASS` соответствуют настройкам MySQL текущего сервера.

Если используется восстановление из S3, также проверьте `/root/.license-server-s3.env` и заполните его заново на новом сервере.

### Можно ли переехать на другой хост без потери данных?
Да. С текущей схемой backup + restore сервер можно развернуть на новом VPS и восстановить без потери лицензий и приватного RSA-ключа, если выполнены условия ниже:
1. На новом сервере установлен тот же license-server стек: PHP, Apache, MySQL/MariaDB.
2. Архив backup успешно проходит dry-run проверку.
3. После восстановления при необходимости обновлён `/var/www/license-server/config.php` под новые MySQL-учётные данные.
4. Если нужен дальнейший backup в Beget S3, заново заполнен `/root/.license-server-s3.env`.
5. После миграции перепроверены DNS, SSL и доступность админки/API.

Практически это означает следующее: даже если текущий хостинг полностью упадёт, достаточно поднять чистый сервер, задеплоить license-server, загрузить backup и выполнить `restore-license.sh`. База, файлы сайта и ключ подписи восстановятся из архива.

### Ручное восстановление (Если скрипт недоступен)

1.  **Распаковка архива**:
    ```bash
    tar -xzf backup_file.tar.gz
    cd <папка_с_датой>
    ```
2.  **Восстановление БД**:
    ```bash
    gunzip database.sql.gz
    mysql -u license_user -p rheolab_license < database.sql
    ```
3.  **Восстановление файлов**:
    ```bash
    tar -xzf files.tar.gz -C /var/www/license-server
    ```
4.  **Исправление прав**:
    ```bash
    chown -R www-data:www-data /var/www/license-server
    ```
