import { and, db, desc, eq, gte, inArray } from "@openstatus/db";
import {
  radarCredential,
  radarPool,
  radarProbeRun,
  radarProbeTarget,
  radarProvider,
} from "@openstatus/db/src/schema";

const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const pools = await db
  .select({
    id: radarPool.id,
    slug: radarPool.slug,
    name: radarPool.name,
    description: radarPool.description,
    visibility: radarPool.visibility,
    publicPoolOptIn: radarPool.publicPoolOptIn,
  })
  .from(radarPool)
  .orderBy(radarPool.slug)
  .all();

const poolIds = pools.map((pool) => pool.id);
const providers = poolIds.length
  ? await db
      .select({
        id: radarProvider.id,
        poolId: radarProvider.poolId,
        name: radarProvider.name,
        displayName: radarProvider.displayName,
        providerType: radarProvider.providerType,
        enabled: radarProvider.enabled,
      })
      .from(radarProvider)
      .where(inArray(radarProvider.poolId, poolIds))
      .all()
  : [];
const providerIds = providers.map((provider) => provider.id);
const credentials = providerIds.length
  ? await db
      .select({
        id: radarCredential.id,
        providerId: radarCredential.providerId,
        name: radarCredential.name,
        billingGroup: radarCredential.billingGroup,
        modelGroup: radarCredential.modelGroup,
        modelCatalog: radarCredential.modelCatalog,
        keyFingerprint: radarCredential.keyFingerprint,
        lastFour: radarCredential.lastFour,
        enabled: radarCredential.enabled,
      })
      .from(radarCredential)
      .where(inArray(radarCredential.providerId, providerIds))
      .all()
  : [];
const targets = poolIds.length
  ? await db
      .select({
        id: radarProbeTarget.id,
        poolId: radarProbeTarget.poolId,
        providerId: radarProbeTarget.providerId,
        credentialId: radarProbeTarget.credentialId,
        name: radarProbeTarget.name,
        displayName: radarProbeTarget.displayName,
        modelName: radarProbeTarget.modelName,
        endpointType: radarProbeTarget.endpointType,
        intervalSeconds: radarProbeTarget.intervalSeconds,
        timeoutMs: radarProbeTarget.timeoutMs,
        streamEnabled: radarProbeTarget.streamEnabled,
        enabled: radarProbeTarget.enabled,
        currentStatus: radarProbeTarget.currentStatus,
      })
      .from(radarProbeTarget)
      .where(inArray(radarProbeTarget.poolId, poolIds))
      .all()
  : [];
const targetIds = targets.map((target) => target.id);
const runs = targetIds.length
  ? await db
      .select({
        targetId: radarProbeRun.targetId,
        startedAt: radarProbeRun.startedAt,
        success: radarProbeRun.success,
        firstTokenMs: radarProbeRun.firstTokenMs,
        totalLatencyMs: radarProbeRun.totalLatencyMs,
        errorType: radarProbeRun.errorType,
      })
      .from(radarProbeRun)
      .where(
        and(
          inArray(radarProbeRun.targetId, targetIds),
          gte(radarProbeRun.startedAt, sevenDaysAgo),
        ),
      )
      .orderBy(desc(radarProbeRun.startedAt))
      .all()
  : [];

const summary = pools.map((pool) => ({
  ...pool,
  providers: providers
    .filter((provider) => provider.poolId === pool.id)
    .map((provider) => ({
      ...provider,
      credentials: credentials
        .filter((credential) => credential.providerId === provider.id)
        .map(({ keyFingerprint, ...credential }) => ({
          ...credential,
          keyFingerprint: keyFingerprint.slice(0, 12),
        })),
      targets: targets
        .filter((target) => target.providerId === provider.id)
        .map((target) => {
          const targetRuns = runs.filter((run) => run.targetId === target.id);
          const successCount = targetRuns.filter((run) => run.success).length;
          return {
            ...target,
            sevenDaySamples: targetRuns.length,
            sevenDaySuccesses: successCount,
            sevenDayAvailability:
              targetRuns.length > 0
                ? Number(((successCount / targetRuns.length) * 100).toFixed(2))
                : null,
            latestCheckAt: targetRuns[0]?.startedAt?.toISOString() ?? null,
          };
        }),
    })),
}));

console.log(JSON.stringify(summary, null, 2));
