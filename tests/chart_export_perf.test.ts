
import { describe, it, expect, vi } from 'vitest';

// Mock DOM interfaces since we don't have jsdom
class MockElement {
    tagName: string;
    children: MockElement[];
    attributes: Map<string, string>;
    style: Map<string, string>;

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.style = new Map();
    }

    appendChild(child: MockElement) {
        this.children.push(child);
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }
}

// Mock window.getComputedStyle
const mockGetComputedStyle = vi.fn((_element: unknown) => {  
    return {
        getPropertyValue: (_prop: string) => {  
            // Simulate some work
            return '10px';
        }
    };
});

// Optimized inlineStyles with sibling caching
function inlineStyles(source: MockElement, target: MockElement, siblingCache?: { className: string, styleAttr: string, result: string }): void {
    const className = source.getAttribute('class') || '';
    const styleAttr = source.getAttribute('style') || '';

    let styleStr = '';

    // Check if we can reuse the style string from the previous sibling
    // This assumes siblings with same class/style/parent have same computed styles
    // (ignores nth-child selectors, which is acceptable for same-class sibling caching)
    if (siblingCache && siblingCache.className === className && siblingCache.styleAttr === styleAttr) {
        styleStr = siblingCache.result;
    } else {
        const computed = mockGetComputedStyle(source);
        const importantStyles = [
            'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
            'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'opacity',
            'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'
        ];

        for (const prop of importantStyles) {
            const value = computed.getPropertyValue(prop);
            const val = value as string;
            if (val && val !== 'none' && val !== '' && val !== 'normal') {
                if (val === 'inherit' || val === 'initial') continue;
                styleStr += `${prop}:${value};`;
            }
        }

        // Update cache for next sibling
        if (siblingCache) {
            siblingCache.className = className;
            siblingCache.styleAttr = styleAttr;
            siblingCache.result = styleStr;
        }
    }

    if (styleStr) {
        const existing = target.getAttribute('style') || '';
        target.setAttribute('style', existing + styleStr);
    }

    // Process children
    const sourceChildren = source.children;
    const targetChildren = target.children;

    // Create a new cache context for the children of this element
    // This ensures we only cache across siblings (who share the same parent)
    const childCache = { className: '___INITIAL___', styleAttr: '___INITIAL___', result: '' };

    for (let i = 0; i < sourceChildren.length && i < targetChildren.length; i++) {
        inlineStyles(sourceChildren[i], targetChildren[i], childCache);
    }
}

describe('inlineStyles Performance', () => {
    it('should handle large DOM trees with caching', () => {
        // Reset mock
        mockGetComputedStyle.mockClear();

        // Create a large tree
        const root = new MockElement('svg');
        const targetRoot = new MockElement('svg');

        // Add 5000 children (simulating a large chart)
        // Give them same class to trigger caching
        for (let i = 0; i < 5000; i++) {
            const child = new MockElement('path');
            child.setAttribute('class', 'chart-layer');
            root.appendChild(child);
            targetRoot.appendChild(new MockElement('path'));
        }

        const start = performance.now();
        inlineStyles(root, targetRoot);
        const end = performance.now();
        const duration = end - start;

        console.log(`Processed 5000 elements in ${duration.toFixed(2)}ms`);
        console.log(`getComputedStyle calls: ${mockGetComputedStyle.mock.calls.length}`);

        // Should be called ONCE for the root, and ONCE for the first child.
        // Total 2 calls (plus maybe some overhead).
        // Definitely less than 5000.
        expect(mockGetComputedStyle).toHaveBeenCalledTimes(2);
    });
});
