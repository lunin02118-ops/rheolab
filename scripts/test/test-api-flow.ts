
import * as fs from 'fs';
import * as path from 'path';
import { RheoParser } from '../src/lib/parsing';

async function testApiFlow() {
    const filename = '3.8_2.0_0.2_41C(5610_56)23.04.csv';
    const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
    const filePath = path.join(fixturesDir, filename);

    console.log(`Reading file: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );

    console.log('Parsing...');
    const result = await RheoParser.parseAsync(arrayBuffer as ArrayBuffer, filename);

    console.log('--- Parse Result ---');
    console.log('Test Date:', result.metadata?.testDate);
    console.log('Calibration Data:', result.metadata?.calibration ? 'FOUND' : 'NOT FOUND');

    if (result.metadata?.calibration) {
        console.log('Calibration Date (String):', result.metadata.calibration.lastCalDate);
        console.log('Calibration Date (Object):', result.metadata.calibration.calibrationDate);
        console.log('Device:', result.metadata.calibration.deviceType);
    }

    if (result.metadata?.testDate && result.metadata?.calibration) {
        console.log('\n✅ SUCCESS: Both Test Date and Calibration Data found.');
    } else {
        console.log('\n❌ FAILURE: Missing data.');
        if (!result.metadata?.testDate) console.log(' - Test Date missing');
        if (!result.metadata?.calibration) console.log(' - Calibration Data missing');
    }
}

testApiFlow().catch(console.error);
