import { createRequire } from 'module';
import { join } from 'path';
import { homedir } from 'os';

const require = createRequire(import.meta.url);

const dbPath = join(homedir(), 'AppData', 'Roaming', 'com.rheolab.enterprise', 'rheolab.db');
console.log('DB path:', dbPath);

// Use rusqlite-compatible reader: just read raw with node fs + manual parsing isn't feasible.
// Try sql.js (pure JS SQLite)
let SQL;
try {
  SQL = require('sql.js');
} catch {
  // Try another approach
  const { readFileSync } = await import('fs');
  console.log('DB file size:', readFileSync(dbPath).length, 'bytes');
  console.log('sql.js not available. Install: npm i sql.js');
  process.exit(1);
}

const initSqlJs = SQL.default || SQL;
const sqljs = await initSqlJs();
const { readFileSync } = await import('fs');
const buffer = readFileSync(dbPath);
const db = new sqljs.Database(buffer);

const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
if (tables.length > 0) {
  for (const row of tables[0].values) {
    const name = row[0];
    const countResult = db.exec(`SELECT COUNT(*) FROM [${name}]`);
    const count = countResult[0]?.values[0]?.[0] ?? 0;
    console.log(`${name}: ${count}`);
  }
}

const version = db.exec("PRAGMA user_version");
console.log('Schema version:', version[0]?.values[0]?.[0]);

// Check for old v2 JSON store
const { existsSync } = await import('fs');
const v2Dir = join(homedir(), 'AppData', 'Roaming', 'com.rheolab.enterprise', 'v2');
if (existsSync(v2Dir)) {
  const { readdirSync, statSync } = await import('fs');
  const files = readdirSync(v2Dir);
  console.log('\n--- Old v2 JSON store ---');
  for (const f of files) {
    const fp = join(v2Dir, f);
    const s = statSync(fp);
    console.log(`${f}: ${s.size} bytes`);
  }
}

db.close();
