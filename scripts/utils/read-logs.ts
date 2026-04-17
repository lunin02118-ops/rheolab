
import fs from 'fs';
import path from 'path';
import os from 'os';

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const logPaths = [
    path.join(appData, 'rheolab-enterprise', 'app-debug.log'),
    path.join(appData, 'RheoLab Enterprise', 'app-debug.log')
];

function readLog(logPath: string) {
    if (fs.existsSync(logPath)) {
        console.log(`\n=== Reading log: ${logPath} ===`);
        const content = fs.readFileSync(logPath, 'utf-8');
        // Show last 50 lines
        const lines = content.split('\n');
        console.log(lines.slice(-50).join('\n'));
    } else {
        console.log(`Log file not found: ${logPath}`);
    }
}

logPaths.forEach(readLog);
