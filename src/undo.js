/** Small local undo stack. Callers pass a function that reverses one action. */
export function createUndoStack(limit = 40) {
  const items = []
  return {
    push(undo) {
      if (typeof undo !== 'function') return
      items.push(undo)
      while (items.length > limit) items.shift()
    },
    async undo() {
      const fn = items.pop()
      if (!fn) return false
      await fn()
      return true
    },
    get length() {
      return items.length
    },
    clear() {
      items.length = 0
    },
  }
}
