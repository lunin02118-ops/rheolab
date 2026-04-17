const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'runtime', 'eslint-audit.json'), 'utf8'));
let errors = 0;
let warnings = 0;
const files = [];
const rules = new Map();
for (const file of data) {
  const fileErrors = file.messages.filter((m) => m.severity === 2).length;
  const fileWarnings = file.messages.filter((m) => m.severity === 1).length;
  if (fileErrors || fileWarnings) {
    files.push({ file: path.relative(process.cwd(), file.filePath).replace(/\\/g, '/'), errors: fileErrors, warnings: fileWarnings });
  }
  errors += fileErrors;
  warnings += fileWarnings;
  for (const msg of file.messages) {
    const rule = msg.ruleId || 'unknown';
    rules.set(rule, (rules.get(rule) || 0) + 1);
  }
}
files.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || a.file.localeCompare(b.file));
const topRules = [...rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(JSON.stringify({ errors, warnings, topFiles: files.slice(0, 12), topRules }, null, 2));
