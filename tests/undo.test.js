import { describe, it, expect } from 'vitest'
import { createUndoStack } from '../src/undo.js'

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
