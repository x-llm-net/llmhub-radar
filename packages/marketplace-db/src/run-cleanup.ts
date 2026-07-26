import { runCleanupFromEnv } from "./maintenance-tasks";

runCleanupFromEnv()
  .then(({ deletedBuckets, deletedChecks }) => {
    console.log(
      "Marketplace cleanup deleted " +
        deletedChecks +
        " raw checks and " +
        deletedBuckets +
        " aggregate buckets",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
