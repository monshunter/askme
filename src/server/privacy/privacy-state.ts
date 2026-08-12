export type StoredPrivacyConfirmation = { policyRevision: number; confirmedAt: Date };

export function derivePrivacyConfirmation(currentRevision: number, confirmation: StoredPrivacyConfirmation | null) {
  if (confirmation?.policyRevision === currentRevision) {
    return { confirmed: true, requiresReconfirmation: false, policyRevision: currentRevision, confirmedAt: confirmation.confirmedAt };
  }
  return { confirmed: false, requiresReconfirmation: confirmation !== null, policyRevision: currentRevision, confirmedAt: null };
}
