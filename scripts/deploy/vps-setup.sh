#!/bin/bash
# VPS setup: fix MySQL + create artifact retention script + cron

set -e

echo '=== Fixing MySQL config (remove query_cache, MySQL 8.0) ==='
cat > /etc/mysql/conf.d/rheolab-tune.cnf << 'EOF'
[mysqld]
# VPS 709MB RAM - limit InnoDB to leave room for Apache+PHP
innodb_buffer_pool_size = 128M
innodb_buffer_pool_instances = 1
key_buffer_size = 16M
max_connections = 30
tmp_table_size = 16M
max_heap_table_size = 16M
performance_schema = OFF
EOF

systemctl start mysql
sleep 2
echo "MySQL status: $(systemctl is-active mysql)"

echo ''
echo '=== RAM after tuning ==='
free -h

echo ''
echo '=== Creating artifact retention script ==='
cat > /usr/local/bin/rheolab-cleanup-releases.sh << 'SCRIPT'
#!/bin/bash
# Keeps the last N release versions, deletes older ones.
# Run from cron after each deploy.

ARTIFACTS_DIR="/var/www/license-server/releases/artifacts"
KEEP=5

mapfile -t VERSIONS < <(ls -d "$ARTIFACTS_DIR"/*/  2>/dev/null | sort -V)
TOTAL=${#VERSIONS[@]}

if [ "$TOTAL" -le "$KEEP" ]; then
    echo "[cleanup] $TOTAL versions present, nothing to delete (limit: $KEEP)"
    exit 0
fi

DELETE_COUNT=$(( TOTAL - KEEP ))
echo "[cleanup] Total: $TOTAL, keeping: $KEEP, deleting: $DELETE_COUNT"

for (( i=0; i<DELETE_COUNT; i++ )); do
    DIR="${VERSIONS[$i]}"
    echo "[cleanup] Removing: $DIR"
    rm -rf "$DIR"
done

echo "[cleanup] Done. Releases size: $(du -sh $ARTIFACTS_DIR | cut -f1)"
SCRIPT

chmod +x /usr/local/bin/rheolab-cleanup-releases.sh

echo ''
echo '=== Adding cron job (daily at 03:30) ==='
( crontab -l 2>/dev/null | grep -v rheolab-cleanup; echo '30 3 * * * /usr/local/bin/rheolab-cleanup-releases.sh >> /var/log/rheolab-cleanup.log 2>&1' ) | crontab -
echo 'Cron updated:'
crontab -l

echo ''
echo '=== Running cleanup now ==='
/usr/local/bin/rheolab-cleanup-releases.sh

echo ''
echo '=== Final disk state ==='
df -h /
du -sh /var/www/license-server/releases/artifacts/*/
