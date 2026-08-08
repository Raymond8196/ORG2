import { emit } from "@tauri-apps/api/event";
import { ListTree, Plus } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { type WorkItemData, projectApi } from "@src/api/http/project";
import {
  allocateCloudAwareStandaloneWorkItemId,
  allocateCloudAwareWorkItemId,
} from "@src/features/Org2Cloud/cloudShortId";
import { createLogger } from "@src/hooks/logger";
import { useProjectDataChanged } from "@src/hooks/project";

const logger = createLogger("WorkItemSubItems");

interface WorkItemFamily {
  children: WorkItemData[];
  parent: WorkItemData | null;
}

/**
 * Children and parent of one work item, resolved from the item's own
 * scope (project slug or standalone org) via `frontmatter.parent`
 * linkage, refreshed on every `orgii-data-changed` signal so CLI writes
 * from agent shells appear live.
 */
export function useWorkItemFamily(
  shortId: string,
  projectSlug?: string | null,
  orgId?: string | null
): WorkItemFamily {
  const [family, setFamily] = useState<WorkItemFamily>({
    children: [],
    parent: null,
  });

  const refresh = useCallback(() => {
    const read = projectSlug
      ? projectApi.readWorkItems(projectSlug)
      : projectApi.readStandaloneWorkItems(orgId ? { orgId } : undefined);
    read
      .then((items) => {
        const children = items.filter(
          (item) =>
            item.frontmatter.parent === shortId && !item.frontmatter.deleted_at
        );
        const ownParentId = items.find(
          (item) => item.frontmatter.short_id === shortId
        )?.frontmatter.parent;
        const parent = ownParentId
          ? (items.find((item) => item.frontmatter.short_id === ownParentId) ??
            null)
          : null;
        setFamily({ children, parent });
      })
      .catch(() => {
        setFamily({ children: [], parent: null });
      });
  }, [shortId, projectSlug, orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useProjectDataChanged(refresh);

  return family;
}

const DONE_SUB_ITEM_STATUSES = new Set(["completed", "cancelled", "done"]);

interface WorkItemSubItemsProps {
  family: WorkItemFamily;
  parentShortId: string;
  projectSlug?: string | null;
  orgId?: string | null;
  onOpenWorkItem?: (item: WorkItemData) => void;
}

const WorkItemSubItems: React.FC<WorkItemSubItemsProps> = ({
  family,
  parentShortId,
  projectSlug,
  orgId,
  onOpenWorkItem,
}) => {
  const { t } = useTranslation(["projects"]);
  const { children, parent } = family;
  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const doneCount = children.filter((child) =>
    DONE_SUB_ITEM_STATUSES.has(child.frontmatter.status)
  ).length;

  const handleCreateSubItem = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title || creating || !parentShortId) return;
    setCreating(true);
    try {
      if (projectSlug) {
        const shortId = await allocateCloudAwareWorkItemId(projectSlug);
        await projectApi.createWorkItem(projectSlug, shortId, {
          title,
          parent: parentShortId,
          status: "planned",
        });
      } else {
        const shortId = await allocateCloudAwareStandaloneWorkItemId(
          orgId ?? undefined
        );
        await projectApi.createStandaloneWorkItem(
          shortId,
          { title, parent: parentShortId, status: "planned" },
          orgId ? { orgId } : undefined
        );
      }
      setDraftTitle("");
      setAdding(false);
      await emit("orgii-data-changed", {
        work_item_id: parentShortId,
        project_slug: projectSlug || undefined,
        source: "sub-item-quick-add",
      });
    } catch (error) {
      logger.error("Failed to create sub item", error);
    } finally {
      setCreating(false);
    }
  }, [creating, draftTitle, orgId, parentShortId, projectSlug]);

  if (!parentShortId) return null;

  return (
    <div
      className="shrink-0 border-t border-border-1 px-4 py-2"
      data-testid="work-item-sub-items"
    >
      <div className="flex items-center gap-2 py-1">
        <ListTree size={13} className="text-text-4" />
        <span className="text-[12px] font-medium text-text-2">
          {t("workItems.subItems.title")}
        </span>
        {children.length > 0 && (
          <span className="rounded-full bg-fill-2 px-1.5 py-px text-[10px] font-medium text-text-3">
            {doneCount}/{children.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {parent && (
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
              onClick={() => onOpenWorkItem?.(parent)}
              data-testid="work-item-parent-link"
            >
              {t("workItems.subItems.parent")}: {parent.frontmatter.short_id}
            </button>
          )}
          <button
            type="button"
            className="flex cursor-pointer items-center rounded-md p-1 text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setAdding((current) => !current)}
            aria-label={t("workItems.subItems.add", {
              defaultValue: "Add sub-item",
            })}
            data-testid="work-item-sub-item-add"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      {children.length > 0 && (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {children.map((child) => (
            <button
              type="button"
              key={child.frontmatter.short_id}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-fill-2"
              onClick={() => onOpenWorkItem?.(child)}
              data-testid={`work-item-sub-item-${child.frontmatter.short_id}`}
            >
              <span className="shrink-0 rounded bg-fill-2 px-1.5 py-px font-mono text-[10px] text-text-3">
                {child.frontmatter.short_id}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-text-1">
                {child.frontmatter.title}
              </span>
              <span className="shrink-0 rounded-full bg-fill-2 px-2 py-px text-[10px] text-text-3">
                {child.frontmatter.status}
              </span>
            </button>
          ))}
        </div>
      )}
      {children.length === 0 && !adding && (
        <button
          type="button"
          className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[12px] text-text-4 transition-colors hover:bg-fill-2 hover:text-text-2"
          onClick={() => setAdding(true)}
          data-testid="work-item-sub-items-empty-add"
        >
          {t("workItems.subItems.emptyAdd", {
            defaultValue: "+ Add sub-items",
          })}
        </button>
      )}
      {adding && (
        <input
          autoFocus
          value={draftTitle}
          disabled={creating}
          placeholder={t("workItems.subItems.titlePlaceholder", {
            defaultValue: "Sub-item title, press Enter to create",
          })}
          className="mt-1 w-full rounded-md border border-border-1 bg-bg-1 px-2 py-1.5 text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-primary-6"
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={() => {
            if (!creating) setAdding(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleCreateSubItem();
            if (event.key === "Escape") {
              setAdding(false);
              setDraftTitle("");
            }
          }}
          data-testid="work-item-sub-item-title-input"
        />
      )}
    </div>
  );
};

export default WorkItemSubItems;
