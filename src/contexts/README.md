# State Management Convention

## Zustand vs React Context

### Use **Zustand** for:
- Persistent business state that outlives component trees
- Data that multiple unrelated subtrees need to read/write
- State with complex update logic (not tied to a provider lifecycle)
- Optimistic updates, undo/redo, or derived computed state

**Current Zustand stores:**
| Store | Purpose |
|---|---|
| `analysis-settings-store.ts` | Analysis parameters (viscosity model, T, etc.) |
| `branding-store.ts` | Whitelabel overrides |
| `chart-settings-store.ts` | Chart display preferences |
| `comparison-store.ts` | Multi-experiment comparison selections |
| `experiment-data-store.ts` | Active experiment data and parsed results |
| `license-store.ts` | License state via Rust LicenseEngine (invoke → Rust → result) |
| `log-store.ts` | In-memory log buffer for debug overlay |

---

### Use **React Context** for:
- Session-scoped state that is bound to a provider's async lifecycle
- State that must trigger React re-renders imperatively (auth flows, license checks)
- State that integrates closely with React Suspense, error boundaries, or effects

**Current Contexts:**
| Context | Purpose |
|---|---|
| `ui-mode-context.tsx` | Dark/light theme + locale selection |

---

### Do **not** migrate existing contexts to Zustand.
They are correctly modelled as contexts because they:
1. Have async side-effects at mount/unmount (theme sync)
2. Are consumed only by subtrees wrapped in their provider
3. Carry no data that needs cross-tree sharing or persistence

---

### Anti-patterns to avoid
- ❌ Zustand for ephemeral UI state (open/close, hover) — use `useState`
- ❌ Context for business data shared across pages — use Zustand
- ❌ Nesting Context providers for data that is page-scoped — use Zustand + `useEffect`
