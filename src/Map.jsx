import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import {
  BUSINESS_CATEGORIES,
  NANDED_CENTER,
  NANDED_CITY_BOUNDARY,
  getSearchSectors,
  isInsideBoundary,
} from './utils/geoAnalysis'
import { MapBootLoader } from './components/LoadingOverlay'

let mapsOptionsConfigured = false
const CLIENT_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

const ZONE_COLORS = {
  Low: { fill: '#16A34A', stroke: '#15803D', fillOpacity: 0.22 },
  Medium: { fill: '#D97706', stroke: '#B45309', fillOpacity: 0.24 },
  High: { fill: '#DC2626', stroke: '#B91C1C', fillOpacity: 0.26 },
}

function getPlaceName(place) {
  if (typeof place.displayName === 'string' && place.displayName.trim()) {
    return place.displayName.trim()
  }
  if (place.displayName?.text) {
    return place.displayName.text
  }
  return 'Unnamed Business'
}

function readClientCache(category) {
  try {
    const raw = sessionStorage.getItem(`nanded_places_${category}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.cachedAt < CLIENT_CACHE_TTL_MS && Array.isArray(parsed.places)) {
      return parsed.places
    }
  } catch {
    // Ignore storage errors
  }
  return null
}

function writeClientCache(category, places) {
  try {
    sessionStorage.setItem(
      `nanded_places_${category}`,
      JSON.stringify({ cachedAt: Date.now(), places }),
    )
  } catch {
    // Ignore storage errors
  }
}

async function querySectorPlaces(Place, queryTerm, sector) {
  const textQuery = `${queryTerm} near ${sector.name}, Nanded City, Sinhagad Road, Pune`
  return await Place.searchByText({
    textQuery,
    fields: ['id', 'displayName', 'location', 'formattedAddress'],
    locationBias: sector.center,
    maxResultCount: 20,
  })
}

function NandedMap({
  category,
  analysisRunId,
  zones,
  selectedZoneId,
  showZones,
  showMarkers,
  showBoundary,
  onMapReady,
  onStepChange,
  onPlacesFound,
  onAnalysisError,
  onSelectZone,
}) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const boundaryPolyRef = useRef(null)
  const zonePolysRef = useRef([])
  const markersRef = useRef([])
  const infoWindowRef = useRef(null)
  const showMarkersRef = useRef(showMarkers)

  const mapsLibRef = useRef(null)
  const placeClassRef = useRef(null)
  const markerClassRef = useRef(null)
  const pinClassRef = useRef(null)

  const [mapReady, setMapReady] = useState(false)
  const [mapLoadError, setMapLoadError] = useState('')

  useEffect(() => {
    showMarkersRef.current = showMarkers
  }, [showMarkers])

  const callbacksRef = useRef({
    onMapReady,
    onStepChange,
    onPlacesFound,
    onAnalysisError,
    onSelectZone,
  })
  useEffect(() => {
    callbacksRef.current = {
      onMapReady,
      onStepChange,
      onPlacesFound,
      onAnalysisError,
      onSelectZone,
    }
  }, [onMapReady, onStepChange, onPlacesFound, onAnalysisError, onSelectZone])

  // 1. Initialize Google Maps (with StrictMode guard)
  useEffect(() => {
    let cancelled = false

    async function loadMap() {
      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
        if (!apiKey) {
          throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY in frontend environment.')
        }

        if (!mapsOptionsConfigured) {
          setOptions({
            key: apiKey,
            v: 'weekly',
          })
          mapsOptionsConfigured = true
        }

        const [mapsLib, { Place }, { AdvancedMarkerElement, PinElement }] = await Promise.all([
          importLibrary('maps'),
          importLibrary('places'),
          importLibrary('marker'),
        ])

        if (cancelled || !mapRef.current) return

        const { Map: GoogleMap, Polygon, InfoWindow } = mapsLib

        const map = new GoogleMap(mapRef.current, {
          center: NANDED_CENTER,
          zoom: 15,
          mapId: 'DEMO_MAP_ID',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        })

        const boundaryPoly = new Polygon({
          paths: NANDED_CITY_BOUNDARY,
          strokeColor: '#2563EB',
          strokeOpacity: 0.9,
          strokeWeight: 2.5,
          fillColor: '#3B82F6',
          fillOpacity: 0.05,
          clickable: false,
          zIndex: 1,
          map,
        })

        mapInstance.current = map
        boundaryPolyRef.current = boundaryPoly
        infoWindowRef.current = new InfoWindow()
        mapsLibRef.current = mapsLib
        placeClassRef.current = Place
        markerClassRef.current = AdvancedMarkerElement
        pinClassRef.current = PinElement

        setMapReady(true)
        callbacksRef.current.onMapReady?.(true)
      } catch (error) {
        if (!cancelled) {
          console.error('Google Maps failed to load:', error)
          setMapLoadError(error.message || 'Unable to load Google Maps.')
        }
      }
    }

    loadMap()

    return () => {
      cancelled = true
      markersRef.current.forEach((m) => {
        m.map = null
      })
      zonePolysRef.current.forEach((item) => item.polygon.setMap(null))
      if (boundaryPolyRef.current) boundaryPolyRef.current.setMap(null)
    }
  }, [])

  // 2. Cached + Multi-sector Google Places search & boundary filtering
  useEffect(() => {
    if (!category || !analysisRunId || !mapReady) return

    let cancelled = false

    function renderMarkers(uniquePlaces) {
      const AdvancedMarkerElement = markerClassRef.current
      const PinElement = pinClassRef.current

      infoWindowRef.current?.close()
      markersRef.current.forEach((m) => {
        m.map = null
      })
      markersRef.current = []

      uniquePlaces.forEach((place) => {
        const pin = new PinElement({
          background: '#2563EB',
          borderColor: '#1E3A8A',
          glyphColor: '#FFFFFF',
          scale: 0.95,
        })

        const marker = new AdvancedMarkerElement({
          map: showMarkersRef.current ? mapInstance.current : null,
          position: { lat: place.lat, lng: place.lng },
          title: place.name,
          content: pin.element,
          zIndex: 20,
        })

        marker.addListener('click', () => {
          infoWindowRef.current.setContent(`
            <div style="font-family:Inter,sans-serif;max-width:230px;padding:4px 2px;color:#0F172A;">
              <div style="font-weight:700;font-size:13.5px;margin-bottom:4px;">${place.name}</div>
              <div style="font-size:12px;color:#475569;line-height:1.4;">${place.address}</div>
            </div>
          `)
          infoWindowRef.current.open({
            anchor: marker,
            map: mapInstance.current,
          })
        })

        markersRef.current.push(marker)
      })
    }

    async function searchPlaces() {
      try {
        callbacksRef.current.onStepChange?.(1)

        // Check browser session cache first
        let uniquePlaces = readClientCache(category)

        // Check shared server in-memory cache second
        if (!uniquePlaces) {
          try {
            const cacheRes = await fetch(`/api/places-cache/${encodeURIComponent(category)}`)
            if (cacheRes.ok) {
              const cacheJson = await cacheRes.json()
              if (cacheJson.cached && Array.isArray(cacheJson.places)) {
                uniquePlaces = cacheJson.places
                writeClientCache(category, uniquePlaces)
              }
            }
          } catch {
            // Ignore cache fetch errors and fall back to Google Places
          }
        }

        if (cancelled) return

        if (uniquePlaces) {
          callbacksRef.current.onStepChange?.(2)
          renderMarkers(uniquePlaces)
          callbacksRef.current.onPlacesFound?.(uniquePlaces)
          return
        }

        const Place = placeClassRef.current
        const catObj = BUSINESS_CATEGORIES.find((c) => c.id === category)
        const queryTerm = catObj ? catObj.queryTerm : category
        const sectors = getSearchSectors(NANDED_CITY_BOUNDARY)

        const settled = await Promise.allSettled(
          sectors.map((sector) => querySectorPlaces(Place, queryTerm, sector)),
        )
        if (cancelled) return

        const fulfilled = settled.filter((r) => r.status === 'fulfilled')
        if (fulfilled.length === 0) {
          const rawMsg = settled[0]?.reason?.message || 'Google Places API request failed.'
          if (rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('Quota exceeded')) {
            throw new Error(
              'Daily Google Places API search quota has been reached for today. Quota resets at ~1:30 PM IST (Midnight PT), or you can raise SearchTextRequest per day in Google Cloud Console.',
            )
          }
          throw new Error(rawMsg)
        }

        callbacksRef.current.onStepChange?.(2)

        const dedupedMap = new globalThis.Map()

        for (const result of fulfilled) {
          const placesList = result.value?.places || []
          for (const place of placesList) {
            if (!place.location) continue

            const lat =
              typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat
            const lng =
              typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng

            if (!isInsideBoundary({ lat, lng }, NANDED_CITY_BOUNDARY)) continue

            const name = getPlaceName(place)
            const dedupeKey =
              place.id || `${name.toLowerCase()}::${lat.toFixed(4)}::${lng.toFixed(4)}`

            if (!dedupedMap.has(dedupeKey)) {
              dedupedMap.set(dedupeKey, {
                id: dedupeKey,
                name,
                address: place.formattedAddress || 'Address not listed',
                lat,
                lng,
                rating: null,
                userRatingCount: null,
              })
            }
          }
        }

        uniquePlaces = Array.from(dedupedMap.values())

        if (uniquePlaces.length > 0) {
          writeClientCache(category, uniquePlaces)
          fetch(`/api/places-cache/${encodeURIComponent(category)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ places: uniquePlaces }),
          }).catch(() => {})
        }

        renderMarkers(uniquePlaces)
        callbacksRef.current.onPlacesFound?.(uniquePlaces)
      } catch (error) {
        if (!cancelled) {
          console.error('Google Places search failed:', error)
          callbacksRef.current.onAnalysisError?.(
            error.message || 'Failed to fetch business data from Google Places.',
          )
        }
      }
    }

    searchPlaces()

    return () => {
      cancelled = true
    }
  }, [category, analysisRunId, mapReady])

  // 3. Render & update Zone Polygons on Google Maps
  useEffect(() => {
    if (!mapReady || !mapsLibRef.current) return

    const { Polygon } = mapsLibRef.current

    zonePolysRef.current.forEach((item) => item.polygon.setMap(null))
    zonePolysRef.current = []

    if (!zones || zones.length === 0) return

    zones.forEach((zone) => {
      const style = ZONE_COLORS[zone.presenceLevel] || ZONE_COLORS.Low
      const isSelected = zone.id === selectedZoneId

      const polygon = new Polygon({
        paths: zone.polygon,
        strokeColor: isSelected ? '#0F172A' : style.stroke,
        strokeOpacity: isSelected ? 1 : 0.85,
        strokeWeight: isSelected ? 3.5 : 1.8,
        fillColor: style.fill,
        fillOpacity: isSelected ? style.fillOpacity + 0.16 : style.fillOpacity,
        zIndex: isSelected ? 10 : 5,
        map: showZones ? mapInstance.current : null,
      })

      polygon.addListener('click', () => {
        callbacksRef.current.onSelectZone?.(zone.id)
      })

      zonePolysRef.current.push({ id: zone.id, polygon, presenceLevel: zone.presenceLevel })
    })
  }, [zones, selectedZoneId, showZones, mapReady])

  // 4. Toggle markers & boundary visibility without re-querying API
  useEffect(() => {
    if (!mapReady) return
    markersRef.current.forEach((marker) => {
      marker.map = showMarkers ? mapInstance.current : null
    })
  }, [showMarkers, mapReady])

  useEffect(() => {
    if (!mapReady || !boundaryPolyRef.current) return
    boundaryPolyRef.current.setMap(showBoundary ? mapInstance.current : null)
  }, [showBoundary, mapReady])

  return (
    <div className="map-wrapper">
      {!mapReady && !mapLoadError && <MapBootLoader />}
      {mapLoadError && (
        <div className="map-error-state">
          <h4>Map Initialization Error</h4>
          <p>{mapLoadError}</p>
        </div>
      )}
      <div ref={mapRef} className="google-map" />
    </div>
  )
}

export default NandedMap