const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'com.rheolab.enterprise', 'rheolab.db');
console.log('DB:', dbPath, 'Size:', fs.statSync(dbPath).size);

initSqlJs().then(SQL => {
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  if (tables.length > 0) {
    tables[0].values.forEach(r => {
      const cnt = db.exec('SELECT COUNT(*) FROM [' + r[0] + ']');
      console.log(r[0] + ': ' + cnt[0].values[0][0]);
    });
  }
  console.log('Schema:', db.exec('PRAGMA user_version')[0].values[0][0]);
  db.close();
});
