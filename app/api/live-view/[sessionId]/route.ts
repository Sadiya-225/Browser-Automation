import * as Sentry from "@sentry/nextjs"
import { auth } from "@clerk/nextjs/server"
import { APIError } from "@browserbasehq/sdk"

import { browserbase } from "@/lib/browserbase"

// Hands back a running Browserbase session's live-view URL so the browser can
// open it directly. The lookup needs the secret API key, so it can only
// happen server-side — the client only ever sees the resulting URL, not the
// key. See AGENTS.md's Browserbase observability pointer for the docs this
// follows: https://docs.browserbase.com/platform/browser/observability
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { sessionId } = await params

  Sentry.getIsolationScope().setAttributes({
    route: "GET /api/live-view/[sessionId]",
    userId,
    orgId,
    sessionId,
  })

  try {
    // debuggerFullscreenUrl renders just the page, without the devtools-style
    // chrome debuggerUrl includes — the console opens this one directly in a
    // new tab.
    const { debuggerFullscreenUrl } = await browserbase.sessions.debug(sessionId)

    Sentry.logger.info("Live view URL served", { sessionId, orgId })

    return Response.json({ url: debuggerFullscreenUrl })
  } catch (error) {
    // 404: the session was never this org's (or never existed). 410: it did,
    // but has already stopped — Browserbase's status once a session ends.
    // Either way there's no live view left to hand back.
    if (error instanceof APIError && (error.status === 404 || error.status === 410)) {
      return new Response("Session not live", { status: 404 })
    }
    throw error
  }
}
