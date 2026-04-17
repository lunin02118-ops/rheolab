/**
 * Test cycle detection on real SWB Mamontovskoe file
 */
import * as fs from 'fs';
import * as path from 'path';

// Simulated step structure
interface RheoStep {
    id: number;
    startTime: number;
    endTime: number;
    duration: number;
    avgShearRate: number;
    avgViscosity: number;
    avgTemperature: number;
}

// Parse the CSV file
const filePath = path.join(__dirname, '../tests/fixtures/8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv');
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

console.log('=== SWB Mamontovskoe File Analysis ===\n');
console.log('File:', path.basename(filePath));
console.log('Lines:', lines.length);

// Find data start
let dataStart = 0;
for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length >= 4 && !isNaN(parseFloat(cols[0]))) {
        dataStart = i;
        break;
    }
}
console.log('Data starts at line:', dataStart);

// Parse points
const points: { time: number; visc: number; temp: number; rate: number }[] = [];
for (let i = dataStart; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length >= 4) {
        const time = parseFloat(cols[0]);
        const visc = parseFloat(cols[1]);
        const temp = parseFloat(cols[2]);
        const rate = parseFloat(cols[3]);
        if (!isNaN(time) && !isNaN(visc)) {
            points.push({ time, visc, temp, rate });
        }
    }
}
console.log('Data points:', points.length);

// Group into steps by shear rate change
const steps: RheoStep[] = [];
let stepStart = 0;
let currentRate = Math.round(points[0].rate / 5) * 5;
let stepId = 1;

for (let i = 1; i < points.length; i++) {
    const rate = Math.round(points[i].rate / 5) * 5;

    if (Math.abs(rate - currentRate) > 10 || i === points.length - 1) {
        const endIdx = i === points.length - 1 ? i : i - 1;
        const stepPoints = points.slice(stepStart, endIdx + 1);

        if (stepPoints.length > 0) {
            const avgRate = stepPoints.reduce((s, p) => s + p.rate, 0) / stepPoints.length;
            const avgVisc = stepPoints.reduce((s, p) => s + p.visc, 0) / stepPoints.length;
            const avgTemp = stepPoints.reduce((s, p) => s + p.temp, 0) / stepPoints.length;
            const startTime = stepPoints[0].time;
            const endTime = stepPoints[stepPoints.length - 1].time;
            const duration = endTime - startTime;

            if (duration >= 15) { // Only include steps >= 15 seconds
                steps.push({
                    id: stepId++,
                    startTime,
                    endTime,
                    duration,
                    avgShearRate: avgRate,
                    avgViscosity: avgVisc,
                    avgTemperature: avgTemp,
                });
            }
        }

        stepStart = i;
        currentRate = rate;
    }
}

console.log('\n=== Detected Steps ===');
console.log('Total steps:', steps.length);
steps.forEach((s, i) => {
    console.log(`Step ${i + 1}: rate=${s.avgShearRate.toFixed(0)}, dur=${s.duration.toFixed(0)}s, time=${s.startTime.toFixed(0)}s`);
});

// Analyze pattern
console.log('\n=== Rate Pattern ===');
const rates = steps.map(s => Math.round(s.avgShearRate / 5) * 5);
console.log('Rates (rounded):', rates.join(' → '));

// Find repeating pattern
console.log('\n=== Pattern Detection ===');
for (let patternLen = 3; patternLen <= 5; patternLen++) {
    for (let offset = 0; offset < patternLen && offset + patternLen <= rates.length; offset++) {
        const pattern = rates.slice(offset, offset + patternLen);
        let count = 0;
        let i = offset;

        while (i + patternLen <= rates.length) {
            let matches = true;
            for (let j = 0; j < patternLen; j++) {
                if (Math.abs(rates[i + j] - pattern[j]) > 10) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                count++;
                i += patternLen;
            } else {
                i++;
            }
        }

        if (count >= 2) {
            console.log(`Pattern length ${patternLen}, offset ${offset}: [${pattern.join('→')}] repeats ${count} times`);
        }
    }
}
