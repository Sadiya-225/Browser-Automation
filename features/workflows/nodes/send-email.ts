import { resend } from "@/lib/resend"

export async function sendEmail({
  to,
  subject,
  body,
}: {
  to: string
  subject: string
  body: string
}) {
  const { data, error } = await resend.emails.send({
    from: "noreply@sevi.club",
    to,
    subject,
    html: body,
  })

  if (error || !data) {
    throw new Error(error?.message ?? "Resend Returned No Email ID")
  }

  return { id: data.id }
}
