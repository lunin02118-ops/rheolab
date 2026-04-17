/**
 * Tests for src/lib/metadata-utils.ts
 * Field extraction with legacy fallback for experiment metadata.
 */
import { describe, it, expect } from 'vitest';
import { getMetadataField, extractExperimentMetadata } from '@/lib/metadata-utils';
import type { ParsingMetadata } from '@/lib/parsing/types';

// ── Helpers ────────────────────────────────────────────────────────────────

type TestMetadata = ParsingMetadata & {
    testId?: string;
    fieldName?: string;
    operatorName?: string;
    wellNumber?: string;
    laboratoryName?: string;
};

function makeMetadata(overrides: Partial<TestMetadata> = {}): TestMetadata {
    return { filename: 'test.xlsx', ...overrides };
}

// ── getMetadataField ───────────────────────────────────────────────────────

describe('getMetadataField', () => {
    it('returns value from filenameMetadata when present', () => {
        const meta = makeMetadata({
            filenameMetadata: { fieldName: 'Eagleford', testId: 'T001' },
        });
        expect(getMetadataField(meta, 'fieldName')).toBe('Eagleford');
    });

    it('falls back to legacy flat field when filenameMetadata is absent', () => {
        const meta = makeMetadata({ fieldName: 'Permian' });
        expect(getMetadataField(meta, 'fieldName')).toBe('Permian');
    });

    it('prefers filenameMetadata over legacy flat field', () => {
        const meta = makeMetadata({
            fieldName: 'legacy_field',
            filenameMetadata: { fieldName: 'nested_field' },
        });
        expect(getMetadataField(meta, 'fieldName')).toBe('nested_field');
    });

    it('returns undefined when neither location has the field', () => {
        const meta = makeMetadata();
        expect(getMetadataField(meta, 'fieldName')).toBeUndefined();
    });

    it('returns testId from filenameMetadata', () => {
        const meta = makeMetadata({ filenameMetadata: { testId: 'T999' } });
        expect(getMetadataField(meta, 'testId')).toBe('T999');
    });

    it('returns operatorName from legacy field', () => {
        const meta = makeMetadata({ operatorName: 'J.Smith' });
        expect(getMetadataField(meta, 'operatorName')).toBe('J.Smith');
    });

    it('returns wellNumber correctly', () => {
        const meta = makeMetadata({ filenameMetadata: { wellNumber: 'W-42' } });
        expect(getMetadataField(meta, 'wellNumber')).toBe('W-42');
    });
});

// ── extractExperimentMetadata ──────────────────────────────────────────────

describe('extractExperimentMetadata', () => {
    it('extracts all six fields from nested filenameMetadata', () => {
        const meta = makeMetadata({
            filenameMetadata: {
                testId: 'T01',
                fieldName: 'Haynesville',
                operatorName: 'Alice',
                wellNumber: 'W-1',
            },
            laboratoryName: 'Rheo Lab',
        });
        const result = extractExperimentMetadata(meta);
        expect(result.testId).toBe('T01');
        expect(result.fieldName).toBe('Haynesville');
        expect(result.operatorName).toBe('Alice');
        expect(result.wellNumber).toBe('W-1');
    });

    it('returns all undefined when metadata is empty', () => {
        const meta = makeMetadata();
        const result = extractExperimentMetadata(meta);
        expect(result.testId).toBeUndefined();
        expect(result.fieldName).toBeUndefined();
        expect(result.operatorName).toBeUndefined();
    });
});
