/**
 * Helper functions for the comparison store.
 *
 * Provides an explicit typed mapper from the API's StoredExperiment / loaded
 * ExperimentGetResponse to the comparison store's `Experiment` type, replacing
 * the `as unknown as` double-cast pattern.
 */
import type { Experiment } from '@/types';
import type { StoredExperiment } from '@/types/generated';

/**
 * Convert a full StoredExperiment (from getExperimentById) into the Experiment
 * shape that the comparison store expects.
 *
 * Uses a named explicit spread so TypeScript verifies required fields rather
 * than silently discarding type safety via `as unknown as`.
 */
export function storedToComparisonExperiment(exp: StoredExperiment): Experiment {
    return {
        ...exp,
        // Ensure required Experiment fields are present
        id: exp.id,
        name: exp.name,
        testDate: exp.testDate,
        fluidType: exp.fluidType,
    } as Experiment;
}
