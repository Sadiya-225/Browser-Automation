import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"
import { auth as triggerAuth } from "@trigger.dev/sdk"
import { notFound } from "next/navigation"

import { getWorkflow } from "@/features/workflows/data"
import { WorkflowRunsProvider } from "@/features/workflows/components/workflow-runs-provider"
import { LiveView } from "@/features/workflows/components/live-view"

// Deliberately outside the (dashboard) route group — the tab the Run button
// opens shouldn't carry the app sidebar, just the run's progress full-bleed.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; runId: string }>
}) {
  const { id, runId } = await params
  const { userId, orgId } = await auth()

  Sentry.getIsolationScope().setAttributes({
    route: "GET /workflows/[id]/live/[runId]",
    userId: userId ?? null,
    orgId: orgId ?? null,
    workflowId: id,
    runId,
  })

  if (!orgId) {
    // If this fires often, proxy.ts's auth.protect() is the more likely
    // culprit (it runs first and 404s an unauthenticated non-page-like
    // request before this component ever executes) — this log only catches
    // the case where a request got this far with no active org.
    Sentry.logger.warn("Live view page: no active org", { userId, workflowId: id, runId })
    notFound()
  }

  const workflow = await getWorkflow(orgId, id)
  if (!workflow) {
    Sentry.logger.warn("Live view page: workflow not found for org", {
      userId,
      orgId,
      workflowId: id,
      runId,
    })
    notFound()
  }

  // A read-only token scoped to this workflow's run tag, so the client can
  // subscribe to its runs in realtime. Matches the scope the canvas itself
  // uses (see app/(dashboard)/workflows/[id]/page.tsx).
  const runsToken = await triggerAuth.createPublicToken({
    scopes: {
      read: {
        tags: [`workflow:${id}`],
      },
    },
    expirationTime: "1hr",
  })

  return (
    <WorkflowRunsProvider workflowId={id} accessToken={runsToken}>
      <LiveView workflowId={id} runId={runId} />
    </WorkflowRunsProvider>
  )
}
