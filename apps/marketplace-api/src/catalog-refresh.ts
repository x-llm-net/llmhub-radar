export const DEFAULT_CATALOG_REFRESH_CONCURRENCY = 10;

export interface CatalogRefreshGroup {
  id: string;
  lifecycleStatus: string;
  desiredStatus?: string;
}

export interface CatalogRefreshCycleDependencies<
  TGroup extends CatalogRefreshGroup,
> {
  listGroups: () => Promise<readonly TGroup[]>;
  refreshGroup: (group: TGroup) => Promise<void>;
  concurrency?: number;
}

export interface CatalogRefreshCycleResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export async function runCatalogRefreshCycle<
  TGroup extends CatalogRefreshGroup,
>({
  listGroups,
  refreshGroup,
  concurrency = DEFAULT_CATALOG_REFRESH_CONCURRENCY,
}: CatalogRefreshCycleDependencies<TGroup>): Promise<CatalogRefreshCycleResult> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError(
      "Catalog refresh concurrency must be a positive integer",
    );
  }

  const groups = (await listGroups()).filter(
    (group) =>
      group.lifecycleStatus !== "retired" && group.desiredStatus !== "retired",
  );
  let nextIndex = 0;
  let succeeded = 0;
  let failed = 0;

  async function runWorker() {
    while (nextIndex < groups.length) {
      const group = groups[nextIndex];
      nextIndex += 1;
      if (!group) continue;

      try {
        await refreshGroup(group);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
  }

  const workerCount = Math.min(concurrency, groups.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return { attempted: groups.length, succeeded, failed };
}
