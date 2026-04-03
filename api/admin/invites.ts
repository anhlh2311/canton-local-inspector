import type { VercelRequest, VercelResponse } from '@vercel/node'
import { jwtVerify } from 'jose'
import { Redis } from '@upstash/redis'
import { Resend } from 'resend'

/**
 * Invite management endpoints (admin only).
 *
 * GET    /api/admin/invites         — List pending invites
 * POST   /api/admin/invites         — Create invite { email, role }
 * DELETE /api/admin/invites         — Revoke invite { email }
 */

interface InviteRecord {
  role: 'editor' | 'viewer'
  invitedBy: string
  createdAt: string
}

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  })
}

async function verifyAdmin(req: VercelRequest): Promise<{ userId: string; email: string } | null> {
  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!authSecret) return null

  const cookieHeader = req.headers.cookie || ''
  const match = cookieHeader.match(/canton-session=([^;]+)/)
  if (!match) return null

  try {
    const { payload } = await jwtVerify(match[1], new TextEncoder().encode(authSecret))
    if (payload.role !== 'admin') return null
    return { userId: payload.sub as string, email: payload.email as string }
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()

  const admin = await verifyAdmin(req)
  if (!admin) return res.status(403).json({ error: 'Admin access required' })

  const redis = getRedis()

  // GET — List pending invites
  if (req.method === 'GET') {
    const emails = await redis.smembers('canton:invites:list')
    const invites: (InviteRecord & { email: string })[] = []
    if (emails.length > 0) {
      const pipeline = redis.pipeline()
      for (const email of emails) pipeline.get(`canton:invites:${email}`)
      const results = await pipeline.exec()
      for (let i = 0; i < emails.length; i++) {
        const record = results[i] as InviteRecord | null
        if (record) invites.push({ email: emails[i], ...record })
      }
    }
    invites.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return res.status(200).json({ invites })
  }

  // POST — Create invite
  if (req.method === 'POST') {
    const { email, role } = req.body ?? {}
    if (!email || !['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid email or role (must be editor or viewer)' })
    }
    const normalEmail = email.toLowerCase().trim()

    // Check if already registered
    const existingUserId = await redis.get(`canton:users:by-email:${normalEmail}`)
    if (existingUserId) {
      return res.status(409).json({ error: 'User already registered' })
    }

    // Check if already invited
    const existingInvite = await redis.get(`canton:invites:${normalEmail}`)
    if (existingInvite) {
      return res.status(409).json({ error: 'Invite already pending for this email' })
    }

    const invite: InviteRecord = {
      role,
      invitedBy: admin.email,
      createdAt: new Date().toISOString(),
    }
    await Promise.all([
      redis.set(`canton:invites:${normalEmail}`, invite),
      redis.sadd('canton:invites:list', normalEmail),
    ])

    // Send invitation email (best-effort — failure doesn't block invite creation)
    let emailSent = false
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      try {
        const resend = new Resend(resendKey)
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'Canton Inspector <noreply@resend.dev>'
        const appUrl = process.env.NEXTAUTH_URL || `https://${req.headers.host}`

        await resend.emails.send({
          from: fromEmail,
          to: normalEmail,
          subject: 'You\'ve been invited to Canton Inspector',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #6366f1; margin-bottom: 8px;">Canton Inspector</h2>
              <p>Hi there,</p>
              <p><strong>${admin.email}</strong> has invited you to access Canton Inspector as a <strong>${role}</strong>.</p>
              <p>Sign in with your Google account to get started:</p>
              <a href="${appUrl}/login" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">Sign in to Canton Inspector</a>
              <p style="color: #666; font-size: 13px;">Make sure to sign in with <strong>${normalEmail}</strong> — this is the email your invitation is linked to.</p>
            </div>
          `,
        })
        emailSent = true
      } catch (emailErr) {
        console.warn('[invites] Email send failed:', emailErr instanceof Error ? emailErr.message : emailErr)
      }
    }

    return res.status(201).json({ ok: true, emailSent, invite: { email: normalEmail, ...invite } })
  }

  // DELETE — Revoke invite
  if (req.method === 'DELETE') {
    const email = ((req.query.email || req.body?.email) as string)?.toLowerCase().trim()
    if (!email) return res.status(400).json({ error: 'Missing email' })
    await Promise.all([
      redis.del(`canton:invites:${email}`),
      redis.srem('canton:invites:list', email),
    ])
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
