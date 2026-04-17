/**
 * toWirePayload — converts the app-layer ExperimentSavePayload (src/types/index.ts)
 * to the Tauri IPC wire type (src/types/generated.d.ts, re-exported from @/types/tauri).
 *
 * The app type uses rich TS constructs: Date objects, typed enums, and nullable
 * optionals expressed as `field?: T`.  The generated wire type (derived from the
 * Rust Specta bindings) uses ISO strings for dates, plain strings for enums, and
 * explicit `T | null` nullability matching serde_json Option<T>.
 *
 * Using this converter in client.ts removes the need for the `as unknown as
 * Record<string, unknown>` bridge cast and lets the compiler verify the boundary.
 */

import type { ExperimentSavePayload as AppPayload } from '@/types';
import type { ExperimentSavePayload as WirePayload, StoredExperimentReagent } from '@/types/tauri';

/**
 * Map one app-layer reagent to the StoredExperimentReagent wire shape.
 * productionDate is serialised to ISO string (Rust expects String, not Date).
 */
function mapReagent(r: AppPayload['reagents'][number]): StoredExperimentReagent {
    let productionDate: string | null = null;
    if (r.productionDate instanceof Date) {
        productionDate = r.productionDate.toISOString();
    } else if (typeof r.productionDate === 'string' && r.productionDate) {
        productionDate = r.productionDate;
    }

    return {
        reagentId:    r.reagentId    ?? null,
        reagentName:  r.reagentName  ?? null,
        concentration: r.concentration,
        unit:          r.unit,
        batchNumber:  r.batchNumber  ?? null,
        productionDate,
        category:     r.category     ?? null,
        // `reagent` is a DB-side join — not available on the app side at save time.
        reagent: null,
    };
}

export function toWirePayload(app: AppPayload): WirePayload {
    const testDate =
        app.testDate instanceof Date
            ? app.testDate.toISOString()
            : String(app.testDate);

    return {
        name:            app.name,
        fieldName:       app.fieldName       ?? null,
        operatorName:    app.operatorName    ?? null,
        wellNumber:      app.wellNumber      ?? null,
        testId:          app.testId          ?? null,
        originalFilename: app.originalFilename,
        testDate,
        instrumentType:  app.instrumentType,
        geometry:        app.geometry        ?? null,
        geometrySource:  app.geometrySource  ?? null,
        waterSource:     app.waterSource,
        // WaterParams is a plain JSON-serialisable object — cast to JsonValue.
        waterParams:     (app.waterParams ?? null) as WirePayload['waterParams'],
        fluidType:       app.fluidType as string,
        testGroup:       app.testGroup as string,
        testSubGroup:    app.testSubGroup    ?? null,
        testCategory:    app.testCategory    ?? null,
        testType:        app.testType        ?? null,
        // dominantPattern is populated server-side; not available on app layer.
        dominantPattern: null,
        // TestMetrics / CalibrationData are JSON-serialisable structs — cast to JsonValue.
        metrics:         app.metrics as unknown as WirePayload['metrics'],
        rawPoints:       app.rawPoints       as unknown as WirePayload['rawPoints'],
        calibration:     (app.calibration    ?? null) as unknown as WirePayload['calibration'],
        reagents:        app.reagents?.map(mapReagent),
        overwrite:       app.overwrite       ?? null,
        laboratoryId:    app.laboratoryId    ?? null,
        parsedBy:        app.parsedBy        ?? null,
        parseSource:     app.parseSource     ?? null,
        timeRangeMin:    app.timeRangeMin    ?? null,
        timeRangeMax:    app.timeRangeMax    ?? null,
        viscosityMin:    app.viscosityMin    ?? null,
        pressureMax:     app.pressureMax     ?? null,
        extraFields:     (app.extraFields    ?? null) as WirePayload['extraFields'],
    };
}
