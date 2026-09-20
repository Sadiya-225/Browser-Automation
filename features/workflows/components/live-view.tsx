"use client"

import { useEffect, useRef, useState } from "react"

import { useLiveViewRun } from "@/features/workflows/components/workflow-runs-provider"

type ViewStatus = "loading" | "ready" | "error"

export function LiveView({ runId }: { workflowId: string; runId: string }) {
  const run = useLiveViewRun(runId)
  const liveSessionId = run?.liveSessionId

  const [status, setStatus] = useState<ViewStatus>("loading")
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!liveSessionId) return
    let cancelled = false

    fetch(`/api/live-view/${liveSessionId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ url }: { url: string }) => {
        if (cancelled) return
        setUrl(url)
        setStatus("ready")
      })
      .catch(() => {
        if (!cancelled) setStatus("error")
      })

    return () => {
      cancelled = true
    }
  }, [liveSessionId])

  // Closes the moment the session starts ending, not once the run reports as
  // finished — see sessionEnded's doc comment in workflow-runs-provider.tsx.
  const hasClosedRef = useRef(false)
  useEffect(() => {
    if (!run || hasClosedRef.current) return
    if (run.isLive && !run.sessionEnded) return
    hasClosedRef.current = true
    window.opener?.focus?.()
    window.close()
  }, [run])

  if (status === "ready" && url) {
    const src = `${url}${url.includes("?") ? "&" : "?"}navbar=false`
    return (
      <iframe
        src={src}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-same-origin allow-scripts"
        className="fixed inset-0 size-full border-0"
        title="Live Session"
      />
    )
  }

  const message =
    status === "error"
      ? "Couldn't Open the Live View."
      : liveSessionId
        ? "Connecting to the Live Session…"
        : "Waiting for the Browser Session to Open…"

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <p className="text-sm text-neutral-500">{message}</p>
    </div>
  )
}
