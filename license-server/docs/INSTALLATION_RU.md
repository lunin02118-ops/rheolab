# Руководство по установке

Актуальная инструкция по установке и развёртыванию сервера лицензирования RheoLab на Ubuntu 24.04.

## Требования

- Ubuntu 24.04 VPS
- root или эквивалентный sudo-доступ
- PHP 8.1+ и MySQL/MariaDB
- домен, если нужен HTTPS для admin panel и update endpoints

## Автоматическая установка

`install.sh` нужно запускать не отдельно, а из загруженной директории `license-server/`.

```bash
scp -r license-server root@<YOUR_SERVER_IP>:/root/
ssh root@<YOUR_SERVER_IP>
cd /root/license-server
chmod +x install.sh
./install.sh
```

Скрипт ожидает рядом с собой проектные файлы:

- `database.sql`
- `admin/`
- `api/`
- `includes/`
- backup/cleanup helper scripts, если они присутствуют в репозитории

Что делает `install.sh`:

- ставит Apache, MySQL, PHP, Certbot, UFW, fail2ban и вспомогательные пакеты
- импортирует `database.sql`
- копирует PHP-файлы в `/var/www/license-server`
- генерирует production `config.php`
- генерирует RSA-ключ в `/var/www/license-server/keys/license_private.pem`
- создаёт `/root/.my.cnf`
- сохраняет сгенерированные секреты в `/root/.rheolab-credentials`
- настраивает backup/cleanup cron jobs, если соответствующие скрипты есть

## Ручная установка

### 1. Установка пакетов

```bash
apt update && apt upgrade -y
apt install -y apache2 mysql-server php php-mysql php-curl php-json php-mbstring php-xml libapache2-mod-php unzip curl
```

### 2. Создание базы

```sql
CREATE DATABASE rheolab_license CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'license_user'@'localhost' IDENTIFIED BY 'YourSecurePassword';
GRANT SELECT, INSERT, UPDATE, DELETE ON rheolab_license.* TO 'license_user'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Развёртывание файлов

Скопируйте всю директорию `license-server/` в `/var/www/license-server`.

### 4. Настройка приложения

Поддерживаются два сценария:

1. Использовать `install.sh` и оставить сгенерированный `config.php`.
2. Для ручной установки скопировать `config.example.php` в `config.php` и подать секреты через env или прямое редактирование.

Актуальная форма конфигурации:

```php
define('DB_HOST', getenv('RHEOLAB_DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('RHEOLAB_DB_NAME') ?: 'rheolab_license');
define('DB_USER', getenv('RHEOLAB_DB_USER') ?: die('DB_USER not configured'));
define('DB_PASS', getenv('RHEOLAB_DB_PASS') ?: die('DB_PASS not configured'));
define('LICENSE_SECRET', getenv('RHEOLAB_LICENSE_SECRET') ?: die('LICENSE_SECRET not configured'));
define('ADMIN_USER', getenv('RHEOLAB_ADMIN_USER') ?: 'admin');
define('ADMIN_PASS_HASH', getenv('RHEOLAB_ADMIN_PASS_HASH') ?: die('ADMIN_PASS_HASH not configured'));
```

Хеш администратора генерируется так:

```bash
php -r "echo password_hash('your-password', PASSWORD_BCRYPT);"
```

Если `install.sh` не используется, RSA-ключ для `includes/sign_rsa.php` нужно развернуть отдельно.

### 5. Импорт схемы

Импортируйте `database.sql`, а не `schema.sql`.

### 6. Настройка Apache

Нужно:

- выставить `DocumentRoot` в `/var/www/license-server`
- включить `AllowOverride All`
- закрыть прямой доступ к `config.php`, `includes/` и `keys/`
- убедиться, что правила `.htaccess` под `releases/` активны

### 7. Права доступа

```bash
chown -R www-data:www-data /var/www/license-server
chmod -R 755 /var/www/license-server
chmod 600 /var/www/license-server/config.php
chmod 700 /var/www/license-server/keys
chmod 600 /var/www/license-server/keys/license_private.pem
```

## Post-install проверка

Минимум:

```bash
php -l /var/www/license-server/config.php
phpunit --configuration license-server/phpunit.xml
```

Полезные smoke checks:

```bash
curl https://<YOUR_DOMAIN>/api/status.php?key=TEST-1234-5678-ABCD
ls -la /var/www/license-server/keys
cat /root/.rheolab-credentials
```
