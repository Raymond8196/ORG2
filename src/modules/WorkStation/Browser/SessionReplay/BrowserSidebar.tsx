/**
 * BrowserSidebar Component
 *
 * Left sidebar for one browser session replay category.
 * Uses PrimarySidebarLayoutWithSections with hidden tabs so the top ReplayTabBar
 * owns category switching.
 */
import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Chrome from "@hugeicons/core-free-icons/ChromeIcon";
import Compass from "@hugeicons/core-free-icons/CompassIcon";
import MousePointerClick from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import FileSymlink from "@hugeicons/core-free-icons/FileSymlinkIcon";
import ListTree from "@hugeicons/core-free-icons/HierarchyFilesIcon";
import Keyboard from "@hugeicons/core-free-icons/KeyboardIcon";
import List from "@hugeicons/core-free-icons/ListViewIcon";
import MoveVertical from "@hugeicons/core-free-icons/MoveTopIcon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import ShieldOff from "@hugeicons/core-free-icons/Shield02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React, { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FaviconIcon } from "@src/components/FaviconIcon";
import { Placeholder } from "@src/components/Placeholder";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import { getEventIcon } from "@src/config/toolIcons";
import { AGENT_DOT_TOKENS } from "@src/engines/Simulator/config";
import { PANEL_CONSTANTS } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/config";
import { PrimarySidebarLayoutWithSections } from "@src/modules/WorkStation/shared";
import type { PrimarySidebarTab } from "@src/modules/WorkStation/shared/PrimarySidebarLayout/PrimarySidebarLayoutWithSections";
import { getSiteNameFromUrl } from "@src/store/ui/navigationSidebarTabsAtom";
import { isPlaceholderBrowserSessionTitle } from "@src/store/workstation/browser/tabs";
import { deriveToolAction } from "@src/util/ui/rendering/toolAction";

import {
  type EntryCategory,
  categorizeBrowserEntry,
  getNativeEntryDisplayName,
} from "./entryUtils";
import type {
  BrowserEntry,
  InternalBrowserAction,
  InternalBrowserEntry,
} from "./types";

export type BrowserReplaySidebarCategory = "agent_browser" | "search_fetch";

interface BrowserSidebarProps {
  category: BrowserReplaySidebarCategory;
  entries: BrowserEntry[];
  internalBrowserEntries?: InternalBrowserEntry[];
  activeEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}

const INITIAL_VISIBLE_ROWS = 120;
const VISIBLE_ROW_INCREMENT = 120;

function getWindowedRows<T extends { entryId: string }>(
  entries: T[],
  activeEntryId: string | null,
  visibleCount: number
): T[] {
  if (entries.length <= visibleCount) return entries;

  const activeIndex = activeEntryId
    ? entries.findIndex((entry) => entry.entryId === activeEntryId)
    : -1;
  if (activeIndex < 0 || activeIndex < visibleCount) {
    return entries.slice(0, visibleCount);
  }

  const prefixCount = Math.max(0, visibleCount - 1);
  return [...entries.slice(0, prefixCount), entries[activeIndex]];
}

// ============================================
// Native Browser Action Icons
// ============================================

function getNativeActionIcon(
  action: InternalBrowserAction,
  isActive: boolean
): React.ReactNode {
  const color = isActive ? "text-primary-6" : "text-text-3";
  const size = 14;
  const stroke = 1.75;

  switch (action) {
    case "list":
      return (
        <HugeiconsIcon
          icon={ListTree}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "is_ready":
      return (
        <HugeiconsIcon
          icon={CheckCircle2}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "get_state":
      return (
        <HugeiconsIcon
          icon={ListTree}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "click":
      return (
        <HugeiconsIcon
          icon={MousePointerClick}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "input":
      return (
        <HugeiconsIcon
          icon={Keyboard}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "select":
      return (
        <HugeiconsIcon
          icon={List}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "scroll":
      return (
        <HugeiconsIcon
          icon={MoveVertical}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "show_mask":
      return (
        <HugeiconsIcon
          icon={Shield}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "hide_mask":
      return (
        <HugeiconsIcon
          icon={ShieldOff}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    case "clean_up":
      return (
        <HugeiconsIcon
          icon={Trash2}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
    default:
      return (
        <HugeiconsIcon
          icon={ListTree}
          size={size}
          strokeWidth={stroke}
          className={color}
        />
      );
  }
}

function getCategoryIcon(
  category: EntryCategory,
  isActive: boolean,
  entry?: BrowserEntry
): React.ReactNode {
  const color = isActive ? "text-primary-6" : "text-text-3";
  if (category === "web_search")
    return (
      <HugeiconsIcon
        icon={Search}
        size={14}
        strokeWidth={1.75}
        className={color}
      />
    );
  if (category === "browser" && entry) {
    const action = deriveToolAction(
      entry.event.functionName,
      entry.event.args as Record<string, unknown> | undefined
    );
    return getEventIcon(entry.event.functionName, {
      action,
      size: 14,
      className: color,
    });
  }
  if (category === "browser")
    return (
      <HugeiconsIcon
        icon={Chrome}
        size={14}
        strokeWidth={1.75}
        className={color}
      />
    );
  return (
    <HugeiconsIcon
      icon={FileSymlink}
      size={14}
      strokeWidth={1.75}
      className={color}
    />
  );
}

interface EntryListProps {
  entries: BrowserEntry[];
  activeEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
  category: EntryCategory;
  emptyMessage: string;
}

const EntryList: React.FC<EntryListProps> = ({
  entries,
  activeEntryId,
  onSelectEntry,
  category,
  emptyMessage,
}) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  const visibleEntries = useMemo(
    () => getWindowedRows(entries, activeEntryId, visibleCount),
    [entries, activeEntryId, visibleCount]
  );

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={emptyMessage}
          fillParentHeight
        />
      </div>
    );
  }

  const hiddenCount = Math.max(0, entries.length - visibleEntries.length);

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto">
      {visibleEntries.map((entry) => {
        const isActive = entry.entryId === activeEntryId;
        const title =
          entry.title && !isPlaceholderBrowserSessionTitle(entry.title)
            ? entry.title
            : getSiteNameFromUrl(entry.url);
        const displayName = entry.subtitle
          ? `${title} · ${entry.subtitle}`
          : title;

        const useFavicon = category === "web_fetch";
        const icon = useFavicon ? (
          <FaviconIcon
            url={entry.url}
            isSelected={isActive}
            fallbackColor="text-text-3"
          />
        ) : (
          getCategoryIcon(category, isActive, entry)
        );

        const node: TreeRowNode = {
          id: entry.entryId,
          name: displayName,
          path: entry.subtitle || entry.url,
          type: "file",
          icon,
        };

        return (
          <TreeRowBase
            key={entry.entryId}
            node={node}
            depth={0}
            isSelected={isActive}
            onClick={() => onSelectEntry(entry.entryId)}
            showIndentGuides={false}
          >
            {entry.isCurrent && (
              <div className={AGENT_DOT_TOKENS.container}>
                <div className={AGENT_DOT_TOKENS.dot} />
              </div>
            )}
          </TreeRowBase>
        );
      })}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mx-2 my-2 rounded-md border border-border-2 px-2 py-1 text-xs text-text-3 hover:bg-bg-2 hover:text-text-1"
          onClick={() =>
            setVisibleCount((count) => count + VISIBLE_ROW_INCREMENT)
          }
        >
          +{Math.min(hiddenCount, VISIBLE_ROW_INCREMENT)}
        </button>
      ) : null}
    </div>
  );
};

// ============================================
// Native Browser Entry List
// ============================================

interface NativeEntryListProps {
  entries: InternalBrowserEntry[];
  activeEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
  emptyMessage: string;
}

const NativeEntryList: React.FC<NativeEntryListProps> = ({
  entries,
  activeEntryId,
  onSelectEntry,
  emptyMessage,
}) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  const visibleEntries = useMemo(
    () => getWindowedRows(entries, activeEntryId, visibleCount),
    [entries, activeEntryId, visibleCount]
  );

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={emptyMessage}
          fillParentHeight
        />
      </div>
    );
  }

  const hiddenCount = Math.max(0, entries.length - visibleEntries.length);

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto">
      {visibleEntries.map((entry) => {
        const isActive = entry.entryId === activeEntryId;
        const displayName = getNativeEntryDisplayName(entry);
        const icon = getNativeActionIcon(entry.action, isActive);

        const node: TreeRowNode = {
          id: entry.entryId,
          name: displayName,
          path: entry.webviewLabel,
          type: "file",
          icon,
        };

        return (
          <TreeRowBase
            key={entry.entryId}
            node={node}
            depth={0}
            isSelected={isActive}
            onClick={() => onSelectEntry(entry.entryId)}
            showIndentGuides={false}
          >
            {entry.isCurrent && (
              <div className={AGENT_DOT_TOKENS.container}>
                <div className={AGENT_DOT_TOKENS.dot} />
              </div>
            )}
          </TreeRowBase>
        );
      })}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mx-2 my-2 rounded-md border border-border-2 px-2 py-1 text-xs text-text-3 hover:bg-bg-2 hover:text-text-1"
          onClick={() =>
            setVisibleCount((count) => count + VISIBLE_ROW_INCREMENT)
          }
        >
          +{Math.min(hiddenCount, VISIBLE_ROW_INCREMENT)}
        </button>
      ) : null}
    </div>
  );
};

// ============================================
// Main Sidebar Component
// ============================================

const BrowserSidebarComponent: React.FC<BrowserSidebarProps> = ({
  category,
  entries,
  internalBrowserEntries = [],
  activeEntryId,
  onSelectEntry,
}) => {
  const { t } = useTranslation("sessions");

  const grouped = useMemo(() => {
    const groups: Record<
      Exclude<EntryCategory, "internal_browser">,
      BrowserEntry[]
    > = {
      browser: [],
      web_search: [],
      web_fetch: [],
    };
    for (const entry of entries) {
      groups[
        categorizeBrowserEntry(entry) as Exclude<
          EntryCategory,
          "internal_browser"
        >
      ].push(entry);
    }
    return groups;
  }, [entries]);

  const tabs: PrimarySidebarTab[] = useMemo(() => {
    if (category === "agent_browser") {
      return [
        {
          key: "agent_browser",
          label: t("simulator.replay.browser.tabs.agentBrowser"),
          icon: (
            <HugeiconsIcon
              icon={Compass}
              size={PANEL_CONSTANTS.TAB_ICON_SIZE}
            />
          ),
          sections: [
            {
              key: "browser-entries",
              title: t("simulator.replay.browser.sections.browserTitle"),
              content: (
                <EntryList
                  entries={grouped.browser}
                  activeEntryId={activeEntryId}
                  onSelectEntry={onSelectEntry}
                  category="browser"
                  emptyMessage={t(
                    "simulator.replay.browser.empty.noBrowserActivity"
                  )}
                />
              ),
              defaultFlexGrow: 1,
              resizable: false,
            },
            {
              key: "native-entries",
              title: t("simulator.replay.browser.sections.interactionsTitle"),
              content: (
                <NativeEntryList
                  entries={internalBrowserEntries}
                  activeEntryId={activeEntryId}
                  onSelectEntry={onSelectEntry}
                  emptyMessage={t(
                    "simulator.replay.browser.empty.noBrowserInteractions"
                  )}
                />
              ),
              defaultFlexGrow: 1,
              resizable: false,
            },
          ],
        },
      ];
    }

    return [
      {
        key: "search_fetch",
        label: t("simulator.replay.browser.tabs.searchFetch"),
        icon: (
          <HugeiconsIcon icon={Search} size={PANEL_CONSTANTS.TAB_ICON_SIZE} />
        ),
        sections: [
          {
            key: "search-entries",
            title: t("simulator.replay.browser.sections.webSearchesTitle"),
            content: (
              <EntryList
                entries={grouped.web_search}
                activeEntryId={activeEntryId}
                onSelectEntry={onSelectEntry}
                category="web_search"
                emptyMessage={t("simulator.replay.browser.empty.noWebSearches")}
              />
            ),
            defaultFlexGrow: 1,
            resizable: false,
          },
          {
            key: "fetch-entries",
            title: t("simulator.replay.browser.sections.pagesFetchedTitle"),
            content: (
              <EntryList
                entries={grouped.web_fetch}
                activeEntryId={activeEntryId}
                onSelectEntry={onSelectEntry}
                category="web_fetch"
                emptyMessage={t(
                  "simulator.replay.browser.empty.noPagesFetched"
                )}
              />
            ),
            defaultFlexGrow: 1,
            resizable: false,
          },
        ],
      },
    ];
  }, [
    category,
    grouped.browser,
    grouped.web_fetch,
    grouped.web_search,
    internalBrowserEntries,
    activeEntryId,
    onSelectEntry,
    t,
  ]);

  return (
    <PrimarySidebarLayoutWithSections
      tabs={tabs}
      activeTab={category}
      onTabChange={() => {}}
      tabIconOnly={true}
      hideTabs
    />
  );
};

export const BrowserSidebar = memo(BrowserSidebarComponent);
BrowserSidebar.displayName = "BrowserSidebar";

export default BrowserSidebar;
