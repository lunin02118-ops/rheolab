/**
 * Smart Fill Utilities
 * Parses filenames and text to extract experiment metadata.
 */

export interface ExtractedMetadata {
    fieldName?: string;
    wellNumber?: string;
    operatorName?: string;
    testDate?: Date;
    temperature?: number;
    fluidType?: 'Linear' | 'Crosslinked';
}

export function parseExperimentFilename(filename: string): ExtractedMetadata {
    const metadata: ExtractedMetadata = {};
    const name = filename.replace(/\.[^/.]+$/, ''); // Remove extension

    // 1. Extract Temperature (e.g., "..._60C...", "...@25C...", " 60C")
    // Limits: 0-200C
    // [\s_-] or start of string, then digits, then C, then boundary/separator
    const tempMatch = name.match(/(?:^|[\s_@-])(\d{1,3})\s*[CcСс](?:elsius)?(?=$|[\s_.-])/);
    if (tempMatch) {
        const t = parseInt(tempMatch[1]);
        if (t > 0 && t < 200) metadata.temperature = t;
    }

    // 2. Extract Date (e.g., "2023-10-15", "15.10.23", "15_10_2023")
    // DD.MM.YY or DD.MM.YYYY or YYYY-MM-DD
    const dateMatch =
        name.match(/\b(\d{2})[._-](\d{2})[._-](\d{2,4})\b/) || // DD.MM.YY(YY)
        name.match(/\b(\d{4})[._-](\d{2})[._-](\d{2})\b/);    // YYYY-MM-DD

    if (dateMatch) {
        try {
            let day, month, year;
            if (dateMatch[1].length === 4) {
                // YYYY-MM-DD
                year = parseInt(dateMatch[1]);
                month = parseInt(dateMatch[2]) - 1;
                day = parseInt(dateMatch[3]);
            } else {
                // DD.MM.YY
                day = parseInt(dateMatch[1]);
                month = parseInt(dateMatch[2]) - 1;
                const y = parseInt(dateMatch[3]);
                year = y < 100 ? 2000 + y : y;
            }
            const date = new Date(year, month, day);
            if (!isNaN(date.getTime())) {
                metadata.testDate = date;
            }
        } catch (_e) {
            // Ignore invalid dates
        }
    }

    // 3. Extract Well Number (e.g., "well_123", "скв_123", "pad_5", "куст_5")
    // Looks for keywords: well, skv, pad, kust, k-
    const wellMatch =
        name.match(/(?:well|skv|скв\.?|pad|куст)[_\s-]*([a-zA-Z0-9\/-]+)/i) ||
        name.match(/\b([kк]-\d+)\b/i); // k-123 pattern

    if (wellMatch) {
        metadata.wellNumber = wellMatch[1];
    }

    // 4. Extract Field Name (Common Russian fields - simple dictionary check + Heuristic)
    // This is harder without a DB, but we can look for capitalized words before known keywords
    // Or just look for specific known fields if any
    const knownFields = [
        'Samotlor', 'Самотлор',
        'Mamontovskoe', 'Мамонтовское',
        'Priobskoe', 'Приобское',
        'Vankor', 'Ванкор',
        'Urengoy', 'Уренгой',
        'Yamburg', 'Ямбург'
    ];

    for (const field of knownFields) {
        if (name.toLowerCase().includes(field.toLowerCase())) {
            // Capitalize first letter logic or use the dict value
            metadata.fieldName = field;
            break;
        }
    }

    // 5. Detect Fluid Type hints
    if (name.match(/cross|xlink|сшит/i)) {
        metadata.fluidType = 'Crosslinked';
    } else if (name.match(/linear|lin|линейн/i)) {
        metadata.fluidType = 'Linear';
    }

    return metadata;
}
