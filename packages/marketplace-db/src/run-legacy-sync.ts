import { runLegacySyncFromEnv } from "./maintenance-tasks";

runLegacySyncFromEnv()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
