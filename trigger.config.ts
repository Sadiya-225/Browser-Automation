import { defineConfig } from "@trigger.dev/sdk";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import sentryEsbuildPlugin from "@sentry/esbuild-plugin";

export default defineConfig({
  project: "proj_gtpehfybtolvyjfpspis",
  // Plain "node" resolves to Node 21.7.3, which Trigger.dev is dropping
  // support for (deployments fail from Oct 5) — pin the LTS explicitly.
  runtime: "node-22",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["features"],
  build: {
    extensions: [
      esbuildPlugin(
        sentryEsbuildPlugin({
          org: "enra-r3",
          project: "browser-automation",
          // Find this auth token in settings -> developer settings -> auth tokens
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
        { placement: "last", target: "deploy" }
      ),
      {
        name: "externalize-stagehand",
        // Stagehand's shutdown supervisor (crash-cleanup for local Chrome /
        // Browserbase sessions) locates its own sibling cli.js by inspecting
        // its currently-executing file's path. Bundling the package into the
        // single esbuild task output moves that path, so the lookup fails
        // even though cli.js exists on disk — surfacing as "Shutdown
        // supervisor unavailable" at runtime. Keeping it external leaves it a
        // real node_modules import, so the lookup resolves correctly.
        externalsForTarget: () => ["@browserbasehq/stagehand"],
      },
    ],
  },
});
