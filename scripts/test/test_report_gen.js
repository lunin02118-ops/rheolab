const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const inputPath = path.join(__dirname, '..', 'test_input.json');
const outputPath = path.join(__dirname, '..', 'test_output.xlsx');

// Sample data mimicking the app's payload
const sampleData = {
    rawData: [
        { time_sec: 60, viscosity_cp: 100, temperature_c: 25, pressure_bar: 10 },
        { time_sec: 120, viscosity_cp: 95, temperature_c: 26, pressure_bar: 12 }
    ],
    metadata: {
        testId: "TEST-001",
        fieldName: "Field A",
        operatorName: "Tester",
        instrumentType: "R1B1",
        geometry: "R1B1",
        testDate: new Date().toISOString()
    },
    recipe: [
        { reagentName: "Water", concentration: 100, unit: "%", batchNumber: "B001" }
    ],
    cycleResults: [
        { cycleNo: 1, n_prime: 0.5, K_prime_PaSn: 1.0, r2: 0.99, tempC: 25, timeMin: 10.5, pressure_bar: 11 }
    ],
    waterParams: { ph: 7, fe: 0.1 },
    cycles: [],
    showPressure: true,
    showTouchPoints: true,
    viscosityThreshold: 200,
    showTargetTime: true,
    targetTime: 10
};

// Write input file
fs.writeFileSync(inputPath, JSON.stringify(sampleData, null, 2));
console.log(`Created test input: ${inputPath}`);

// Run python script
const scriptPath = path.join(__dirname, 'generate_excel_chart.py');
console.log(`Running python script: ${scriptPath}`);

const python = spawn('python', [scriptPath, inputPath, outputPath]);

let stderr = '';
let stdout = '';

python.stdout.on('data', (data) => stdout += data.toString());
python.stderr.on('data', (data) => stderr += data.toString());

python.on('close', (code) => {
    console.log(`Python exited with code ${code}`);
    if (code !== 0) {
        console.error('STDERR:', stderr);
        console.log('STDOUT:', stdout);
    } else {
        if (fs.existsSync(outputPath)) {
            console.log(`SUCCESS: Output file created at ${outputPath}`);
            // Optional: Check file size
            const stats = fs.statSync(outputPath);
            console.log(`File size: ${stats.size} bytes`);
        } else {
            console.error('FAILURE: Output file NOT found despite exit code 0');
        }
    }

    // Cleanup
    // fs.unlinkSync(inputPath);
    // fs.unlinkSync(outputPath);
});
