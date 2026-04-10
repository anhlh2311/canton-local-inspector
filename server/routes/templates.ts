import { Router } from 'express'
import { getStorage } from '../storage/index.js'

const router = Router()

router.get('/', async (req, res) => {
  const storage = await getStorage()

  // Return cron metadata
  if (req.query.meta === 'true') {
    const meta = await storage.getCronMeta()
    res.setHeader('Cache-Control', 'max-age=30')
    return res.json({ meta: meta ?? null })
  }

  // Return template index by network
  const network = (req.query.network || req.query.nodeId) as string
  if (!network) {
    return res.status(400).json({ error: 'Missing network query param' })
  }

  const index = await storage.getTemplateIndex(network)
  res.setHeader('Cache-Control', 'max-age=60')
  return res.json(index ?? { updatedAt: null, templates: [] })
})

export default router
