
import React from 'react';
import ReactPDF from '@react-pdf/renderer';
import { ReportDocument } from '../src/components/reports/pdf/ReportDocument';
import fs from 'fs';
import path from 'path';

// Helper to snake_case to camelCase
const toCamel = (s: string) => {
    return s.replace(/([-_][a-z])/ig, ($1) => {
        return $1.toUpperCase()
            .replace('-', '')
            .replace('_', '');
    });
};

const keysToCamel = (o: any): any => {
    if (o === Object(o) && !Array.isArray(o) && typeof o !== 'function') {
        const n: any = {};
        Object.keys(o).forEach((k) => {
            n[toCamel(k)] = keysToCamel(o[k]);
        });
        return n;
    } else if (Array.isArray(o)) {
        return o.map((i) => keysToCamel(i));
    }
    return o;
};

async function generate() {
    const jsonPath = path.resolve(__dirname, '../tests/fixtures/report_data.json');
    const outputPath = path.resolve(__dirname, '../legacy_report.pdf');

    console.log(`Reading JSON from: ${jsonPath}`);
    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const dataSnake = JSON.parse(rawData);

    // Convert to camelCase because React components expect camelCase props
    const data = keysToCamel(dataSnake);

    console.log('Mapping data...');

    // Map to Experiment interface expected by ReportDocument
    const experiment = {
        testId: data.metadata.testId,
        filename: data.metadata.filename, // Added missing property
        originalFilename: data.metadata.filename,
        testDate: data.metadata.testDate,
        operatorName: data.metadata.operatorName,
        laboratoryName: data.metadata.laboratoryName,
        fieldName: data.metadata.fieldName,
        wellNumber: data.metadata.wellNumber,
        instrumentType: data.metadata.instrumentType,
        geometry: data.metadata.geometry,

        calibration: data.metadata.calibration,

        waterParams: data.waterParams,
        waterSource: data.waterParams?.source,

        reagents: data.recipe.map((r: any) => ({
            reagentName: r.name,
            batchNumber: r.batchNumber, // mapped from batch_number
            category: r.category,
            concentration: r.concentration,
            unit: r.unit
        })),

        metrics: {
            maxViscosity: 0,
            maxTemp: 0,
            duration: 0
        },
        rawPoints: []
    };

    const settings = {
        language: data.settings.language,
        unitSystem: data.settings.unitSystem,
        companyName: data.metadata.companyName,
        companyLogo: null,
        showCalibration: data.metadata.calibration ? true : false,
        showTouchPoints: false
    };

    const cycleResults = data.cycleResults.map((r: any) => ({
        ...r,
        K_prime_PaSn: r.kPrimePaSn,
        bingham_PV_PaS: r.binghamPvPaS,
        bingham_YP_Pa: r.binghamYpPa,
        // Need to check specific field names in legacy component
        // StatisticsTable expects: viscAt40, viscAt100, etc. (camelCase from our converter)
    }));

    // Fix specific fields that might need original naming if component uses snake_case internally?
    // ReportDocument -> StatisticsTable uses `metrics.cycles`.
    // StatisticsTable uses key access? 
    // Let's assume camelCase is fine for most, but verify key props.

    console.log('Rendering PDF...');
    await ReactPDF.renderToFile(
        <ReportDocument
            experiment={experiment}
            chartImage=""
            settings={settings}
            cycleResults={cycleResults}
            cycles={[]} // Empty for now
        />,
        outputPath
    );

    console.log(`Legacy PDF saved to: ${outputPath}`);
}

generate().catch(err => {
    console.error('Error generating legacy PDF:', err);
    process.exit(1);
});
