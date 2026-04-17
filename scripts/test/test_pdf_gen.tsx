import React from 'react';
import { renderToFile } from '@react-pdf/renderer';
import { ReportDocument } from '../src/components/reports/pdf/ReportDocument';
import path from 'path';

// Mock data
const experiment = {
    testId: 'TEST-123',
    testDate: new Date().toISOString(),
    operatorName: 'Test Operator',
    fieldName: 'Test Field',
    wellNumber: 'Well-01',
    instrumentType: 'Test Instrument',
    geometry: 'R1B1',
    waterParams: { ph: 7 },
    waterSource: 'Test Source',
    reagents: [
        { reagentName: 'Water', concentration: 100, unit: '%', category: 'Base Fluid' }
    ]
};

const settings = {
    language: 'ru' as const,
    unitSystem: 'SI' as const,
    companyName: 'Test Company',
    companyLogo: null
};

const cycleResults = [
    { cycleNo: 1, n_prime: 0.5, K_prime_PaSn: 1.0, r2: 0.99, tempC: 25, timeMin: 10.5 }
];

const cycles: any[] = []; // Empty for now

const chartImage = ''; // Empty string or base64 placeholder

async function generate() {
    const outputPath = path.join(process.cwd(), 'test_output.pdf');
    console.log('Generating PDF to:', outputPath);

    try {
        await renderToFile(
            <ReportDocument
                experiment={experiment}
                chartImage={chartImage}
                settings={settings}
                cycleResults={cycleResults}
                cycles={cycles}
            />,
            outputPath
        );
        console.log('PDF generated successfully!');
    } catch (error) {
        console.error('Error generating PDF:', error);
        process.exit(1);
    }
}

generate();
