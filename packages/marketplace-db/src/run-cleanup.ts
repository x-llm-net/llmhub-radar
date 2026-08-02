import { runCleanupFromEnv } from "./maintenance-tasks";

runCleanupFromEnv()
  .then(
    ({
      deletedBuckets,
      deletedChecks,
      deletedHubBuckets,
      deletedHubProbeCycles,
      deletedHubProbeRuns,
    }) => {
      console.log(
        "Marketplace cleanup deleted " +
          deletedChecks +
          " legacy raw checks, " +
          deletedHubProbeRuns +
          " hub probe runs, " +
          deletedHubProbeCycles +
          " hub probe cycles, " +
          deletedBuckets +
          " legacy aggregate buckets, and " +
          deletedHubBuckets +
          " hub aggregate buckets",
      );
    },
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
