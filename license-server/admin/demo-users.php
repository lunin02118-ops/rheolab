<?php
/**
 * Demo Users Panel Component
 * Include this file in admin/index.php to display demo users
 */

function renderDemoUsersPanel($db) {
    // Получить демо-пользователей
    $demoUsers = [];
    $demoStats = ['total' => 0, 'active_30d' => 0, 'new_7d' => 0];
    
    try {
        $demoUsers = $db->query('SELECT * FROM demo_users ORDER BY first_seen_at DESC LIMIT 100')->fetchAll();
        $demoStats['total'] = count($demoUsers);
        
        foreach ($demoUsers as $demo) {
            $firstSeen = strtotime($demo['first_seen_at']);
            $lastSeen = strtotime($demo['last_seen_at']);
            $now = time();
            if ($lastSeen > $now - 30 * 86400) $demoStats['active_30d']++;
            if ($firstSeen > $now - 7 * 86400) $demoStats['new_7d']++;
        }
    } catch (PDOException $e) {
        return; // Таблица не существует
    }
    
    if (empty($demoUsers)) return;
    ?>
    
    <div class="card" style="margin-top: 20px;">
        <h2>🎮 Демо-пользователи (<?= $demoStats['total'] ?> всего | <?= $demoStats['active_30d'] ?> активных за 30 дн. | <?= $demoStats['new_7d'] ?> новых за 7 дн.)</h2>
        <table>
            <thead>
                <tr>
                    <th>Machine ID</th>
                    <th>Первый запуск</th>
                    <th>Последний визит</th>
                    <th>IP адрес</th>
                    <th>Дней в демо</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($demoUsers as $demo):
                    $firstSeen = strtotime($demo['first_seen_at']);
                    $lastSeen = strtotime($demo['last_seen_at']);
                    $daysInDemo = ceil((time() - $firstSeen) / 86400);
                    $isActive = $lastSeen > time() - 7 * 86400;
                ?>
                    <tr>
                        <td><span class="key-code"><?= substr($demo['machine_id'], 0, 16) ?>...</span></td>
                        <td><?= date('d.m.Y H:i', $firstSeen) ?></td>
                        <td>
                            <?= date('d.m.Y H:i', $lastSeen) ?>
                            <?php if ($isActive): ?>
                                <span class="badge badge-active" style="margin-left: 5px;">active</span>
                            <?php endif; ?>
                        </td>
                        <td><span class="small"><?= htmlspecialchars($demo['ip_address']) ?></span></td>
                        <td>
                            <?php if ($daysInDemo > 30): ?>
                                <span class="badge badge-expired"><?= $daysInDemo ?> дн. (истёк)</span>
                            <?php else: ?>
                                <span class="badge badge-active"><?= $daysInDemo ?> / 30 дн.</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php
}
