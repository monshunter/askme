const MAX_WIKI_FILES = 32;

export function repositoryWriteReserve(maxToolCalls) {
  if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1) throw new Error("maxToolCalls must be a positive integer");
  return Math.min(maxToolCalls, MAX_WIKI_FILES, Math.max(10, Math.ceil(maxToolCalls * 0.4)));
}

export function repositorySourceToolLimit(maxToolCalls) {
  return maxToolCalls - repositoryWriteReserve(maxToolCalls);
}

export function repositoryHardSourceToolLimit(maxToolCalls) {
  return Math.max(repositorySourceToolLimit(maxToolCalls), maxToolCalls - Math.min(maxToolCalls, 20));
}

export function repositorySourceRoundLimit(maxRounds) {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error("maxRounds must be a positive integer");
  const writeReserve = Math.min(maxRounds, Math.max(10, Math.ceil(maxRounds * 0.2)));
  return maxRounds - writeReserve;
}

export function repositoryHardSourceRoundLimit(maxRounds) {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error("maxRounds must be a positive integer");
  const hardWriteReserve = Math.min(maxRounds, Math.max(6, Math.ceil(maxRounds * 0.1)));
  return Math.max(repositorySourceRoundLimit(maxRounds), maxRounds - hardWriteReserve);
}

export function repositorySourceToolsShouldLock(input) {
  const covered = input.examinedPathCount >= input.minimumExaminedPaths;
  return input.toolCalls >= repositoryHardSourceToolLimit(input.maxToolCalls)
    || input.rounds >= repositoryHardSourceRoundLimit(input.maxRounds)
    || (covered && (input.toolCalls >= repositorySourceToolLimit(input.maxToolCalls)
      || input.rounds >= repositorySourceRoundLimit(input.maxRounds)));
}
