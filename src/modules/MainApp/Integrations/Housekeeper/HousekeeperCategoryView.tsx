import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  type HousekeeperTokenBenchmarkResponse,
  housekeeperHealthCheck,
  housekeeperTokenBenchmark,
} from "@src/api/services/keyValidation";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select/types";
import Switch from "@src/components/Switch";
import {
  WIZARD_IDS,
  buildIntegrationsPath,
  buildWizardPath,
} from "@src/config/mainAppPaths";
import {
  HOUSEKEEPER_DEFAULT_BASE_URL,
  HOUSEKEEPER_DEFAULT_MODEL,
  useHousekeeperConfig,
} from "@src/hooks/housekeeper";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

type HealthState =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "ready" | "error";
      ok: boolean;
      detail: string;
      maxModelLen?: number | null;
    };

type BenchmarkState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ready"; result: HousekeeperTokenBenchmarkResponse }
  | { status: "error"; detail: string };

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border-2 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-1">{title}</div>
        <div className="mt-1 text-xs leading-5 text-text-3">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border-2 bg-fill-1 px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-text-3">
        {icon}
        {label}
      </div>
      <div className="truncate text-sm font-medium text-text-1">{value}</div>
    </div>
  );
}

export const HousekeeperCategoryView: React.FC = () => {
  const { t } = useTranslation("integrations");
  const navigate = useNavigate();
  const config = useHousekeeperConfig();
  const [health, setHealth] = useState<HealthState>({ status: "idle" });
  const [benchmark, setBenchmark] = useState<BenchmarkState>({
    status: "idle",
  });

  const accountOptions = useMemo<SelectOption[]>(
    () => [
      {
        label: t("housekeeper.autoAccount"),
        value: "__auto__",
      },
      ...config.vllmAccounts.map((account) => ({
        label: `${account.name} (${account.baseUrl ?? HOUSEKEEPER_DEFAULT_BASE_URL})`,
        triggerLabel: account.name,
        value: account.id,
      })),
    ],
    [config.vllmAccounts, t]
  );

  const openAddMiniCPMAccount = () => {
    const accountsPath = `${buildIntegrationsPath({
      category: "models",
    })}?modelsTab=my-accounts&localRuntime=vllm_minicpm`;
    navigate(buildWizardPath(accountsPath, WIZARD_IDS.KEY_ADD));
  };

  const runHealthCheck = async () => {
    if (!config.resolvedAccountId) {
      setHealth({
        status: "error",
        ok: false,
        detail: t("housekeeper.health.configureFirst"),
      });
      return;
    }

    setHealth({ status: "checking" });
    try {
      const result = await housekeeperHealthCheck({
        accountId: config.resolvedAccountId,
        model: config.resolvedModel,
      });
      setHealth({
        status: result.ok ? "ready" : "error",
        ok: result.ok,
        detail: result.ok
          ? t("housekeeper.health.connectedTo", {
              baseUrl: result.baseUrl ?? HOUSEKEEPER_DEFAULT_BASE_URL,
            })
          : result.error || t("housekeeper.health.failed"),
        maxModelLen: result.maxModelLen,
      });
    } catch (error) {
      setHealth({
        status: "error",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const runTokenBenchmark = async () => {
    if (!config.resolvedAccountId) {
      setBenchmark({
        status: "error",
        detail: "需要先配置一个 vLLM MiniCPM 账号。",
      });
      return;
    }

    setBenchmark({ status: "running" });
    try {
      const result = await housekeeperTokenBenchmark({
        accountId: config.resolvedAccountId,
        model: config.resolvedModel,
      });
      setBenchmark({ status: "ready", result });
    } catch (error) {
      setBenchmark({
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const healthIcon =
    health.status === "checking" ? (
      <RefreshCcw size={14} className="animate-spin text-primary-6" />
    ) : health.status === "ready" ? (
      <CheckCircle2 size={14} className="text-success-6" />
    ) : health.status === "error" ? (
      <XCircle size={14} className="text-danger-6" />
    ) : (
      <Activity size={14} className="text-text-3" />
    );
  const checkedHealth =
    health.status === "ready" || health.status === "error" ? health : null;
  const benchmarkIcon =
    benchmark.status === "running" ? (
      <RefreshCcw size={14} className="animate-spin text-primary-6" />
    ) : benchmark.status === "ready" ? (
      <Gauge size={14} className="text-success-6" />
    ) : benchmark.status === "error" ? (
      <XCircle size={14} className="text-danger-6" />
    ) : (
      <Gauge size={14} className="text-text-3" />
    );
  const benchmarkSummary =
    benchmark.status === "idle"
      ? "发送一段轻量测试文本，按实际完成耗时计算输出 token/s。"
      : benchmark.status === "running"
        ? "正在请求本地 vLLM MiniCPM 并统计输出速度..."
        : benchmark.status === "ready"
          ? `输出 ${benchmark.result.completionTokens.toLocaleString()} tokens，用时 ${(
              benchmark.result.elapsedMs / 1000
            ).toFixed(2)}s`
          : benchmark.detail;

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
      />
      <ScrollFadeContainer
        className={`scroll-fade-at-top ${DETAIL_PANEL_TOKENS.scrollContentNoTop}`}
      >
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          <div className="flex flex-col gap-4">
            <section className="border-b border-border-2 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-primary-6">
                    <Sparkles size={13} />
                    {t("housekeeper.eyebrow")}
                  </div>
                  <h2 className="text-xl font-semibold leading-7 text-text-1">
                    {t("housekeeper.title")}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-text-3">
                    {t("housekeeper.description")}
                  </p>
                </div>
                <Button
                  variant="primary"
                  icon={<Plus size={15} />}
                  onClick={openAddMiniCPMAccount}
                >
                  {t("housekeeper.addAccount")}
                </Button>
              </div>
            </section>

            <div className="grid gap-3 md:grid-cols-3">
              <InfoTile
                icon={<Bot size={13} />}
                label={t("housekeeper.tiles.model")}
                value={config.resolvedModel || HOUSEKEEPER_DEFAULT_MODEL}
              />
              <InfoTile
                icon={<ExternalLink size={13} />}
                label={t("housekeeper.tiles.endpoint")}
                value={
                  config.resolvedAccount?.baseUrl ??
                  HOUSEKEEPER_DEFAULT_BASE_URL
                }
              />
              <InfoTile
                icon={<ShieldCheck size={13} />}
                label={t("housekeeper.tiles.safeContext")}
                value={`${config.contextLimitTokens.toLocaleString()} tokens`}
              />
            </div>

            <section className="bg-fill-0 rounded-md border border-border-2 px-4">
              <SettingRow
                title={t("housekeeper.settings.enabled.title")}
                description={t("housekeeper.settings.enabled.description")}
              >
                <Switch
                  checked={config.enabled}
                  onChange={(checked) => config.setEnabled(checked)}
                />
              </SettingRow>

              <SettingRow
                title={t("housekeeper.settings.account.title")}
                description={t("housekeeper.settings.account.description")}
              >
                <Select
                  value={config.accountId ?? "__auto__"}
                  options={accountOptions}
                  size="small"
                  dropdownMinWidth={280}
                  onChange={(value) =>
                    config.setAccountId(
                      value === "__auto__" ? null : String(value)
                    )
                  }
                />
              </SettingRow>

              <SettingRow
                title={t("housekeeper.settings.model.title")}
                description={t("housekeeper.settings.model.description")}
              >
                <Input
                  value={config.model}
                  size="small"
                  className="w-72"
                  placeholder={HOUSEKEEPER_DEFAULT_MODEL}
                  onChange={(value) =>
                    config.setModel(value.trim() || HOUSEKEEPER_DEFAULT_MODEL)
                  }
                />
              </SettingRow>

              <SettingRow
                title={t("housekeeper.settings.context.title")}
                description={t("housekeeper.settings.context.description")}
              >
                <Input
                  type="number"
                  value={String(config.contextLimitTokens)}
                  size="small"
                  className="w-32"
                  min={1024}
                  max={32768}
                  onChange={(value) => {
                    const next = Number(value);
                    if (Number.isFinite(next)) {
                      config.setContextLimitTokens(next);
                    }
                  }}
                />
              </SettingRow>
            </section>

            <section className="bg-fill-0 rounded-md border border-border-2 px-4">
              <SettingRow
                title={t("housekeeper.features.promptPolish.title")}
                description={t("housekeeper.features.promptPolish.description")}
              >
                <Switch
                  checked={config.features.promptPolish}
                  disabled={!config.enabled}
                  onChange={(checked) =>
                    config.setFeatures.promptPolish(checked)
                  }
                />
              </SettingRow>
              <SettingRow
                title={t("housekeeper.features.stepExplain.title")}
                description={t("housekeeper.features.stepExplain.description")}
              >
                <Switch
                  checked={config.features.stepExplain}
                  disabled={!config.enabled}
                  onChange={(checked) =>
                    config.setFeatures.stepExplain(checked)
                  }
                />
              </SettingRow>
              <SettingRow
                title={t("housekeeper.features.uiControl.title")}
                description={t("housekeeper.features.uiControl.description")}
              >
                <Switch
                  checked={config.features.uiControl}
                  disabled={!config.enabled}
                  onChange={(checked) => config.setFeatures.uiControl(checked)}
                />
              </SettingRow>
            </section>

            <section className="bg-fill-0 rounded-md border border-border-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-text-1">
                    {healthIcon}
                    {t("housekeeper.health.title")}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-text-3">
                    {health.status === "idle"
                      ? t("housekeeper.health.idle")
                      : health.status === "checking"
                        ? t("housekeeper.health.checking")
                        : health.detail}
                    {checkedHealth?.maxModelLen ? (
                      <span className="ml-2">
                        max_model_len=
                        {checkedHealth.maxModelLen.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  icon={<RefreshCcw size={15} />}
                  loading={health.status === "checking"}
                  onClick={runHealthCheck}
                >
                  {t("housekeeper.health.checkButton")}
                </Button>
              </div>
            </section>

            <section className="bg-fill-0 rounded-md border border-border-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-text-1">
                    {benchmarkIcon}
                    MiniCPM 输出速度
                  </div>
                  <div className="mt-1 text-xs leading-5 text-text-3">
                    {benchmarkSummary}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  icon={<Gauge size={15} />}
                  loading={benchmark.status === "running"}
                  onClick={runTokenBenchmark}
                >
                  测试速度
                </Button>
              </div>

              {benchmark.status === "ready" ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <InfoTile
                    icon={<Gauge size={13} />}
                    label="输出速度"
                    value={`${benchmark.result.tokensPerSecond.toFixed(
                      1
                    )} tokens/s`}
                  />
                  <InfoTile
                    icon={<Activity size={13} />}
                    label="输出 tokens"
                    value={benchmark.result.completionTokens.toLocaleString()}
                  />
                  <InfoTile
                    icon={<Clock3 size={13} />}
                    label="总耗时"
                    value={`${(benchmark.result.elapsedMs / 1000).toFixed(2)}s`}
                  />
                </div>
              ) : null}

              {benchmark.status === "ready" && benchmark.result.sampleText ? (
                <div className="mt-3 rounded-md bg-fill-1 px-3 py-2 text-xs leading-5 text-text-3">
                  {benchmark.result.sampleText}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </ScrollFadeContainer>
    </DetailPanelContainer>
  );
};
