# .archive

Code parked out of the live build but kept in-tree (and in git history). Excluded from `tsconfig.json` (`exclude: [".archive"]`), so nothing here is type-checked or bundled. Paths mirror their original `src/` location, so restoring is a reverse `git mv`.

## WorkStation Database app — archived 2026-07-14

The WorkStation "Database" app (the **Data** dock app, its tab types, renderers, and the `DatabaseManager` module) was removed from the live WorkStation. See `docs/workstation-unification/phase-2-host-hoist-plan.md` for the broader unification effort this is part of.

**What moved here (self-contained to the app):**

- `src/modules/WorkStation/DatabaseManager/` — the whole host module
- `src/hooks/database/` — its hooks (`useSqliteDatabase`, `usePendingChanges`, `useQueryHistory`, `useDatabaseConnections`)
- `src/store/workstation/tabs/factories/database.ts` — db tab factories/creators
- `src/modules/WorkStation/TabContent/renderers/{table,query,schema,addConnection}.tsx` — the (placeholder) unified renderers
- `src/modules/WorkStation/shared/StatusBar/DatabaseStatusBar.tsx`

**What deliberately stayed live (shared with other features):**

- `src/engines/DatabaseCore/` and `src/store/workstation/database/` — used by MainApp → Integrations → Databases, the CodeMirror SQL editor, and the Code Editor's SQLite file preview
- `src/assets/databaseIcons/`, `src/hooks/workStation/database/` (Code Editor `.sqlite` preview)
- Rust: `src-tauri/crates/db-browser` and `crates/db-clients` (the `db_*` / `db_sql_*` Tauri commands) — still invoked by the above. `crates/database` is the app's own persistence and is unrelated.

**Shared files that were edited in place (not moved)** to sever the db branch: AppShell (`AppShellContent`, `index.tsx`, `useAppShellDerivedState`, `useMyStationDockSegments`), tab store (`tabHost`, `tabs/types`, `tabFactory`, `factories/index`, `tabs/index`), `dockFilter/atoms`, `TabContent/registry`, routes (`routeViewModeConfig`, `routeGroups`, router redirect, `componentMapping`), and `StatusBarRenderer` + `shared/StatusBar/index`.

**To restore:** reverse the `git mv`s above, revert the in-place edits (see the archival commit), and remove `.archive` from `tsconfig.json`'s `exclude`.

**Known harmless leftovers (intentional, to limit ripple):** the `db-table`/`db-query`/`db-schema` members of `WorkStationTabCategory` and the `"data"` slot in `StatusBarAppType` remain as unused union members; the `dockFilter.data` i18n key remains in `navigation.json` across locales.
