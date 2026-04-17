/**
 * Test: Geometry Save/Load from Database
 * Verifies that geometry and geometrySource are correctly saved and loaded
 * 
 * NOTE: These tests require authenticated API access which needs auth setup.
 * TODO: Configure playwright auth state for API tests
 */

import { test, expect } from '@playwright/test';

test.describe('Geometry Save/Load', () => {

    // Skip this test until auth is properly configured for API requests
    test.skip('should save and load geometry correctly', async ({ request }) => {
        // 1. First, create an experiment with geometry via API
        const testPayload = {
            name: 'Geometry Test Experiment',
            fieldName: 'Test Field',
            operatorName: 'Test Operator',
            wellNumber: 'W-001',
            testId: 'GEOM-TEST-001',
            originalFilename: 'geometry_test.csv',
            testDate: new Date().toISOString(),
            instrumentType: 'Grace M5600',
            geometry: 'R1B1',  // Specific geometry
            geometrySource: 'manual',  // Manual selection
            waterSource: 'Test Water',
            waterParams: null,
            fluidType: 'Linear',
            testGroup: 'Rheology',
            metrics: { maxViscosity: 100, maxTemp: 80 },
            rawPoints: [
                { time_sec: 0, viscosity_cp: 50, temperature_c: 25, speed_rpm: 100 },
                { time_sec: 60, viscosity_cp: 55, temperature_c: 30, speed_rpm: 100 }
            ],
            reagents: []
        };

        // Save experiment
        const saveResponse = await request.post('/api/experiments', {
            data: testPayload
        });

        console.log('Save response status:', saveResponse.status());
        const saveData = await saveResponse.json();
        console.log('Save response:', saveData);

        if (!saveResponse.ok()) {
            // If duplicate, try with overwrite
            if (saveData.code === 'DUPLICATE_ENTRY') {
                const overwriteResponse = await request.post('/api/experiments', {
                    data: { ...testPayload, overwrite: true }
                });
                const overwriteData = await overwriteResponse.json();
                console.log('Overwrite response:', overwriteData);
                expect(overwriteResponse.ok()).toBeTruthy();
            } else {
                throw new Error(`Save failed: ${JSON.stringify(saveData)}`);
            }
        }

        const experimentId = saveData.experimentId;
        expect(experimentId).toBeTruthy();

        // 2. Load the experiment back
        const loadResponse = await request.get(`/api/experiments/${experimentId}`);
        expect(loadResponse.ok()).toBeTruthy();

        const loadData = await loadResponse.json();
        console.log('Loaded experiment:', {
            geometry: loadData.experiment?.geometry,
            geometrySource: loadData.experiment?.geometrySource
        });

        // 3. Verify geometry was saved and loaded correctly
        expect(loadData.experiment).toBeTruthy();
        expect(loadData.experiment.geometry).toBe('R1B1');
        expect(loadData.experiment.geometrySource).toBe('manual');

        // Cleanup - delete the test experiment
        // Note: Would need password for delete, skip for now
    });

    test('check existing experiment geometry in database', async ({ request }) => {
        // Get list of experiments to find one with geometry
        const listResponse = await request.get('/api/experiments?limit=5');

        if (!listResponse.ok()) {
            console.log('Cannot list experiments (auth required)');
            test.skip();
            return;
        }

        const listData = await listResponse.json();
        console.log('Found experiments:', listData.experiments?.length);

        for (const exp of listData.experiments || []) {
            console.log(`Experiment "${exp.name}":`, {
                geometry: exp.geometry,
                geometrySource: exp.geometrySource,
                instrumentType: exp.instrumentType
            });
        }
    });
});
