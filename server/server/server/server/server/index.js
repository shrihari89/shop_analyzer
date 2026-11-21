import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.resolve(__dirname, '..', 'dist')

const app = express()
const PORT = process.env.PORT || 3001
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5'

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  }),
)
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    model: MODEL,
  })
})

app.post('/api/recommendations', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(503).json({
        error: 'ANTHROPIC_API_KEY is not configured on the server.',
      })
    }

    const {
      categoryLabel,
      studyAreaKm2,
      totalBusinesses,
      overallDensity,
      avgPerZone,
      competitionLevel,
      preliminaryStudyScore,
      zones,
    } = req.body || {}

    if (!categoryLabel || !Array.isArray(zones) || zones.length === 0) {
      return res.status(400).json({
        error: 'Invalid analysis payload. categoryLabel and zones[] are required.',
      })
    }

    const anthropic = new Anthropic({ apiKey })

    const systemPrompt = `You are a careful urban retail location analyst helping evaluate business distribution in Nanded City township (Pune, Maharashtra, India—NOT Nanded in Marathwada).

Rules:
1. Interpret ONLY the observed metrics provided. Never invent population figures, footfall numbers, or unlisted shops.
2. Distinguish clearly between "low observed business presence" (potential opportunity worth investigating) and "guaranteed demand".
3. Respond with VALID JSON ONLY (no markdown fences) using exactly these keys:
{
  "summary": "2-3 sentence executive summary of the spatial distribution",
  "promisingZones": ["bullet 1 naming specific Zone IDs/directions and why", "bullet 2"],
  "competitionHotspots": ["bullet 1 naming higher-concentration Zone IDs/directions", "bullet 2"],
  "nextSteps": ["practical field check 1", "practical field check 2", "practical field check 3"],
  "dataCaveats": "1-2 sentences reminding that Google Places data is partial and boundary/scores are preliminary"
}`

    const userPrompt = `Analyze this observed dataset for category "${categoryLabel}" inside the ~${studyAreaKm2} km² Nanded City (Pune) study boundary:
- Total unique businesses retrieved: ${totalBusinesses}
- Overall observed density: ${overallDensity} per km²
- Average businesses per active zone: ${avgPerZone}
- Competition indicator: ${competitionLevel}
- Preliminary study-area opportunity average: ${preliminaryStudyScore ?? 'N/A'}/100

Zone breakdown:
${zones
  .map(
    (z) =>
      `- ${z.id} (${z.name}, ${z.direction}): area=${z.areaKm2} km², count=${z.count}, density=${z.density}/km², presence=${z.presenceLevel}, prelimScore=${z.opportunityScore ?? 'N/A'}/100`,
  )
  .join('\n')}`

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    const cleanedJson = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim()

    let parsed
    try {
      parsed = JSON.parse(cleanedJson)
    } catch {
      parsed = {
        summary: rawText,
        promisingZones: [],
        competitionHotspots: [],
        nextSteps: ['Verify local footfall and commercial shop availability on-site.'],
        dataCaveats:
          'Response formatted from raw AI text. Google Places listings are partial and preliminary.',
      }
    }

    res.json({
      ...parsed,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Claude API error:', error)
    res.status(500).json({
      error: error?.message || 'Failed to generate AI recommendation.',
    })
  }
})

// Serve built React frontend in production (Docker / Render)
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API route not found' })
    }
    return res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nanded Shop Analyzer server listening on http://0.0.0.0:${PORT}`)
})