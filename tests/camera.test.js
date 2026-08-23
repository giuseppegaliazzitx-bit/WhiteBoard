import { describe, it, expect } from 'vitest'
import { screenToWorld, zoomAt, panBy, clampZoom, MIN_ZOOM, MAX_ZOOM } from '../src/camera.js'

const rect = { left: 100, top: 50, width: 800, height: 600 }

describe('screenToWorld', () => {
  it('is the identity at origin with zoom 1', () => {
    expect(screenToWorld(100, 50, { x: 0, y: 0, zoom: 1 }, rect)).toEqual({ x: 0, y: 0 })
    expect(screenToWorld(140, 90, { x: 0, y: 0, zoom: 1 }, rect)).toEqual({ x: 40, y: 40 })
  })

  it('accounts for pan and zoom', () => {
    const world = screenToWorld(100 + 40, 50 + 20, { x: 10, y: 10, zoom: 2 }, rect)
    expect(world.x).toBe((40 - 10) / 2)
    expect(world.y).toBe((20 - 10) / 2)
  })
})

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const camera = { x: 20, y: 10, zoom: 1 }
    const cx = 180
    const cy = 90
    const before = screenToWorld(cx, cy, camera, rect)
    const afterCam = zoomAt(camera, cx, cy, 2, rect)
    const after = screenToWorld(cx, cy, afterCam, rect)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(afterCam.zoom).toBe(2)
  })

  it('clamps zoom', () => {
    const camera = { x: 0, y: 0, zoom: 1 }
    expect(zoomAt(camera, 100, 50, 100, rect).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(camera, 100, 50, 0.001, rect).zoom).toBe(MIN_ZOOM)
  })
})

describe('panBy', () => {
  it('shifts the camera without changing zoom', () => {
    expect(panBy({ x: 10, y: 20, zoom: 1.5 }, 5, -8)).toEqual({ x: 15, y: 12, zoom: 1.5 })
  })
})

describe('clampZoom', () => {
  it('pins to the range', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(1)).toBe(1)
  })
})
