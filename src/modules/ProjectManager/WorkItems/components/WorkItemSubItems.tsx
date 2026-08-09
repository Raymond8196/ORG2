import { emit } from "@tauri-apps/api/event";
import { ListTree, Plus } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type WorkItemData, projectApi } from "@src/api/http/project";
import Select, { type SelectOption } from "@src/components/Select";
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

interface SubItemStageGroup {
  key: string;
  /** Group header label; null when the set has no staged items at all. */
  label: string | null;
  items: WorkItemData[];
}

/**
 * Stage grouping: headers appear only when at least one
 * child carries a stage; staged groups sort ascending with unstaged
 * children trailing under "NO STAGE".
 */
export function groupSubItemsByStage(
  children: WorkItemData[]
): SubItemStageGroup[] {
  const anyStaged = children.some(
    (child) => child.frontmatter.stage !== undefined
  );
  if (!anyStaged) {
    return [{ key: "all", label: null, items: children }];
  }
  const byStage = new Map<number, WorkItemData[]>();
  const unstaged: WorkItemData[] = [];
  for (const child of children) {
    const stage = child.frontmatter.stage;
    if (stage === undefined) {
      unstaged.push(child);
      continue;
    }
    const bucket = byStage.get(stage) ?? [];
    bucket.push(child);
    byStage.set(stage, bucket);
  }
  const groups: SubItemStageGroup[] = [...byStage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stage, items]) => ({
      key: `stage-${stage}`,
      label: `Stage ${stage}`,
      items,
    }));
  if (unstaged.length > 0) {
    groups.push({ key: "no-stage", label: "No stage", items: unstaged });
  }
  return groups;
}

/**
 * Keep quick-add compact while making every existing stage and the next
 * sequential stage directly selectable. Filling gaps keeps recovery from a
 * deleted or moved stage possible without requiring a separate editor.
 */
export function getSubItemStageNumbers(children: WorkItemData[]): number[] {
  const maxStage = children.reduce(
    (max, child) => Math.max(max, child.frontmatter.stage ?? 0),
    0
  );
  return Array.from({ length: Math.max(1, maxStage + 1) }, (_, index) =>
    Number(index + 1)
  );
}

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
  const [draftStage, setDraftStage] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const stageOptions = useMemo<SelectOption[]>(
    () => [
      {
        label: t("workItems.subItems.noStage", { defaultValue: "No stage" }),
        value: "none",
      },
      ...getSubItemStageNumbers(children).map((stage) => ({
        label: t("workItems.subItems.stage", {
          defaultValue: "Stage {{stage}}",
          stage,
        }),
        value: stage,
      })),
    ],
    [children, t]
  );

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
          stage: draftStage ?? undefined,
          status: "planned",
        });
      } else {
        const shortId = await allocateCloudAwareStandaloneWorkItemId(
          orgId ?? undefined
        );
        await projectApi.createStandaloneWorkItem(
          shortId,
          {
            title,
            parent: parentShortId,
            stage: draftStage ?? undefined,
            status: "planned",
          },
          orgId ? { orgId } : undefined
        );
      }
      setDraftTitle("");
      setDraftStage(null);
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
  }, [creating, draftStage, draftTitle, orgId, parentShortId, projectSlug]);

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
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {groupSubItemsByStage(children).map((group) => (
            <React.Fragment key={group.key}>
              {group.label && (
                <div className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-text-4">
                  {group.label}
                </div>
              )}
              {group.items.map((child) => (
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
            </React.Fragment>
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
        <div className="mt-1 flex items-center gap-1">
          <input
            autoFocus
            value={draftTitle}
            disabled={creating}
            placeholder={t("workItems.subItems.titlePlaceholder", {
              defaultValue: "Sub-item title, press Enter to create",
            })}
            className="min-w-0 flex-1 rounded-md border border-border-1 bg-bg-1 px-2 py-1.5 text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-primary-6"
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreateSubItem();
              if (event.key === "Escape") {
                setAdding(false);
                setDraftTitle("");
                setDraftStage(null);
              }
            }}
            data-testid="work-item-sub-item-title-input"
          />
          <div className="w-24 shrink-0">
            <Select
              value={draftStage ?? "none"}
              options={stageOptions}
              disabled={creating}
              size="mini"
              radius="md"
              dropdownWidthMode="auto"
              className="w-full"
              ariaLabel={t("workItems.subItems.stagePicker", {
                defaultValue: "Sub-item stage",
              })}
              dataTestId="work-item-sub-item-stage-select"
              onChange={(value) => {
                if (Array.isArray(value)) return;
                setDraftStage(value === "none" ? null : Number(value));
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkItemSubItems;
