/**
 * Enable Developer Mode for License Testing
 * 
 * Этот скрипт включает режим разработчика для тестирования
 * разных типов лицензий в приложении.
 * 
 * Использование:
 *   npx tsx scripts/enable-dev-mode.ts
 * 
 * После запуска:
 *   1. Перезапустите приложение
 *   2. В header появится кнопка "Dev License"
 *   3. Активируйте несколько лицензий разных типов
 *   4. Переключайтесь между ними для тестирования
 */

console.log(`
╔════════════════════════════════════════════════════════════╗
║           RheoLab Developer Mode Setup                     ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Этот скрипт настраивает режим разработчика для           ║
║  тестирования разных типов лицензий.                      ║
║                                                            ║
║  ВНИМАНИЕ: Работает только в development режиме!          ║
║  В production сборке dev mode недоступен.                 ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

console.log('📋 Инструкция по использованию:\n');

console.log('1. Запустите приложение в dev режиме:');
console.log('   npm run dev\n');

console.log('2. Откройте консоль браузера (F12) и выполните:');
console.log('   localStorage.setItem("rheolab_dev_mode", "true")\n');

console.log('3. Обновите страницу (F5)\n');

console.log('4. В header появится оранжевая кнопка "Dev License"\n');

console.log('5. Включите "Multi-License Mode" в выпадающем меню\n');

console.log('6. Активируйте несколько лицензий разных типов:\n');
console.log('   - Standard: базовые функции, max 3 графика сравнения');
console.log('   - Developer: калибровка, max 8 графиков сравнения');
console.log('   - Enterprise: все функции + multi-seat\n');

console.log('7. Переключайтесь между лицензиями для тестирования\n');

console.log('─'.repeat(60));
console.log('\n🔧 Быстрая команда для консоли браузера:\n');
console.log('localStorage.setItem("rheolab_dev_mode", "true"); location.reload();');
console.log('\n─'.repeat(60));

console.log('\n🔒 Для отключения dev режима:\n');
console.log('localStorage.removeItem("rheolab_dev_mode"); location.reload();');
console.log('\n');
