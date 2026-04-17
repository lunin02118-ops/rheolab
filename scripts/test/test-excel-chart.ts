
/**
 * Test script for Excel Chart generation
 * 
 * Usage: npx tsx scripts/test-excel-chart.ts
 */

import fs from 'fs';
import path from 'path';
import { ExcelChartService } from '../src/lib/services/ExcelChartService';
import { ExcelGeneratorService, ExcelInputData } from '../src/lib/services/ExcelGeneratorService';

// Helper to generate raw data
function generateRawData() {
    const data = [];
    for (let i = 0; i <= 10; i++) {
        data.push({
            time_sec: i * 60,
            viscosity_cp: 50 + i * 25 + (i > 5 ? -i * 10 : 0),
            temperature_c: 25 + i * 6,
            shear_rate: i < 5 ? 100 : (i < 8 ? 75 : (i < 9 ? 50 : 25)),
            pressure_bar: i < 5 ? 100 : (i < 8 ? 75 : (i < 9 ? 50 : 25)) // Dummy pressure
        });
    }
    return data;
}

// Base test data
const baseTestData: ExcelInputData = {
    rawData: generateRawData(),
    metadata: {
        testId: 'TEST-2025-001',
        testDate: new Date().toISOString(),
        operatorName: 'Тестовый Оператор',
        fieldName: 'Тестовое Месторождение',
        wellNumber: 'Скв-123',
        instrumentType: 'Grace M5600',
        geometry: 'R1B5'
    },
    recipe: [
        { reagentName: 'Гуар HPG-500', batchNumber: 'L-2025-001', concentration: 3.6, unit: 'кг/м³', category: 'Гелеобразователь' },
        { reagentName: 'Боратный сшиватель XL-200', batchNumber: 'L-2025-045', concentration: 2.0, unit: 'л/м³', category: 'Сшиватель' },
        { reagentName: 'Брейкер APS-100', batchNumber: 'L-2025-089', concentration: 0.5, unit: 'кг/м³', category: 'Деструктор' }
    ],
    waterParams: {
        ph: 7.2, fe: 0.05, ca: 120, mg: 45, cl: 250, so4: 80, hco3: 150
    },
    cycles: [],
    cycleResults: [
        { cycleNo: 1, timeMin: 5, tempC: 50, pressure_bar: 15, n_prime: 0.42, K_prime_PaSn: 2.35, r2: 1.0, bingham_PV_PaS: 0.04, bingham_YP_Pa: 8.5, bingham_r2: 0.99 },
        { cycleNo: 2, timeMin: 10, tempC: 70, pressure_bar: 28, n_prime: 0.38, K_prime_PaSn: 1.95, r2: 0.99, bingham_PV_PaS: 0.03, bingham_YP_Pa: 6.2, bingham_r2: 0.99 }
    ],
    unitSystem: 'SI'
};

async function testExcelChart() {
    console.log('🧪 Testing Excel Chart Generation...\n');

    const outputDir = path.join(process.cwd(), 'test-output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Test 1: Full Excel with all series
    console.log('📊 Test 1: Full chart (all series visible)...');
    try {
        const testData: ExcelInputData = {
            ...baseTestData,
            showPressure: true,
            showTemperature: true,
            showShearRate: true
        };
        const chartBuffer = await ExcelChartService.generate(testData);
        const chartPath = path.join(outputDir, 'test-all-series.xlsx');
        fs.writeFileSync(chartPath, Buffer.from(chartBuffer));
        console.log(`   ✅ SUCCESS: ${chartPath} (${Buffer.from(chartBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    // Test 2: Chart without Temperature
    console.log('📊 Test 2: Chart without Temperature...');
    try {
        const testData: ExcelInputData = {
            ...baseTestData,
            showPressure: true,
            showTemperature: false,
            showShearRate: true
        };
        const chartBuffer = await ExcelChartService.generate(testData);
        const chartPath = path.join(outputDir, 'test-no-temperature.xlsx');
        fs.writeFileSync(chartPath, Buffer.from(chartBuffer));
        console.log(`   ✅ SUCCESS: ${chartPath} (${Buffer.from(chartBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    // Test 3: Chart without ShearRate
    console.log('📊 Test 3: Chart without Shear Rate...');
    try {
        const testData: ExcelInputData = {
            ...baseTestData,
            showPressure: true,
            showTemperature: true,
            showShearRate: false
        };
        const chartBuffer = await ExcelChartService.generate(testData);
        const chartPath = path.join(outputDir, 'test-no-shearrate.xlsx');
        fs.writeFileSync(chartPath, Buffer.from(chartBuffer));
        console.log(`   ✅ SUCCESS: ${chartPath} (${Buffer.from(chartBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    // Test 4: Chart with ShearRate on left axis
    console.log('📊 Test 4: Shear Rate on Left Axis...');
    try {
        const testData: ExcelInputData = {
            ...baseTestData,
            showPressure: false,
            showTemperature: true,
            showShearRate: true,
            shearRateAxis: 'left'
        };
        const chartBuffer = await ExcelChartService.generate(testData);
        const chartPath = path.join(outputDir, 'test-shearrate-left.xlsx');
        fs.writeFileSync(chartPath, Buffer.from(chartBuffer));
        console.log(`   ✅ SUCCESS: ${chartPath} (${Buffer.from(chartBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    // Test 5: Chart with Pressure on left axis
    console.log('📊 Test 5: Pressure on Left Axis...');
    try {
        const testData: ExcelInputData = {
            ...baseTestData,
            showPressure: true,
            showTemperature: true,
            showShearRate: true,
            pressureAxis: 'left'
        };
        const chartBuffer = await ExcelChartService.generate(testData);
        const chartPath = path.join(outputDir, 'test-pressure-left.xlsx');
        fs.writeFileSync(chartPath, Buffer.from(chartBuffer));
        console.log(`   ✅ SUCCESS: ${chartPath} (${Buffer.from(chartBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    // Test 6: Minimal chart (only Viscosity)
    console.log('📊 Test 6: Minimal chart (Viscosity only)...');
    try {
        const testData: ExcelInputData = {
            ...baseTestData,
            showPressure: false,
            showTemperature: false,
            showShearRate: false
        };
        const chartBuffer = await ExcelChartService.generate(testData);
        const chartPath = path.join(outputDir, 'test-viscosity-only.xlsx');
        fs.writeFileSync(chartPath, Buffer.from(chartBuffer));
        console.log(`   ✅ SUCCESS: ${chartPath} (${Buffer.from(chartBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    // Test 7: ExcelGeneratorService (fallback, no charts)
    console.log('📋 Test 7: ExcelGeneratorService (data only, no charts)...');
    try {
        const dataBuffer = await ExcelGeneratorService.generate(baseTestData);
        const dataPath = path.join(outputDir, 'test-without-chart.xlsx');
        fs.writeFileSync(dataPath, Buffer.from(dataBuffer));
        console.log(`   ✅ SUCCESS: ${dataPath} (${Buffer.from(dataBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    // Test 8: Touch Points (legend exclusion test)
    console.log('📊 Test 8: Touch Points (legend exclusion test)...');
    try {
        const testData: ExcelInputData = {
            ...baseTestData,
            showPressure: false,
            showTemperature: true,
            showShearRate: false,
            showTouchPoints: true,
            viscosityThreshold: 100,
            showTargetTime: true,
            targetTime: 5
        };
        const chartBuffer = await ExcelChartService.generate(testData);
        const chartPath = path.join(outputDir, 'test-touch-points.xlsx');
        fs.writeFileSync(chartPath, Buffer.from(chartBuffer));
        console.log(`   ✅ SUCCESS: ${chartPath} (${Buffer.from(chartBuffer).length} bytes)\n`);
    } catch (error) {
        console.log(`   ❌ FAILED: ${error}\n`);
    }

    console.log('🎉 All tests completed! Check test-output/ folder for results.');
    console.log('\n📁 Generated files:');
    console.log('   - test-all-series.xlsx        (all 4 series)');
    console.log('   - test-no-temperature.xlsx   (without Temperature)');
    console.log('   - test-no-shearrate.xlsx     (without Shear Rate)');
    console.log('   - test-shearrate-left.xlsx   (Shear Rate on primary Y axis)');
    console.log('   - test-pressure-left.xlsx    (Pressure on primary Y axis)');
    console.log('   - test-viscosity-only.xlsx   (Viscosity only)');
    console.log('   - test-without-chart.xlsx    (Data only, fallback mode)');
    console.log('   - test-touch-points.xlsx     (Touch points with legend fix)');
}

testExcelChart().catch(console.error);
