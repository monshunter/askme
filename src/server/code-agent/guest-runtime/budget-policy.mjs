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
