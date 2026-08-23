/** Infinite-canvas camera. Screen points are client coordinates; world points
 *  are what objects store. The world node is `translate(x,y) scale(zoom)`
 *  with transform-origin 0 0. */

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 4

export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

export function screenToWorld(clientX, clientY, camera, rect) {
  return {
    x: (clientX - rect.left - camera.x) / camera.zoom,
    y: (clientY - rect.top - camera.y) / camera.zoom,
  }
}

/** Zoom keeping the world point under the cursor fixed. */
export function zoomAt(camera, clientX, clientY, factor, rect) {
  const world = screenToWorld(clientX, clientY, camera, rect)
  const zoom = clampZoom(camera.zoom * factor)
  return {
    x: clientX - rect.left - world.x * zoom,
    y: clientY - rect.top - world.y * zoom,
    zoom,
  }
}

export function panBy(camera, dx, dy) {
  return { ...camera, x: camera.x + dx, y: camera.y + dy }
}
