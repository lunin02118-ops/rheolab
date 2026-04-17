import type { ParseResult } from '@/types';
import { parseExperimentFilename } from '@/lib/utils/smart-fill-utils';

type FilenameMetadata = NonNullable<ParseResult['metadata']['filenameMetadata']>;
type RecipeItem = NonNullable<FilenameMetadata['recipe']>[number];

interface ExtractFilenameMetadataResult {
  filenameMetadata?: FilenameMetadata;
  testDate?: Date;
}

const TEST_TYPE_MAP: Record<string, string> = {
  SST: 'Shear Stability Test',
  SWB: 'Shear sweep With Breaker',
  HST: 'High Shear Test',
  LVT: 'Low Viscosity Test',
};

const RECIPE_REGEX = /(\d+(?:\.\d+)?)\(([A-Za-z0-9-]+)\)/g;
const TEST_ID_REGEX = /^\d+$/;
const TEST_TYPE_REGEX = /^[A-Z]{2,4}$/;
const FIELD_DEST_REGEX = /([A-Za-zА-Яа-яёЁ]+)_\(([^)]+)\)/;
const TEMP_REGEX = /@(\d+)[CcСс]/;
const END_DATE_REGEX = /(\d{2})\.(\d{2})(?:\.(\d{2,4}))?$/;

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function _normalizeRecipeItems(items: unknown): RecipeItem[] | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }

  const normalized = items
    .map((item): RecipeItem | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const candidate = item as Record<string, unknown>;
      const abbreviation = asString(candidate.abbreviation);
      const concentration = asNumber(candidate.concentration);
      if (!abbreviation || concentration === undefined) {
        return null;
      }

      return {
        abbreviation,
        concentration,
        unit: asString(candidate.unit) || 'kg/m3',
        category: asString(candidate.category),
        reagentId: asString(candidate.reagentId),
        reagentName: asString(candidate.reagentName),
      };
    })
    .filter((item): item is RecipeItem => item !== null);

  return normalized.length > 0 ? normalized : undefined;
}

function hasMetadataValue(metadata: FilenameMetadata): boolean {
  return Boolean(
    metadata.testId ||
      metadata.testType ||
      metadata.testTypeFull ||
      metadata.fieldName ||
      metadata.wellNumber ||
      metadata.operatorName ||
      metadata.destination ||
      metadata.waterSource ||
      metadata.temperature !== undefined ||
      (metadata.recipe && metadata.recipe.length > 0),
  );
}

function parseDateFromFilename(baseName: string): Date | undefined {
  const match = baseName.match(END_DATE_REGEX);
  if (!match) {
    return undefined;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const rawYear = match[3];
  const year = rawYear
    ? rawYear.length === 2
      ? Number.parseInt(rawYear, 10) + 2000
      : Number.parseInt(rawYear, 10)
    : new Date().getFullYear();

  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function buildFallbackMetadata(filename: string): ExtractFilenameMetadataResult {
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const metadata: FilenameMetadata = {};

  const parts = baseName.split(/\s+/).filter(Boolean);
  if (parts.length > 0 && TEST_ID_REGEX.test(parts[0])) {
    metadata.testId = parts[0];
  }
  if (parts.length > 1 && TEST_TYPE_REGEX.test(parts[1])) {
    metadata.testType = parts[1];
    metadata.testTypeFull = TEST_TYPE_MAP[parts[1]] || 'Unknown Test Type';
  }

  const fieldDestMatch = baseName.match(FIELD_DEST_REGEX);
  if (fieldDestMatch) {
    metadata.fieldName = fieldDestMatch[1];
    metadata.destination = fieldDestMatch[2].replace(/_/g, ' ');
    metadata.waterSource = metadata.destination;
  }

  const tempMatch = baseName.match(TEMP_REGEX);
  if (tempMatch) {
    metadata.temperature = Number.parseInt(tempMatch[1], 10);
  }

  const recipe: RecipeItem[] = [];
  RECIPE_REGEX.lastIndex = 0;
  for (const match of baseName.matchAll(RECIPE_REGEX)) {
    const concentration = Number.parseFloat(match[1]);
    const abbreviation = match[2];
    if (!Number.isFinite(concentration) || !abbreviation) {
      continue;
    }
    recipe.push({
      abbreviation,
      concentration,
      unit: 'kg/m3',
    });
  }
  if (recipe.length > 0) {
    metadata.recipe = recipe;
  }

  const heuristicMetadata = parseExperimentFilename(filename);
  if (!metadata.fieldName && heuristicMetadata.fieldName) {
    metadata.fieldName = heuristicMetadata.fieldName;
  }
  if (!metadata.wellNumber && heuristicMetadata.wellNumber) {
    metadata.wellNumber = heuristicMetadata.wellNumber;
  }
  if (!metadata.operatorName && heuristicMetadata.operatorName) {
    metadata.operatorName = heuristicMetadata.operatorName;
  }
  if (metadata.temperature === undefined && heuristicMetadata.temperature !== undefined) {
    metadata.temperature = heuristicMetadata.temperature;
  }

  const testDate = parseDateFromFilename(baseName) || heuristicMetadata.testDate;
  return {
    filenameMetadata: hasMetadataValue(metadata) ? metadata : undefined,
    testDate,
  };
}

/**
 * Best-effort filename metadata extraction using local regex heuristics.
 * In Tauri desktop the Rust native parser handles filename metadata via IPC;
 * this function is a local-only fallback.
 */
export async function extractFilenameMetadata(filename: string): Promise<ExtractFilenameMetadataResult> {
  return buildFallbackMetadata(filename);
}
