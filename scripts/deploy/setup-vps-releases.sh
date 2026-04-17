#!/usr/bin/env bash
# setup-vps-releases.sh
#
# One-time VPS setup: creates the directory structure and Apache config for
# serving RheoLab Enterprise auto-update artifacts.
#
# Run from your local machine:
#   bash scripts/deploy/setup-vps-releases.sh [user@host] [--key path/to/key]
#
# Requirements on VPS: Apache2 with mod_rewrite enabled, write access to web root.

set -euo pipefail

HOST="${1:-root@license.vizbuka.ru}"
SSH_KEY=""
if [[ "${2:-}" == "--key" && -n "${3:-}" ]]; then SSH_KEY="-i $3"; fi

SSH="ssh -o StrictHostKeyChecking=accept-new $SSH_KEY"

echo ""
echo "=== RheoLab Releases — VPS Setup ==="
echo "  Target: $HOST"
echo ""

# ── Remote script (run via SSH) ───────────────────────────────────────────────
$SSH "$HOST" bash -s << 'REMOTE'
set -euo pipefail

WEB_ROOT="/var/www/license-server"
RELEASES="$WEB_ROOT/releases"

# 1. Directory structure
echo "→ Creating directory structure…"
mkdir -p \
    "$RELEASES/v1/update/windows-x86_64" \
    "$RELEASES/artifacts"

# 2. .htaccess with mod_rewrite rules
echo "→ Writing .htaccess…"
cat > "$RELEASES/.htaccess" << 'HTACCESS'
Options -Indexes
<IfModule mod_rewrite.c>
    RewriteEngine On

    # Route versioned update requests to the correct static manifest.
    # Request:  /releases/v1/update/windows-x86_64/x86_64/0.1.489?channel=stable
    # Response: /releases/v1/update/windows-x86_64/stable.json
    RewriteRule ^v1/update/([^/]+)/[^/]+/[0-9].+$ v1/update/$1/stable.json [L,QSA,END]
</IfModule>

<IfModule mod_headers.c>
    <FilesMatch "\.json$">
        Header set Access-Control-Allow-Origin "*"
        Header set Cache-Control "no-cache, no-store, must-revalidate"
    </FilesMatch>
    <FilesMatch "\.exe$">
        Header set Content-Type "application/octet-stream"
    </FilesMatch>
</IfModule>
HTACCESS

# 3. Permissions
echo "→ Setting permissions…"
chown -R www-data:www-data "$RELEASES" || true
chmod -R 755 "$RELEASES"

# 4. Enable mod_rewrite and mod_headers (if not already enabled)
if command -v a2enmod &>/dev/null; then
    a2enmod rewrite headers || true
fi

# 5. Allow .htaccess in the releases dir (Apache may need this)
#    Check if AllowOverride is already set in the site config — if not, patch it.
SITE_CONF=""
for f in /etc/apache2/sites-enabled/*.conf; do
    if grep -q "license-server\|license.vizbuka" "$f" 2>/dev/null; then
        SITE_CONF="$f"
        break
    fi
done

if [[ -n "$SITE_CONF" ]]; then
    if ! grep -q "AllowOverride.*All" "$SITE_CONF"; then
        echo ""
        echo "⚠️  WARNING: $SITE_CONF may not have AllowOverride All."
        echo "   Add the following inside the <Directory> block for $WEB_ROOT:"
        echo "     AllowOverride All"
        echo "   Then reload Apache: systemctl reload apache2"
        echo ""
    fi
fi

# 6. Stub manifest so the endpoint returns valid JSON before first release
MANIFEST="$RELEASES/v1/update/windows-x86_64/stable.json"
if [[ ! -f "$MANIFEST" ]]; then
    echo "→ Writing placeholder stable.json…"
    cat > "$MANIFEST" << 'STUB'
{
  "version": "0.0.0",
  "notes": "No release published yet.",
  "pub_date": "2024-01-01T00:00:00Z",
  "platforms": {}
}
STUB
fi

echo ""
echo "✅  VPS releases directory ready."
echo "   Web path: https://license.vizbuka.ru/releases/"
echo "   Update manifest: https://license.vizbuka.ru/releases/v1/update/windows-x86_64/stable.json"
echo ""
echo "   Next: run  node scripts/deploy/publish-update.js  after a production build."
echo ""
REMOTE

echo "=== Setup complete on $HOST ==="
