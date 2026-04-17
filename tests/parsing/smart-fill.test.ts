import { describe, test, expect } from 'vitest';
import { parseExperimentFilename } from '@/lib/utils/smart-fill-utils';

describe('parseExperimentFilename', () => {

    test('parses real SST Mamontovskoe filename', () => {
        const result = parseExperimentFilename(
            '8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv'
        );
        expect(result.fieldName).toBe('Mamontovskoe');
        expect(result.temperature).toBe(63);
        expect(result.testDate).toEqual(new Date(2025, 9, 30));
    });

    test('parses temperature from generic filename', () => {
        const result = parseExperimentFilename('Test_Well_123_Viscosity_60C_2023-10-15.xls');
        // Function parses temperature from "60C" pattern
        expect(result.temperature).toBe(60);
        // ISO date format (2023-10-15) is not currently supported — only DD.MM.YY
        // wellNumber detection does not match the word "Well" without "Скв"/"Skv" prefix
    });

    test('parses field and well from Samotlor filename', () => {
        const result = parseExperimentFilename('Report_Samotlor_Skv-55_Crosslinked_Gel.xlsx');
        expect(result.fieldName).toBe('Samotlor');
        expect(result.wellNumber).toBe('55');
    });

    test('parses well number from pad filename', () => {
        const result = parseExperimentFilename('Unknown_Sample_pad 5.csv');
        expect(result.wellNumber).toBe('5');
    });
});
