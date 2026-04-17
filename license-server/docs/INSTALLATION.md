# Руководство по установке

Этот документ описывает актуальную схему установки RheoLab License Server на Ubuntu 24.04.

## Требования

- Ubuntu 24.04 VPS
- root-доступ или эквивалентный sudo-доступ
- PHP 8.1+ и MySQL/MariaDB
- домен, если нужен HTTPS для admin panel и update endpoints

## Автоматическая установка

`install.sh` не является отдельным standalone-артефактом. Нужно загрузить всю директорию `license-server/` и запускать скрипт изнутри неё.

```bash
scp -r license-server root@<YOUR_SERVER_IP>:/root/
ssh root@<YOUR_SERVER_IP>
cd /root/license-server
chmod +x install.sh
./install.sh
```

Скрипт ожидает рядом такие исходные файлы и директории:

- `database.sql`
- `admin/`
- `api/`
- `includes/`
- `backup.sh`, `cleanup.sh` и связанные maintenance helper-скрипты, если они есть в проекте

Что реально делает скрипт:

- устанавливает Apache, MySQL, PHP, Certbot, UFW, fail2ban и maintenance tools
- импортирует `database.sql`
- копирует PHP application files в `/var/www/license-server`
- генерирует production `config.php`
- генерирует RSA private key в `/var/www/license-server/keys/license_private.pem`
- пишет MySQL credentials в `/root/.my.cnf`
- сохраняет сгенерированные admin/DB secrets в `/root/.rheolab-credentials`
- настраивает backup/cleanup cron jobs, если присутствуют соответствующие helper-скрипты

## Ручная установка

### 1. Установка пакетов

```bash
apt update && apt upgrade -y
apt install -y apache2 mysql-server php php-mysql php-curl php-json php-mbstring libapache2-mod-php unzip curl
```

### 2. Создание базы данных

```sql
CREATE DATABASE rheolab_license CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'license_user'@'localhost' IDENTIFIED BY 'YourSecurePassword';
GRANT SELECT, INSERT, UPDATE, DELETE ON rheolab_license.* TO 'license_user'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Деплой файлов приложения

Скопируйте всю директорию `license-server/` в `/var/www/license-server`.

### 4. Настройка приложения

Поддерживаются два сценария:

1. Использовать автоматический installer и оставить сгенерированный `config.php`.
2. При ручной установке скопировать `config.example.php` в `config.php` и подать секреты через environment variables или прямое редактирование.

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

Хеш администратора можно сгенерировать так:

```bash
php -r "echo password_hash('your-password', PASSWORD_BCRYPT);"
```

Если вы не используете `install.sh`, отдельно нужно развернуть RSA signing key, который ожидает `includes/sign_rsa.php`.

### 5. Импорт схемы

Импортируйте `database.sql`, а не `schema.sql`.

### 6. Настройка Apache

Нужно:

- выставить document root в `/var/www/license-server`
- включить `AllowOverride All`
- запретить прямой доступ к `config.php`, `includes/` и `keys/`
- убедиться, что `.htaccess`-правила под release path активны

### 7. Права доступа

```bash
chown -R www-data:www-data /var/www/license-server
chmod -R 755 /var/www/license-server
chmod 600 /var/www/license-server/config.php
```

## Проверка после установки

Минимум:

```bash
php -l /var/www/license-server/config.php
```

И в checkout-е с рабочим PHP:

```bash
phpunit --configuration license-server/phpunit.xml
```

Полезные smoke checks:

```bash
curl https://<YOUR_DOMAIN>/api/status.php?key=TEST-1234-5678-ABCD
ls -la /var/www/license-server/keys
cat /root/.rheolab-credentials
```

## Связанные документы

- [README.md](README.md)
- [ADMINISTRATION.md](ADMINISTRATION.md)
- [../../docs/RELEASE_AND_DEPLOY.md](../../docs/RELEASE_AND_DEPLOY.md)
