export function shouldShowMainChatComposer({
  showInteractArea,
  isReadOnlySurface,
  hasCloudDownloadSurface,
}: {
  showInteractArea: boolean;
  isReadOnlySurface: boolean;
  hasCloudDownloadSurface: boolean;
}): boolean {
  return showInteractArea && !isReadOnlySurface && !hasCloudDownloadSurface;
}

export function shouldShowExternalHistoryForkComposer({
  isImportedHistory,
  readOnly,
  canContinueInOrgii,
  hasCloudDownloadSurface,
}: {
  isImportedHistory: boolean;
  readOnly: boolean;
  canContinueInOrgii: boolean;
  hasCloudDownloadSurface: boolean;
}): boolean {
  return (
    !hasCloudDownloadSurface &&
    isImportedHistory &&
    !readOnly &&
    canContinueInOrgii
  );
}
