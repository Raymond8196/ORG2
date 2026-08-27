import BriefcaseBusiness from "@hugeicons/core-free-icons/Briefcase02Icon";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import FolderGit2 from "@hugeicons/core-free-icons/FolderGitTwoIcon";
import Inbox from "@hugeicons/core-free-icons/InboxIcon";
import KeyRound from "@hugeicons/core-free-icons/Key02Icon";
import Play from "@hugeicons/core-free-icons/PlayIcon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Eye from "@hugeicons/core-free-icons/ViewIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";
import { useTranslation } from "react-i18next";

import InlineAlert from "@src/components/InlineAlert";
import {
  SECTION_VALUE_SMALL_SECONDARY_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { WizardStepContent } from "@src/scaffold/WizardSystem/primitives";

import { ReadyStepIcon } from "../components/SetupStepIcons";
import type { StepProps } from "./types";

export const ReadyStep: React.FC<StepProps> = ({ controller }) => {
  const { t } = useTranslation("onboarding");
  const team = controller.progress.goal === "team_activity";
  const destination =
    controller.progress.goal === "work_management"
      ? t("readiness.ready.workDestination")
      : team
        ? t("readiness.ready.teamDestination")
        : t("readiness.ready.personalDestination");
  const DestinationIcon =
    controller.progress.goal === "team_activity"
      ? Inbox
      : controller.progress.goal === "work_management"
        ? BriefcaseBusiness
        : Play;
  const readinessItems = [
    {
      key: "tools",
      icon: KeyRound,
      label: controller.progress.tools.some((tool) => tool.found)
        ? t("readiness.ready.toolsReady")
        : t("readiness.ready.toolsLater"),
    },
    {
      key: "workspace",
      icon: FolderGit2,
      label: controller.workspaceFolders.length
        ? t("readiness.ready.workspaceReady")
        : t("readiness.ready.workspaceLater"),
    },
    ...(team
      ? [
          {
            key: "organization",
            icon: Building2,
            label: controller.progress.selectedOrgName ?? "",
          },
          {
            key: "visibility",
            icon: Eye,
            label: t(
              controller.progress.selectedOrgRole === "member"
                ? "readiness.ready.memberSyncReady"
                : "readiness.ready.teamPolicyReady"
            ),
          },
        ]
      : []),
  ];
  return (
    <WizardStepContent
      title={t("readiness.ready.title")}
      description={t("readiness.ready.description")}
      icon={ReadyStepIcon}
    >
      <SectionContainer>
        {readinessItems.map(({ key, icon: Icon, label }) => (
          <SectionRow key={key} showHeader={false}>
            <div className="flex w-full min-w-0 items-center gap-2.5">
              <Icon size={14} className="flex-shrink-0 text-text-2" />
              <span
                className={`min-w-0 flex-1 ${SECTION_VALUE_SMALL_SECONDARY_CLASSES}`}
              >
                {label}
              </span>
              <HugeiconsIcon
                icon={Check}
                size={14}
                className="flex-shrink-0 text-success-6"
                aria-hidden
              />
            </div>
          </SectionRow>
        ))}
      </SectionContainer>
      <InlineAlert
        type="info"
        title={destination}
        icon={<DestinationIcon size={14} className="flex-shrink-0" />}
      >
        {t(
          team
            ? "readiness.ready.teamDestinationHint"
            : "readiness.ready.destinationHint"
        )}
      </InlineAlert>
    </WizardStepContent>
  );
};
