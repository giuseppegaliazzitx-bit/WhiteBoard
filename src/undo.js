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

const COALESCE_KINDS = new Set(['type', 'delete'])

/**
 * Typing history like a document: consecutive keystrokes merge into one
 * step, caret is restored, and redo is available until the next edit.
 */
export function createTextHistory({ limit = 100, coalesceMs = 1000 } = {}) {
  const undo = []
  const redo = []

  function copy(snapshot, kind = snapshot.kind) {
    return {
      title: String(snapshot.title ?? ''),
      body: String(snapshot.body ?? ''),
      start: Number(snapshot.start) || 0,
      end: Number(snapshot.end) || 0,
      field: snapshot.field === 'title' ? 'title' : 'body',
      kind,
      at: snapshot.at || 0,
    }
  }

  function canCoalesce(last, next, now) {
    if (!last) return false
    if (last.kind !== next.kind || last.field !== next.field) return false
    if (!COALESCE_KINDS.has(next.kind)) return false
    return now - last.at <= coalesceMs
  }

  return {
    /**
     * Record the state *before* a change. Coalesced typing keeps the
     * original snapshot so one Ctrl+Z drops the whole burst.
     */
    record(snapshot, now = Date.now()) {
      if (!snapshot || !snapshot.kind) return
      const next = copy(snapshot)
      next.at = now
      const last = undo[undo.length - 1]
      if (canCoalesce(last, next, now)) {
        last.at = now
        redo.length = 0
        return
      }
      undo.push(next)
      while (undo.length > limit) undo.shift()
      redo.length = 0
    },

    undo(current) {
      const snap = undo.pop()
      if (!snap) return null
      if (current) redo.push(copy(current, 'redo'))
      return snap
    },

    redo(current) {
      const snap = redo.pop()
      if (!snap) return null
      if (current) undo.push(copy(current, 'redo'))
      return snap
    },

    get undoLength() {
      return undo.length
    },

    get redoLength() {
      return redo.length
    },

    clear() {
      undo.length = 0
      redo.length = 0
    },
  }
}

/** Map an InputEvent.inputType to a history kind, or null to ignore. */
export function kindFromInputType(type) {
  const src = String(type || '')
  if (!src || src.startsWith('history')) return null
  if (src.startsWith('insertFromPaste') || src === 'insertFromDrop' || src === 'insertReplacementText') return 'paste'
  if (src.startsWith('delete') || src === 'deleteByCut' || src === 'deleteByDrag') return 'delete'
  if (src === 'insertLineBreak' || src === 'insertParagraph') return 'newline'
  if (src.startsWith('insert')) return 'type'
  return 'edit'
}
