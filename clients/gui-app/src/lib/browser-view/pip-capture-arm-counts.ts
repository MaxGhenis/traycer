let pipHeadlessArmRunsForTests = 0;

export function getPipHeadlessArmRunsForTests(): number {
  return pipHeadlessArmRunsForTests;
}

export function resetPipCaptureArmCountsForTests(): void {
  pipHeadlessArmRunsForTests = 0;
}

export function incrementPipHeadlessArmRunsForTests(): void {
  pipHeadlessArmRunsForTests += 1;
}
