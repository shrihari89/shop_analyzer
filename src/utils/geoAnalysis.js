// Approximate study-area boundary for Nanded City township, Pune, Maharashtra.
// Note: Prototype study boundary for academic analysis; not an official municipal survey.
export const NANDED_CITY_BOUNDARY = [
  { lat: 18.4665, lng: 73.7845 },
  { lat: 18.4680, lng: 73.7975 },
  { lat: 18.4615, lng: 73.8060 },
  { lat: 18.4515, lng: 73.8050 },
  { lat: 18.4490, lng: 73.7920 },
  { lat: 18.4535, lng: 73.7830 },
  { lat: 18.4600, lng: 73.7805 },
]

export const NANDED_CENTER = { lat: 18.4598, lng: 73.7946 }

export const BUSINESS_CATEGORIES = [
  { id: 'pharmacy', label: 'Pharmacy', queryTerm: 'pharmacies and medical stores' },
  { id: 'grocery', label: 'Grocery Store', queryTerm: 'grocery stores and supermarkets' },
  { id: 'restaurant', label: 'Restaurant', queryTerm: 'restaurants and cafes' },
  { id: 'clothing', label: 'Clothing Store', queryTerm: 'clothing and apparel stores' },
  { id: 'electronics', label: 'Electronics', queryTerm: 'electronics and mobile stores' },
  { id: 'stationery', label: 'Stationery', queryTerm: 'stationery and book stores' },
  { id: 'hardware', label: 'Hardware', queryTerm: 'hardware and building material stores' },
]

export function getCategoryLabel(categoryId) {
  return BUSINESS_CATEGORIES.find((c) => c.id === categoryId)?.label || categoryId
}

// Ray-casting algorithm to check if a coordinate lies inside a polygon
export function isInsideBoundary(point, boundary = NANDED_CITY_BOUNDARY) {
  const lat = typeof point.lat === 'function' ? point.lat() : point.lat
  const lng = typeof point.lng === 'function' ? point.lng() : point.lng

  let inside = false
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const latI = boundary[i].lat
    const lngI = boundary[i].lng
    const latJ = boundary[j].lat
    const lngJ = boundary[j].lng

    const intersects =
      (latI > lat) !== (latJ > lat) &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI

    if (intersects) inside = !inside
  }
  return inside
}

// Shoelace area calculation with local planar projection (km^2)
export function calculateAreaKm2(polygon) {
  if (!polygon || polygon.length < 3) return 0
  const earthRadius = 6371
  const latCenter = polygon.reduce((sum, p) => sum + p.lat, 0) / polygon.length

  const coords = polygon.map((p) => ({
    x: p.lng * (Math.PI / 180) * earthRadius * Math.cos((latCenter * Math.PI) / 180),
    y: p.lat * (Math.PI / 180) * earthRadius,
  }))

  let area = 0
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length
    area += coords[i].x * coords[j].y - coords[j].x * coords[i].y
  }
  return Math.abs(area / 2)
}

export function getBoundingBox(boundary = NANDED_CITY_BOUNDARY) {
  const lats = boundary.map((p) => p.lat)
  const lngs = boundary.map((p) => p.lng)
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  }
}

// Build multi-point search sectors (Center + 4 quadrants) inside Nanded City bounding box
// Build multi-point search sectors (Center + 4 quadrants) inside Nanded City bounding box
// Build 3 balanced search sectors across Nanded City to minimize Places API quota usage
export function getSearchSectors(boundary = NANDED_CITY_BOUNDARY) {
  const { south, north, west, east } = getBoundingBox(boundary)
  const midLat = (south + north) / 2
  const midLng = (west + east) / 2

  return [
    { name: 'Central Nanded City', center: { ...NANDED_CENTER } },
    { name: 'North-West & West Nanded City', center: { lat: (midLat + north) / 2, lng: (west + midLng) / 2 } },
    { name: 'South-East & East Nanded City', center: { lat: (south + midLat) / 2, lng: (midLng + east) / 2 } },
  ]
}


// Sutherland-Hodgman clipping against an axis-aligned rectangle
function clipPolygonToRect(polygon, rect) {
  const edges = [
    {
      inside: (p) => p.lng >= rect.west,
      intersect: (a, b) => {
        if (b.lng === a.lng) return a
        const t = (rect.west - a.lng) / (b.lng - a.lng)
        return { lat: a.lat + t * (b.lat - a.lat), lng: rect.west }
      },
    },
    {
      inside: (p) => p.lng <= rect.east,
      intersect: (a, b) => {
        if (b.lng === a.lng) return a
        const t = (rect.east - a.lng) / (b.lng - a.lng)
        return { lat: a.lat + t * (b.lat - a.lat), lng: rect.east }
      },
    },
    {
      inside: (p) => p.lat >= rect.south,
      intersect: (a, b) => {
        if (b.lat === a.lat) return a
        const t = (rect.south - a.lat) / (b.lat - a.lat)
        return { lat: rect.south, lng: a.lng + t * (b.lng - a.lng) }
      },
    },
    {
      inside: (p) => p.lat <= rect.north,
      intersect: (a, b) => {
        if (b.lat === a.lat) return a
        const t = (rect.north - a.lat) / (b.lat - a.lat)
        return { lat: rect.north, lng: a.lng + t * (b.lng - a.lng) }
      },
    },
  ]

  let output = polygon
  for (const edge of edges) {
    if (output.length === 0) break
    const input = output
    output = []
    let prev = input[input.length - 1]
    for (const curr of input) {
      if (edge.inside(curr)) {
        if (!edge.inside(prev)) {
          output.push(edge.intersect(prev, curr))
        }
        output.push(curr)
      } else if (edge.inside(prev)) {
        output.push(edge.intersect(prev, curr))
      }
      prev = curr
    }
  }
  return output
}

const GRID_ROWS = 3
const GRID_COLS = 3
const ROW_LABELS = ['North', 'Central', 'South']
const COL_LABELS = ['West', 'Central', 'East']

// Divide study area into 3x3 clipped zones and analyze business distribution
export function analyzeZonesAndScore(places, boundary = NANDED_CITY_BOUNDARY) {
  const bbox = getBoundingBox(boundary)
  const latStep = (bbox.north - bbox.south) / GRID_ROWS
  const lngStep = (bbox.east - bbox.west) / GRID_COLS

  const rawZones = []
  const zoneByGridKey = new Map()
  let zoneNumber = 1

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const rect = {
        north: bbox.north - row * latStep,
        south: bbox.north - (row + 1) * latStep,
        west: bbox.west + col * lngStep,
        east: bbox.west + (col + 1) * lngStep,
      }

      const clippedPolygon = clipPolygonToRect(boundary, rect)
      const areaKm2 = calculateAreaKm2(clippedPolygon)

      if (clippedPolygon.length >= 3 && areaKm2 > 0.005) {
        const direction =
          row === 1 && col === 1
            ? 'Core Central'
            : `${ROW_LABELS[row]}-${COL_LABELS[col]}`

        const zone = {
          id: `Z${zoneNumber}`,
          name: `Zone ${zoneNumber}`,
          direction,
          row,
          col,
          polygon: clippedPolygon,
          center: {
            lat: clippedPolygon.reduce((s, p) => s + p.lat, 0) / clippedPolygon.length,
            lng: clippedPolygon.reduce((s, p) => s + p.lng, 0) / clippedPolygon.length,
          },
          areaKm2: Number(areaKm2.toFixed(3)),
          places: [],
          count: 0,
          density: 0,
          presenceLevel: 'Low',
          opportunityScore: null,
          scoreBreakdown: null,
        }

        rawZones.push(zone)
        zoneByGridKey.set(`${row}:${col}`, zone)
        zoneNumber++
      }
    }
  }

  // Assign each filtered business to strictly one zone using grid coordinates
  const enrichedPlaces = places.map((place) => {
    const row = Math.min(
      GRID_ROWS - 1,
      Math.max(0, Math.floor(((bbox.north - place.lat) / (bbox.north - bbox.south)) * GRID_ROWS)),
    )
    const col = Math.min(
      GRID_COLS - 1,
      Math.max(0, Math.floor(((place.lng - bbox.west) / (bbox.east - bbox.west)) * GRID_COLS)),
    )

    let targetZone = zoneByGridKey.get(`${row}:${col}`)
    if (!targetZone && rawZones.length > 0) {
      // Fallback: nearest zone center if rounding landed on clipped edge
      targetZone = rawZones.reduce((best, z) => {
        const dBest = Math.hypot(best.center.lat - place.lat, best.center.lng - place.lng)
        const dCurr = Math.hypot(z.center.lat - place.lat, z.center.lng - place.lng)
        return dCurr < dBest ? z : best
      }, rawZones[0])
    }

    const updatedPlace = {
      ...place,
      zoneId: targetZone?.id || null,
      zoneLabel: targetZone ? `${targetZone.name} (${targetZone.direction})` : 'Study Area',
    }

    if (targetZone) {
      targetZone.places.push(updatedPlace)
    }
    return updatedPlace
  })

  // Compute counts and densities per zone
  rawZones.forEach((zone) => {
    zone.count = zone.places.length
    zone.density = zone.areaKm2 > 0 ? Number((zone.count / zone.areaKm2).toFixed(2)) : 0
  })

  const totalAreaKm2 = Number(calculateAreaKm2(boundary).toFixed(2))
  const totalBusinesses = enrichedPlaces.length
  const overallDensity =
    totalAreaKm2 > 0 ? Number((totalBusinesses / totalAreaKm2).toFixed(2)) : 0
  const avgPerZone =
    rawZones.length > 0 ? Number((totalBusinesses / rawZones.length).toFixed(2)) : 0

  const maxZoneCount = Math.max(0, ...rawZones.map((z) => z.count))
  const maxZoneDensity = Math.max(0, ...rawZones.map((z) => z.density))

  // Classify presence level and compute transparent Preliminary Opportunity Score
  rawZones.forEach((zone) => {
    if (totalBusinesses === 0) {
      zone.presenceLevel = 'Low'
      zone.opportunityScore = null
      return
    }

    // Relative + absolute thresholds for category-specific classification
    if (zone.count === 0 || (zone.count <= 1 && zone.count < avgPerZone)) {
      zone.presenceLevel = 'Low'
    } else if (zone.count <= Math.max(2, Math.ceil(avgPerZone * 1.35))) {
      zone.presenceLevel = 'Medium'
    } else {
      zone.presenceLevel = 'High'
    }

    // Find 8-connected neighboring active zones
    const neighbors = rawZones.filter(
      (other) =>
        other.id !== zone.id &&
        Math.abs(other.row - zone.row) <= 1 &&
        Math.abs(other.col - zone.col) <= 1,
    )
    const avgNeighborCount =
      neighbors.length > 0
        ? neighbors.reduce((s, n) => s + n.count, 0) / neighbors.length
        : zone.count

    // Factor 1 (50%): Local Supply Gap
    const supplyGap = (1 - zone.count / Math.max(1, maxZoneCount)) * 100
    // Factor 2 (30%): Density Relief
    const densityRelief = (1 - zone.density / Math.max(0.01, maxZoneDensity)) * 100
    // Factor 3 (20%): Neighbor Competition Relief
    const neighborRelief = (1 - avgNeighborCount / Math.max(1, maxZoneCount)) * 100

    const score = Math.round(0.5 * supplyGap + 0.3 * densityRelief + 0.2 * neighborRelief)
    zone.opportunityScore = Math.max(0, Math.min(100, score))
    zone.scoreBreakdown = {
      supplyGap: Math.round(supplyGap),
      densityRelief: Math.round(densityRelief),
      neighborRelief: Math.round(neighborRelief),
      avgNeighborCount: Number(avgNeighborCount.toFixed(2)),
    }
  })

  const sortedByCountDesc = [...rawZones].sort((a, b) => b.count - a.count || b.density - a.density)
  const sortedByScoreDesc = [...rawZones].sort(
    (a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1) || a.count - b.count,
  )

  const highestZone = totalBusinesses > 0 ? sortedByCountDesc[0] : null
  const lowestZones = rawZones.filter((z) => z.presenceLevel === 'Low')
  const topOpportunityZone = totalBusinesses > 0 ? sortedByScoreDesc[0] : null

  const competitionLevel =
    totalBusinesses <= 5 ? 'Low' : totalBusinesses <= 15 ? 'Medium' : 'High'

  const preliminaryStudyScore =
    totalBusinesses === 0
      ? null
      : Math.round(
          rawZones.reduce((sum, z) => sum + (z.opportunityScore ?? 0), 0) / rawZones.length,
        )

  return {
    places: enrichedPlaces,
    zones: rawZones,
    summary: {
      totalBusinesses,
      totalAreaKm2,
      overallDensity,
      activeZoneCount: rawZones.length,
      avgPerZone,
      highestZone,
      lowestZones,
      topOpportunityZone,
      competitionLevel,
      preliminaryStudyScore,
    },
  }
}