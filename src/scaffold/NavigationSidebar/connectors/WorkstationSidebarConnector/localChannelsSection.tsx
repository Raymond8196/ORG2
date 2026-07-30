/**
 * Local-scope "Channels" sidebar section — the this-machine counterpart of
 * the cloud `channelsSection.tsx`. Rendered only while NO cloud org scope is
 * active (`enabled`); data comes straight from the persisted
 * `localChannelsAtom` (synchronous, so there are no loading/error phases),
 * row/section assembly lives in the pure `localChannelsSection.menuItems.ts`
 * sibling, and this hook owns which dialog is open for which channel. The
 * four local dialogs are mounted exactly once via the returned
 * `localChannelsDialogs` node (rendered inside `SidebarDialogs`, the
 * `cloudChannelsDialogs` precedent).
 *
 * Row overflow uses the native Tauri context menu like the cloud section
 * (same `MenuItem` API limitation: no destructive styling for "Delete
 * channel"). No role gating — a local channel's single user can always open
 * settings, archive, and delete.
 */
import { MenuItem, Menu as TauriMenu } from "@tauri-apps/api/menu";
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import ArchiveLocalChannelDialog from "@src/features/LocalChannels/components/ArchiveLocalChannelDialog";
import CreateLocalChannelDialog from "@src/features/LocalChannels/components/CreateLocalChannelDialog";
import DeleteLocalChannelDialog from "@src/features/LocalChannels/components/DeleteLocalChannelDialog";
import LocalChannelSettingsDialog from "@src/features/LocalChannels/components/LocalChannelSettingsDialog";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import {
  type LocalChannel,
  activeLocalChannelsAtom,
  archivedLocalChannelsAtom,
  unarchiveLocalChannelAtom,
} from "@src/store/ui/localChannelsAtom";

import {
  LOCAL_CHANNELS_EMPTY_ID,
  buildLocalChannelsMenuItems,
  isLocalChannelsMenuItemId,
} from "./localChannelsSection.menuItems";

type LocalChannelsDialogState =
  | { kind: "create" }
  | { kind: "settings"; channel: LocalChannel }
  | { kind: "archive"; channel: LocalChannel }
  | { kind: "delete"; channel: LocalChannel };

export interface UseLocalChannelsSectionParams {
  /** True only while the sidebar is in the local (no cloud org) scope. */
  enabled: boolean;
}

export interface UseLocalChannelsSectionResult {
  /** Separator + channel rows; empty while a cloud org scope is active. */
  localChannelsMenuItems: NavigationMenuItem[];
  /**
   * Click resolver for the section's rows. Swallows channel-row clicks (no
   * navigation target exists in this slice); the ready-and-empty "Create a
   * channel" row opens the create dialog.
   */
  handleLocalChannelsItemClick: (item: NavigationMenuItem) => boolean;
  /** The four local channel dialogs — render once next to the sidebar. */
  localChannelsDialogs: React.ReactNode;
}

export function useLocalChannelsSection({
  enabled,
}: UseLocalChannelsSectionParams): UseLocalChannelsSectionResult {
  const { t } = useTranslation("navigation");
  const { t: tCommon } = useTranslation("common");
  const channels = useAtomValue(activeLocalChannelsAtom);
  const archivedChannels = useAtomValue(archivedLocalChannelsAtom);
  const unarchiveChannel = useSetAtom(unarchiveLocalChannelAtom);

  const [dialogState, setDialogState] =
    useState<LocalChannelsDialogState | null>(null);
  // A scope switch (cloud org activated) closes any open local dialog.
  const activeDialog = enabled ? dialogState : null;

  const closeDialog = useCallback(() => setDialogState(null), []);
  const openCreateDialog = useCallback(
    () => setDialogState({ kind: "create" }),
    []
  );

  const openChannelActionsMenu = useCallback(
    (channel: LocalChannel) => {
      const entries = [
        {
          text: t("cloud.channels.settings.action"),
          action: () => setDialogState({ kind: "settings", channel }),
        },
        {
          text: t("cloud.channels.archiveAction"),
          action: () => setDialogState({ kind: "archive", channel }),
        },
        {
          text: t("cloud.channels.deleteAction"),
          action: () => setDialogState({ kind: "delete", channel }),
        },
      ];
      void Promise.all(entries.map((entry) => MenuItem.new(entry))).then(
        async (menuItems) => {
          const menu = await TauriMenu.new({ items: menuItems });
          await menu.popup();
        }
      );
    },
    [t]
  );

  const handleUnarchive = useCallback(
    (channel: LocalChannel) => {
      const result = unarchiveChannel(channel.id);
      if (!result.ok) {
        Message.error(
          result.error === "quota"
            ? t("cloud.channels.local.quotaExceeded")
            : t("cloud.channels.unarchiveFailed")
        );
      }
    },
    [t, unarchiveChannel]
  );

  const handleDeleteFromArchived = useCallback((channel: LocalChannel) => {
    setDialogState({ kind: "delete", channel });
  }, []);

  const localChannelsMenuItems = useMemo(
    () =>
      buildLocalChannelsMenuItems({
        enabled,
        channels,
        archivedChannels,
        t,
        tCommon,
        onCreateClick: openCreateDialog,
        onOpenChannelMenu: openChannelActionsMenu,
        onUnarchive: handleUnarchive,
        onDeleteChannel: handleDeleteFromArchived,
      }),
    [
      enabled,
      channels,
      archivedChannels,
      t,
      tCommon,
      openCreateDialog,
      openChannelActionsMenu,
      handleUnarchive,
      handleDeleteFromArchived,
    ]
  );

  const handleLocalChannelsItemClick = useCallback(
    (item: NavigationMenuItem): boolean => {
      if (!isLocalChannelsMenuItemId(item.id)) return false;
      if (item.id === LOCAL_CHANNELS_EMPTY_ID) openCreateDialog();
      // Channel rows have no message surface yet: swallow the click so the
      // sidebar applies no navigation and no selected state.
      return true;
    },
    [openCreateDialog]
  );

  // The settings/archive/delete dialogs are KEYED per open + target: every
  // open is a fresh mount, which seeds/resets their form state without any
  // reset-in-effect (`react-hooks/set-state-in-effect`-safe).
  const settingsChannel =
    activeDialog?.kind === "settings" ? activeDialog.channel : null;
  const archiveChannel =
    activeDialog?.kind === "archive" ? activeDialog.channel : null;
  const deleteChannel =
    activeDialog?.kind === "delete" ? activeDialog.channel : null;
  const localChannelsDialogs = (
    <>
      <CreateLocalChannelDialog
        open={activeDialog?.kind === "create"}
        onClose={closeDialog}
      />
      <LocalChannelSettingsDialog
        key={settingsChannel ? `settings-${settingsChannel.id}` : "settings"}
        open={settingsChannel !== null}
        channel={settingsChannel}
        onClose={closeDialog}
      />
      <ArchiveLocalChannelDialog
        key={archiveChannel ? `archive-${archiveChannel.id}` : "archive"}
        open={archiveChannel !== null}
        channel={archiveChannel}
        onClose={closeDialog}
      />
      <DeleteLocalChannelDialog
        key={deleteChannel ? `delete-${deleteChannel.id}` : "delete"}
        open={deleteChannel !== null}
        channel={deleteChannel}
        onClose={closeDialog}
      />
    </>
  );

  return {
    localChannelsMenuItems,
    handleLocalChannelsItemClick,
    localChannelsDialogs,
  };
}
