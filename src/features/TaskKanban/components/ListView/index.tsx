import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { KanbanTask } from "@src/features/KanbanBoard";
import {
  Placeholder,
  SessionTable,
  mapKanbanTaskToSessionTableItem,
} from "@src/modules/shared/layouts/blocks";
import { toIntlLocaleTag } from "@src/util/data/formatters/date";

import { getColumnTitleKey } from "../../config";

function getTaskTimestamp(task: KanbanTask): number {
  const timestamp = task.updated_at || task.created_at;
  if (!timestamp) return 0;
  return new Date(timestamp).getTime();
}

export interface ListViewProps {
  tasks: KanbanTask[];
  selectedTaskId: string | null;
  detailPanelVisible: boolean;
  onTaskClick: (task: KanbanTask) => void;
}

const ListView: React.FC<ListViewProps> = ({
  tasks,
  selectedTaskId,
  detailPanelVisible,
  onTaskClick,
}) => {
  const { t, i18n } = useTranslation(["sessions", "common"]);
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => getTaskTimestamp(b) - getTaskTimestamp(a)),
    [tasks]
  );
  const dateTimeLabelOptions = useMemo(
    () => ({
      todayLabel: t("common:relativeDate.today"),
      yesterdayLabel: t("common:relativeDate.yesterday"),
      locale: toIntlLocaleTag(i18n.resolvedLanguage),
    }),
    [i18n.resolvedLanguage, t]
  );
  const sessionTableItems = useMemo(
    () =>
      sortedTasks.map((task) =>
        mapKanbanTaskToSessionTableItem({
          task,
          active: task.id === selectedTaskId && detailPanelVisible,
          statusLabel: t(`sessions:${getColumnTitleKey(task.status)}`),
          dateTimeLabelOptions,
        })
      ),
    [dateTimeLabelOptions, detailPanelVisible, selectedTaskId, sortedTasks, t]
  );

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {sortedTasks.length === 0 ? (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("sessions:kanban.list.emptyTitle")}
          subtitle={t("sessions:kanban.list.emptyDescription")}
        />
      ) : (
        <SessionTable
          items={sessionTableItems}
          className="[&_.table-fixed-header]:scrollbar-hide [&_.table-scroll]:scrollbar-hide"
          onSelect={(item) => {
            const task = sortedTasks.find(
              (candidate) => candidate.id === item.id
            );
            if (task) {
              onTaskClick(task);
            }
          }}
          fillHeight
          showSearch
        />
      )}
    </div>
  );
};

export default ListView;
