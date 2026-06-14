/**
 * Tests for src/components/dashboard/file-upload.tsx
 *
 * Strategy: mock the parsing client and Zustand stores so the
 * component can be rendered in jsdom without Tauri / WASM being present.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileUpload } from '@/components/dashboard/file-upload';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockParseRheologyFile = vi.fn();

vi.mock('@/lib/parsing/client', () => ({
    parseRheologyFile: (...args: unknown[]) => mockParseRheologyFile(...args),
    MAX_FILE_SIZE: 20 * 1024 * 1024,
}));

vi.mock('@/lib/store/analysis-settings-store', () => ({
    useAnalysisSettingsStore: (selector: (s: unknown) => unknown) =>
        selector({
            expertSettings: { aiModel: 'llama', externalAiEnabled: false, forceAiParsing: false },
            setExpertSettings: vi.fn(),
        }),
}));

const mockReset = vi.fn();
vi.mock('@/lib/store/experiment-data-store', () => ({
    useExperimentDataStore: vi.fn(),
    // we only use getState().reset() inside handleFile
}));

// Patch getState on the module after import
import * as expDataStore from '@/lib/store/experiment-data-store';
(expDataStore.useExperimentDataStore as unknown as { getState: () => { reset: () => void } }).getState = () => ({
    reset: mockReset,
});

// requestIdleCallback is not in jsdom
global.requestIdleCallback = ((cb: IdleRequestCallback) => {
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 0;
}) as typeof requestIdleCallback;

// ── Helpers ────────────────────────────────────────────────────────────────

const defaultProps = {
    onFileProcessed: vi.fn(),
    onError: vi.fn(),
};

function mkFile(name: string, type = 'application/vnd.ms-excel') {
    return new File(['data'], name, { type });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('FileUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── idle state ─────────────────────────────────────────────────────────

    it('shows idle state by default', () => {
        render(<FileUpload {...defaultProps} />);
        expect(screen.getByTestId('UploadCardIdleState')).toBeDefined();
        expect(screen.getByText(/Загрузите файл реологии/i)).toBeDefined();
    });

    it('shows supported extension list in idle state', () => {
        render(<FileUpload {...defaultProps} />);
        expect(screen.getByText('.xlsx, .csv, .txt, .dat')).toBeDefined();
    });

    // ── external loading state ─────────────────────────────────────────────

    it('shows loading state when externalLoading=true', () => {
        render(<FileUpload {...defaultProps} externalLoading={true} />);
        expect(screen.getByTestId('UploadCardLoadingState')).toBeDefined();
        expect(screen.getByText(/Анализируем структуру/i)).toBeDefined();
    });

    // ── external success state ─────────────────────────────────────────────

    it('shows success state when loadedFileName is provided', () => {
        const { container } = render(<FileUpload {...defaultProps} loadedFileName="demo.xlsx" />);
        expect(screen.getByTestId('UploadCardSuccessState')).toBeDefined();
        expect(screen.getByTestId('UploadCardSuccessFileName').textContent).toBe('demo.xlsx');
        expect(container.querySelector('.animate-ping-slow')).toBeNull();
    });

    // ── reset from success ─────────────────────────────────────────────────

    it('calls onReset when "Загрузить другой файл" is clicked in success state', () => {
        const onReset = vi.fn();
        render(<FileUpload {...defaultProps} loadedFileName="demo.xlsx" onReset={onReset} />);
        fireEvent.click(screen.getByTestId('UploadCardResetLink'));
        expect(onReset).toHaveBeenCalledOnce();
    });

    // ── file validation ────────────────────────────────────────────────────

    it('calls onError for unsupported file extension', async () => {
        const onError = vi.fn();
        render(<FileUpload {...defaultProps} onError={onError} />);

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [mkFile('report.pdf', 'application/pdf')] });
        fireEvent.change(input);

        await waitFor(() => {
            expect(onError).toHaveBeenCalledWith(expect.stringContaining('Неподдерживаемый формат файла'));
        });
    });

    // ── successful file parse ──────────────────────────────────────────────

    it('calls onFileProcessed after successful parse', async () => {
        const fakeResult = { metadata: {}, data: [] };
        mockParseRheologyFile.mockResolvedValue(fakeResult);
        const onFileProcessed = vi.fn();

        render(<FileUpload {...defaultProps} onFileProcessed={onFileProcessed} />);

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [mkFile('test.xlsx')] });
        fireEvent.change(input);

        await waitFor(() => {
            expect(onFileProcessed).toHaveBeenCalledWith(fakeResult);
        });
        expect(mockParseRheologyFile).toHaveBeenCalledWith(
            expect.any(File),
            expect.objectContaining({
                externalAiEnabled: false,
                forceAI: false,
            }),
        );
    });

    // ── drag events ────────────────────────────────────────────────────────

    it('shows drag-over state while dragging over', () => {
        render(<FileUpload {...defaultProps} />);
        const card = screen.getByTestId('FileUploadCard');
        fireEvent.dragOver(card);
        expect(screen.getByTestId('UploadCardDragOverState')).toBeDefined();
    });

    it('clears drag-over state on drag leave', () => {
        render(<FileUpload {...defaultProps} />);
        const card = screen.getByTestId('FileUploadCard');
        fireEvent.dragOver(card);
        fireEvent.dragLeave(card);
        expect(screen.queryByTestId('UploadCardDragOverState')).toBeNull();
    });
});
