import { describe, it, expect, vi } from 'vitest'
import { createUndoStack, createTextHistory, kindFromInputType } from '../src/undo.js'

describe('createUndoStack', () => {
  it('runs the most recent action first', async () => {
    const seen = []
    const stack = createUndoStack()
    stack.push(() => seen.push('a'))
    stack.push(() => seen.push('b'))
    expect(await stack.undo()).toBe(true)
    expect(await stack.undo()).toBe(true)
    expect(seen).toEqual(['b', 'a'])
    expect(await stack.undo()).toBe(false)
  })

  it('drops the oldest entry past the limit', async () => {
    const stack = createUndoStack(2)
    const seen = []
    stack.push(() => seen.push(1))
    stack.push(() => seen.push(2))
    stack.push(() => seen.push(3))
    await stack.undo()
    await stack.undo()
    await stack.undo()
    expect(seen).toEqual([3, 2])
  })
})

describe('kindFromInputType', () => {
  it('groups typing, deletes, pastes and newlines', () => {
    expect(kindFromInputType('insertText')).toBe('type')
    expect(kindFromInputType('deleteContentBackward')).toBe('delete')
    expect(kindFromInputType('insertFromPaste')).toBe('paste')
    expect(kindFromInputType('insertLineBreak')).toBe('newline')
    expect(kindFromInputType('historyUndo')).toBeNull()
  })
})

describe('createTextHistory', () => {
  const snap = (over = {}) => ({
    title: '',
    body: 'hello',
    start: 5,
    end: 5,
    field: 'body',
    kind: 'type',
    ...over,
  })

  it('restores the recorded snapshot and supports redo', () => {
    const hist = createTextHistory()
    hist.record(snap({ body: 'hel' }))
    const undone = hist.undo(snap({ body: 'hello' }))
    expect(undone.body).toBe('hel')
    const redone = hist.redo(snap({ body: 'hel' }))
    expect(redone.body).toBe('hello')
  })

  it('merges consecutive typing in the coalesce window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const hist = createTextHistory({ coalesceMs: 1000 })
    hist.record(snap({ body: '', start: 0, end: 0 }))
    vi.setSystemTime(200)
    hist.record(snap({ body: 'h', start: 1, end: 1 }))
    vi.setSystemTime(400)
    hist.record(snap({ body: 'he', start: 2, end: 2 }))
    expect(hist.undoLength).toBe(1)
    expect(hist.undo(snap({ body: 'hel' })).body).toBe('')
    vi.useRealTimers()
  })

  it('does not merge indent with typing', () => {
    const hist = createTextHistory()
    hist.record(snap({ kind: 'type' }))
    hist.record(snap({ kind: 'indent', body: 'hello world' }))
    expect(hist.undoLength).toBe(2)
  })

  it('clears redo after a new edit', () => {
    const hist = createTextHistory()
    hist.record(snap({ body: 'a' }))
    hist.undo(snap({ body: 'ab' }))
    expect(hist.redoLength).toBe(1)
    hist.record(snap({ body: 'a', kind: 'type' }))
    expect(hist.redoLength).toBe(0)
  })
})
