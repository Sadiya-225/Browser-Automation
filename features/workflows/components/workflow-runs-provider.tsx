"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks"

import type {
  RunStep,
  runWorkflowTask,
} from "@/features/workflows/tasks/run-workflow"

type WorkflowRun = ReturnType<
  typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
>["runs"][number]

interface WorkflowRunsContextValue {
  runs: WorkflowRun[]
  error?: Error
}

const WorkflowRunsContext = createContext<WorkflowRunsContextValue | null>(null)

interface WorkflowRunsProviderProps {
  workflowId: string
  // A Public Access Token scoped to read this workflow's runs, minted on the
  // server (auth.createPublicToken) and handed down as a prop.
  accessToken: string
  // Remount the subscription whenever this tab regains visibility (see
  // resyncKey below). Only the canvas needs this — it's the tab that gets
  // backgrounded for a run's whole duration once its live view opens in a
  // new tab. The live-view tab itself shouldn't opt in: it's normally the
  // foreground tab, and remounting it mid-run resets its own progress
  // display and can re-fetch a live-view URL for a session that has since
  // stopped. Defaults to false.
  resyncOnVisibility?: boolean
  children: React.ReactNode
}

// The actual subscription — provides the context directly, so WorkflowRunsProvider
// can force a clean remount of it (see resyncKey below) just by changing its key,
// with no state lifted through a callback. (An earlier version bridged runs/error
// up through a setState callback; useRealtimeRunsWithTag hands SWR a fresh `[]`
// fallback on every render until real data arrives, and feeding that reference
// churn into setState — which re-renders this unmemoized component, produces
// another fresh `[]`, and repeats — is an infinite loop. Computing the context
// value directly with useMemo, as below, never had that problem.)
function RealtimeRunsSubscription({
  workflowId,
  accessToken,
  children,
}: {
  workflowId: string
  accessToken: string
  children: React.ReactNode
}) {
  const { runs, error } = useRealtimeRunsWithTag<typeof runWorkflowTask>(
    `workflow:${workflowId}`,
    { accessToken }
  )

  const value = useMemo<WorkflowRunsContextValue>(
    () => ({ runs, error }),
    [runs, error]
  )

  return (
    <WorkflowRunsContext.Provider value={value}>
      {children}
    </WorkflowRunsContext.Provider>
  )
}

// One shared realtime subscription to every run tagged workflow:<id>. Any
// component on the canvas reads it through the hooks below instead of opening
// its own socket.
export function WorkflowRunsProvider({
  workflowId,
  accessToken,
  resyncOnVisibility = false,
  children,
}: WorkflowRunsProviderProps) {
  // Bumped whenever the tab regains visibility, to force a clean remount of
  // the subscription above. A backgrounded tab's stream can silently stall
  // (browser throttling, a dropped connection) — most noticeable on the
  // canvas since opening a run's live view backgrounds it for the run's
  // whole duration — and without this, it only recovers on a manual reload
  // rather than the moment you switch back to it.
  const [resyncKey, setResyncKey] = useState(0)
  useEffect(() => {
    if (!resyncOnVisibility) return
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setResyncKey((key) => key + 1)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [resyncOnVisibility])

  return (
    <RealtimeRunsSubscription
      key={resyncKey}
      workflowId={workflowId}
      accessToken={accessToken}
    >
      {children}
    </RealtimeRunsSubscription>
  )
}

function useWorkflowRuns() {
  const ctx = useContext(WorkflowRunsContext)
  if (!ctx) {
    throw new Error(
      "useWorkflowRuns must be used within a WorkflowRunsProvider"
    )
  }
  return ctx
}

export function useWorkflowRunsError(): Error | undefined {
  return useWorkflowRuns().error
}

const TERMINAL_RUN_STATUSES = new Set<WorkflowRun["status"]>([
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
])

// A run is still going as long as it hasn't reached a terminal status.
function isRunLive(run: WorkflowRun): boolean {
  return !TERMINAL_RUN_STATUSES.has(run.status)
}

// The single run matching this id, if the realtime subscription has received
// it yet.
function useRun(runId: string | undefined): WorkflowRun | undefined {
  const { runs } = useWorkflowRuns()
  return useMemo(() => runs.find((r) => r.id === runId), [runs, runId])
}

// The steps of a run, wherever they live. Prefer the run's final output steps
// (guaranteed once it succeeds) and fall back to the live metadata steps the
// task publishes while it runs — a failed or in-flight run only has the latter.
function stepsForRun(run: WorkflowRun): RunStep[] {
  const metadataSteps = run.metadata?.steps as RunStep[] | undefined
  return run.output?.steps ?? metadataSteps ?? []
}

export interface LiveViewRun {
  isLive: boolean
  steps: RunStep[]
  // The session's live-view target, published to metadata the moment the
  // session opens — unlike ConsoleRun's browserbaseSessionId, which only ever
  // reads the (later) finished output.
  liveSessionId?: string
  // True the moment the task starts closing its Browserbase session — set
  // just before the (network-bound) close call, so a live-view tab can bail
  // out right away instead of waiting for the run to report as finished,
  // which would otherwise leave it staring at Browserbase's own disconnect
  // screen for that gap.
  sessionEnded: boolean
}

// Everything the live-view tab needs for one run, by id — undefined until the
// realtime subscription has delivered that run.
export function useLiveViewRun(runId: string): LiveViewRun | undefined {
  const run = useRun(runId)
  return useMemo<LiveViewRun | undefined>(() => {
    if (!run) return undefined
    return {
      isLive: isRunLive(run),
      steps: stepsForRun(run),
      liveSessionId: run.metadata?.browserbaseSessionId as string | undefined,
      sessionEnded: Boolean(run.metadata?.browserbaseSessionEnded),
    }
  }, [run])
}

interface LatestRunSteps {
  steps: RunStep[]
  // True while the latest run is queued or executing — i.e. still producing steps.
  isLive: boolean
}

// The steps of the most recent run, plus whether it's still going.
export function useLatestRunSteps(): LatestRunSteps {
  const { runs } = useWorkflowRuns()

  return useMemo<LatestRunSteps>(() => {
    const latest = runs.reduce<WorkflowRun | undefined>((newest, run) => {
      if (!newest || run.createdAt > newest.createdAt) return run
      return newest
    }, undefined)

    if (!latest) return { steps: [], isLive: false }

    return { steps: stepsForRun(latest), isLive: isRunLive(latest) }
  }, [runs])
}

// The run currently in flight, if any — at most one is live at a time. A Stop
// button reads this to know whether there's a run to cancel and, if so, its id.
export function useLiveRun(): WorkflowRun | undefined {
  const { runs } = useWorkflowRuns()

  return useMemo(() => runs.find(isRunLive), [runs])
}

// The Browserbase session id a finished run drove, read from its final output so
// a panel can fetch the replay. Only the output carries it — the recording lags
// the session close, so the live metadata never has it — so an in-flight or
// failed run reports undefined.
function sessionIdForRun(run: WorkflowRun): string | undefined {
  return run.output?.browserbaseSessionId
}

// One run flattened for the console: its identity and status, whether it's still
// live, and its steps with everything each one produced.
export interface ConsoleRun {
  id: string
  status: WorkflowRun["status"]
  createdAt: Date
  isLive: boolean
  steps: RunStep[]
  // The Browserbase session id to replay, present only once the run has finished.
  browserbaseSessionId?: string
}

// Every run, newest first, with its steps resolved — the full history a console
// panel below the canvas renders as a list of runs to drill into.
export function useConsoleRuns(): ConsoleRun[] {
  const { runs } = useWorkflowRuns()

  return useMemo<ConsoleRun[]>(
    () =>
      [...runs]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((run) => ({
          id: run.id,
          status: run.status,
          createdAt: run.createdAt,
          isLive: isRunLive(run),
          steps: stepsForRun(run),
          browserbaseSessionId: sessionIdForRun(run),
        })),
    [runs]
  )
}
