import type { VercelRequest, VercelResponse } from '@vercel/node'
import { SignJWT } from 'jose'
import { Redis } from '@upstash/redis'

/**
 * Handles the Google OAuth callback.
 * GET /api/auth/google-callback?code=...
 *
 * Flow:
 *   1. Exchange code for tokens with Google
 *   2. Get user info from Google
 *   3. Check if user is admin (ADMIN_EMAIL), existing user, or invited
 *   4. Create/update user record in Redis
 *   5. Issue a signed JWT session cookie
 *   6. Redirect to / (or /access-denied if not authorized)
 */

interface GoogleUserInfo {
  sub: string // Google user ID
  email: string
  name: string
  picture: string
  email_verified: boolean
}

interface UserRecord {
  email: string
  name: string
  image: string
  role: 'admin' | 'editor' | 'viewer'
  createdAt: string
  lastLoginAt: string
}

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

function getBaseUrl(req: VercelRequest): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  return `${proto}://${host}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const code = req.query.code as string
  if (!code) return res.status(400).json({ error: 'Missing authorization code' })

  const baseUrl = getBaseUrl(req)
  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!clientId || !clientSecret || !authSecret) {
    return res.status(500).json({ error: 'Missing OAuth configuration' })
  }

  try {
    // Step 1: Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseUrl}/api/auth/google-callback`,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      return res.redirect(302, `${baseUrl}/login?error=token_exchange_failed`)
    }
    const tokens = await tokenRes.json()

    // Step 2: Get user info
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!userInfoRes.ok) {
      return res.redirect(302, `${baseUrl}/login?error=userinfo_failed`)
    }
    const googleUser: GoogleUserInfo = await userInfoRes.json()

    // Step 3: Check authorization
    const redis = getRedis()
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase()
    const userEmail = googleUser.email.toLowerCase()
    const userId = googleUser.sub

    // Check existing user
    let existingUser = await redis.get<UserRecord>(`canton:users:${userId}`)
    let role: 'admin' | 'editor' | 'viewer' | null = existingUser?.role ?? null

    if (!role) {
      // New user — check if admin
      if (adminEmail && userEmail === adminEmail) {
        role = 'admin'
      } else {
        // Check invite
        const invite = await redis.get<InviteRecord>(`canton:invites:${userEmail}`)
        if (invite) {
          role = invite.role
          // Consume invite
          await redis.del(`canton:invites:${userEmail}`)
          await redis.srem('canton:invites:list', userEmail)
        }
      }
    }

    if (!role) {
      // Not authorized — redirect to access denied
      // Set a minimal cookie so the access-denied page can show the email
      const deniedJwt = await new SignJWT({
        email: userEmail,
        name: googleUser.name,
        image: googleUser.picture,
        denied: true,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(authSecret))

      res.setHeader('Set-Cookie', buildCookie('canton-session', deniedJwt, 3600))
      return res.redirect(302, `${baseUrl}/access-denied`)
    }

    // Step 4: Create/update user in Redis
    const now = new Date().toISOString()
    const userRecord: UserRecord = {
      email: userEmail,
      name: googleUser.name,
      image: googleUser.picture,
      role,
      createdAt: existingUser?.createdAt || now,
      lastLoginAt: now,
    }
    await Promise.all([
      redis.set(`canton:users:${userId}`, userRecord),
      redis.set(`canton:users:by-email:${userEmail}`, userId),
      redis.sadd('canton:users:list', userId),
    ])

    // Step 5: Issue JWT session cookie (24h)
    const sessionJwt = await new SignJWT({
      sub: userId,
      email: userEmail,
      name: googleUser.name,
      image: googleUser.picture,
      role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(new TextEncoder().encode(authSecret))

    res.setHeader('Set-Cookie', buildCookie('canton-session', sessionJwt, 86400))
    return res.redirect(302, `${baseUrl}/`)
  } catch (err) {
    console.error('[google-callback] Error:', err)
    return res.redirect(302, `${baseUrl}/login?error=callback_failed`)
  }
}

function buildCookie(name: string, value: string, maxAgeSec: number): string {
  const parts = [
    `${name}=${value}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=${maxAgeSec}`,
  ]
  return parts.join('; ')
}
