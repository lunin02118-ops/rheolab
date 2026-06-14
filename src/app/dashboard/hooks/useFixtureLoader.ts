/**
 * useFixtureLoader Hook
 * 
 * Загрузка тестовых fixture файлов для демо-режима
 */

import { useState, useEffect, useCallback } from 'react';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import { listFixtures, parseFixture } from '@/lib/fixtures/client';

interface Fixture {
    name: string;
    displayName: string;
}

interface UseFixtureLoaderOptions {
    aiModel?: string;
    externalAiEnabled?: boolean;
    forceAI?: boolean;
    onLoad: (result: ParseResult) => void;
    onError: (message: string) => void;
}

export function useFixtureLoader({ aiModel, externalAiEnabled, forceAI, onLoad, onError }: UseFixtureLoaderOptions) {
    const [fixtures, setFixtures] = useState<Fixture[]>([]);
    const [loadingFixture, setLoadingFixture] = useState<string | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);

    // Load available fixtures on mount
    useEffect(() => {
        let cancelled = false;
        listFixtures()
            .then((items) => { if (!cancelled) setFixtures(items); })
            .catch((error) => console.error('Failed to load fixtures:', error));
        return () => { cancelled = true; };
    }, []);

    const loadFixture = useCallback(async (filename: string) => {
        setLoadingFixture(filename);
        setShowDropdown(false);

        try {
            const result = await parseFixture(filename, aiModel, forceAI, externalAiEnabled);
            onLoad(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            onError(`Failed to load fixture: ${message}`);
        } finally {
            setLoadingFixture(null);
        }
    }, [aiModel, externalAiEnabled, forceAI, onLoad, onError]);

    return {
        fixtures,
        loadingFixture,
        showDropdown,
        setShowDropdown,
        loadFixture
    };
}
