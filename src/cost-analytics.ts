export type CostSummary = {
  window: { from: string; to: string };
  totalRequests: number;
  promptCacheHits: number;
  promptCacheHitRate: number;
  avgCacheSavedPercent: number;
  estimatedTokensSaved: number;
};

export function buildCostSummary(observations: Array<{
  cacheHit?: boolean;
  cacheSavedPercent?: number;
  cachedTokens?: number;
  timestamp: string;
}>): CostSummary {
  const total = observations.length;
  if (total === 0) {
    const now = new Date().toISOString();
    return {
      window: { from: now, to: now },
      totalRequests: 0,
      promptCacheHits: 0,
      promptCacheHitRate: 0,
      avgCacheSavedPercent: 0,
      estimatedTokensSaved: 0,
    };
  }

  const hits = observations.filter((observation) => observation.cacheHit === true).length;
  const savedPcts = observations
    .map((observation) => observation.cacheSavedPercent)
    .filter((value): value is number => typeof value === "number");
  const avgSaved =
    savedPcts.length > 0 ? savedPcts.reduce((left, right) => left + right, 0) / savedPcts.length : 0;
  const tokensSaved = observations
    .map((observation) => observation.cachedTokens ?? 0)
    .reduce((left, right) => left + right, 0);
  const timestamps = observations.map((observation) => observation.timestamp).sort();

  return {
    window: { from: timestamps[0] ?? "", to: timestamps[timestamps.length - 1] ?? "" },
    totalRequests: total,
    promptCacheHits: hits,
    promptCacheHitRate: total > 0 ? hits / total : 0,
    avgCacheSavedPercent: avgSaved,
    estimatedTokensSaved: tokensSaved,
  };
}
