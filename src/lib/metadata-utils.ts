import { ParsingMetadata } from './parsing/types';

/**
 * Legacy metadata fields that were moved to filenameMetadata.
 * This interface is used for backward compatibility with old data.
 */
interface LegacyMetadataFields {
    testId?: string;
    fieldName?: string;
    operatorName?: string;
    wellNumber?: string;
    laboratoryName?: string;
}

/**
 * Safely extract metadata fields with fallback to legacy location.
 * Handles the migration from flat metadata to nested filenameMetadata structure.
 */
export function getMetadataField<K extends keyof LegacyMetadataFields>(
    metadata: ParsingMetadata & LegacyMetadataFields,
    field: K
): LegacyMetadataFields[K] {
    return metadata.filenameMetadata?.[field as keyof typeof metadata.filenameMetadata] as LegacyMetadataFields[K]
        ?? (metadata as LegacyMetadataFields)[field];
}

/**
 * Extract all common metadata fields with fallbacks.
 * Use this to build experiment data objects.
 */
export function extractExperimentMetadata(metadata: ParsingMetadata & LegacyMetadataFields) {
    return {
        testId: getMetadataField(metadata, 'testId'),
        fieldName: getMetadataField(metadata, 'fieldName'),
        operatorName: getMetadataField(metadata, 'operatorName'),
        wellNumber: getMetadataField(metadata, 'wellNumber'),
        laboratoryName: getMetadataField(metadata, 'laboratoryName'),
    };
}
