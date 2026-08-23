import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDetail } from '../src/ui/detail.js'
import { normalizeCard, makeNote } from '../src/model.js'
import {
  installShell, teardownShell, click, type, press,
  buttonWithText, answerDialog, dialogIsOpen,
} from './helpers/shell.js'

const AUTOSAVE_MS = 450

function setup(cardProps = {}, overrides = {}) {
  const card = normalizeCard({ id: 'c1', title: 'Fix the export', tag: 'billing', ...cardProps })
  const onPatch = vi.fn(async (id, patch) => normalizeCard({ ...card, ...patch }))
  const onDelete = vi.fn(async () => {})
  const onError = vi.fn()

  const detail = createDetail({
    identity: { name: 'Sam Rivera', isDefault: false },
    onPatch,
    onDelete,
    onError,
    makeNote: (text) => makeNote('Sam Rivera', text),
    getPeople: () => [{ name: 'Alex Chen', count: 2 }],
    getTags: () => [{ tag: 'infra', count: 3 }],
    positionForStage: () => 9000,
    ...overrides,
  })

  detail.open(card)
  return { detail, card, onPatch, onDelete, onError }
}

const panel = () => document.querySelector('#detail-root .drawer')
const field = (label) => {
  const groups = [...panel().querySelectorAll('.field')]
  const group = groups.find((g) => g.querySelector('.field__label')?.textContent.trim() === label)
  return group?.querySelector('input, textarea')
}
const titleInput = () => panel().querySelector('.title-input')
const stageButton = (name) => buttonWithText(panel().querySelector('.stage-picker'), name)

beforeEach(() => {
  installShell()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  teardownShell()
})

describe('opening', () => {
  it('renders the card into the drawer', () => {
    setup()
    expect(panel()).toBeTruthy()
    expect(titleInput().value).toBe('Fix the export')
    expect(field('Tag').value).toBe('billing')
  })

  it('shows the current stage as the eyebrow and the pressed button', () => {
    setup({ status: 'progress' })
    expect(panel().querySelector('.drawer__eyebrow').textContent).toBe('In progress')
    expect(stageButton('In progress').getAttribute('aria-pressed')).toBe('true')
    expect(stageButton('Done').getAttribute('aria-pressed')).toBe('false')
  })

  it('reports the id it currently has open', () => {
    const { detail } = setup()
    expect(detail.currentId).toBe('c1')
  })

  it('opening a second card replaces the first rather than stacking drawers', () => {
    const { detail } = setup()
    detail.open(normalizeCard({ id: 'c2', title: 'Another' }))
    expect(document.querySelectorAll('#detail-root .drawer')).toHaveLength(1)
    expect(detail.currentId).toBe('c2')
  })

  it('copies a deep link to the card', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    setup()
    click(buttonWithText(panel(), 'Copy link'))
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toMatch(/#c\/c1$/)
    expect(buttonWithText(panel(), 'Copied')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

describe('text autosave', () => {
  it('waits for the typing to stop before writing', async () => {
    const { onPatch } = setup()

    type(titleInput(), 'Fix the export n')
    type(titleInput(), 'Fix the export now')
    expect(onPatch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(onPatch).toHaveBeenCalledTimes(1)
    expect(onPatch).toHaveBeenCalledWith('c1', { title: 'Fix the export now' })
  })

  it('coalesces edits to several fields into one write', async () => {
    const { onPatch } = setup()

    type(titleInput(), 'New title')
    type(field('Tag'), 'infra')
    type(field('Description'), 'Some detail')

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(onPatch).toHaveBeenCalledTimes(1)
    expect(onPatch).toHaveBeenCalledWith('c1', {
      title: 'New title',
      tag: 'infra',
      body: 'Some detail',
    })
  })

  it('trims the tag', async () => {
    const { onPatch } = setup()
    type(field('Tag'), '  infra  ')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(onPatch).toHaveBeenCalledWith('c1', { tag: 'infra' })
  })

  it('writes immediately on Enter in the title instead of inserting a newline', async () => {
    const { onPatch } = setup()
    type(titleInput(), 'Done typing')
    const notPrevented = press(titleInput(), 'Enter')

    expect(notPrevented).toBe(false) // preventDefault was called
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).toHaveBeenCalledWith('c1', { title: 'Done typing' })
  })

  it('flushes a pending edit when the drawer closes', async () => {
    const { detail, onPatch } = setup()
    type(titleInput(), 'Half typed')

    await detail.close()
    expect(onPatch).toHaveBeenCalledWith('c1', { title: 'Half typed' })
  })

  it('shows a saved indicator, then settles back to idle', async () => {
    setup()
    const saved = () => panel().querySelector('.drawer__saved')

    type(titleInput(), 'x')
    expect(saved().dataset.state).toBe('saving')

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
    expect(saved().dataset.state).toBe('saved')

    await vi.advanceTimersByTimeAsync(2000)
    expect(saved().dataset.state).toBe('idle')
  })

  it('surfaces a failed write instead of pretending it saved', async () => {
    const onPatch = vi.fn(async () => {
      throw new Error('network down')
    })
    setup({}, { onPatch })

    type(titleInput(), 'x')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)

    expect(panel().querySelector('.drawer__saved').dataset.state).toBe('error')
  })
})

describe('stage buttons', () => {
  it('moves the card and gives it a position in the new column', async () => {
    const { onPatch } = setup({ status: 'problem' })
    click(stageButton('Done'))
    await vi.advanceTimersByTimeAsync(0)

    expect(onPatch).toHaveBeenCalledWith('c1', { status: 'done', position: 9000 })
  })

  it('does nothing when the card is already in that stage', async () => {
    const { onPatch } = setup({ status: 'done' })
    click(stageButton('Done'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('flushes a pending text edit before moving, so neither write is lost', async () => {
    const { onPatch } = setup({ status: 'problem' })
    type(titleInput(), 'Renamed')
    click(stageButton('Idea'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)

    expect(onPatch).toHaveBeenCalledTimes(2)
    expect(onPatch.mock.calls[0][1]).toEqual({ title: 'Renamed' })
    expect(onPatch.mock.calls[1][1]).toMatchObject({ status: 'idea' })
  })
})

describe('assignees', () => {
  const addInput = () => panel().querySelector('.field__row input')

  it('adds a person on Enter', async () => {
    const { onPatch } = setup({ assignees: [] })
    addInput().value = 'Jo Park'
    press(addInput(), 'Enter')
    await vi.advanceTimersByTimeAsync(0)

    expect(onPatch).toHaveBeenCalledWith('c1', { assignees: ['Jo Park'] })
    expect(addInput().value).toBe('')
  })

  it('ignores a blank name', async () => {
    const { onPatch } = setup({ assignees: [] })
    addInput().value = '   '
    press(addInput(), 'Enter')
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('refuses a duplicate, whatever the casing', async () => {
    const { onPatch } = setup({ assignees: ['Jo Park'] })
    addInput().value = 'jo park'
    press(addInput(), 'Enter')
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('removes a person from their chip', async () => {
    const { onPatch } = setup({ assignees: ['Jo Park', 'Alex Chen'] })
    click(panel().querySelector('.chip__x'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).toHaveBeenCalledWith('c1', { assignees: ['Alex Chen'] })
  })

  it('offers "Assign to me" until you are on the card', async () => {
    const { detail, card } = setup({ assignees: [] })
    expect(buttonWithText(panel().querySelector('.suggest'), 'Assign to me')).toBeTruthy()

    detail.update(normalizeCard({ ...card, assignees: ['Sam Rivera'] }))
    expect(buttonWithText(panel().querySelector('.suggest'), 'Assign to me')).toBeUndefined()
  })

  it('suggests people already on the board, minus those already on this card', () => {
    setup({ assignees: ['Alex Chen'] })
    const labels = [...panel().querySelectorAll('.suggest__btn')].map((b) => b.textContent.trim())
    expect(labels).not.toContain('Alex Chen')
  })

  it('shows a placeholder when nobody is assigned', () => {
    setup({ assignees: [] })
    expect(panel().querySelector('.chips').textContent).toMatch(/nobody yet/i)
  })
})

describe('notes', () => {
  const noteBox = () => panel().querySelector('.note-compose textarea')
  const postBtn = () => buttonWithText(panel(), 'Post note')

  it('starts with the post button disabled', () => {
    setup()
    expect(postBtn().disabled).toBe(true)
  })

  it('enables the post button once there is text', () => {
    setup()
    type(noteBox(), 'hello')
    expect(postBtn().disabled).toBe(false)
  })

  it('appends a note with the current author', async () => {
    const { onPatch } = setup({ notes: [] })
    type(noteBox(), 'Reproduced on staging')
    click(postBtn())
    await vi.advanceTimersByTimeAsync(0)

    const [, patch] = onPatch.mock.calls[0]
    expect(patch.notes).toHaveLength(1)
    expect(patch.notes[0]).toMatchObject({ author: 'Sam Rivera', text: 'Reproduced on staging' })
  })

  it('appends rather than replacing the existing thread', async () => {
    const existing = makeNote('Alex Chen', 'first')
    const { onPatch } = setup({ notes: [existing] })
    type(noteBox(), 'second')
    click(postBtn())
    await vi.advanceTimersByTimeAsync(0)

    const [, patch] = onPatch.mock.calls[0]
    expect(patch.notes.map((n) => n.text)).toEqual(['first', 'second'])
  })

  it('posts on Ctrl+Enter', async () => {
    const { onPatch } = setup({ notes: [] })
    type(noteBox(), 'quick note')
    press(noteBox(), 'Enter', { ctrlKey: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).toHaveBeenCalled()
  })

  it('ignores plain Enter so multi-line notes are possible', async () => {
    const { onPatch } = setup({ notes: [] })
    type(noteBox(), 'line one')
    press(noteBox(), 'Enter')
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('will not post whitespace', async () => {
    const { onPatch } = setup({ notes: [] })
    type(noteBox(), '    ')
    click(postBtn())
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('clears the box after posting', async () => {
    setup({ notes: [] })
    type(noteBox(), 'done')
    click(postBtn())
    await vi.advanceTimersByTimeAsync(0)
    expect(noteBox().value).toBe('')
  })

  it('renders the thread with author and text', () => {
    setup({ notes: [makeNote('Alex Chen', 'Looked into it')] })
    const note = panel().querySelector('.note')
    expect(note.querySelector('.note__author').textContent).toBe('Alex Chen')
    expect(note.querySelector('.note__text').textContent).toBe('Looked into it')
  })

  it('offers delete only on your own notes', () => {
    setup({ notes: [makeNote('Sam Rivera', 'mine'), makeNote('Alex Chen', 'theirs')] })
    const notes = [...panel().querySelectorAll('.note')]
    expect(notes[0].querySelector('.note__del')).toBeTruthy()
    expect(notes[1].querySelector('.note__del')).toBeNull()
  })

  it('confirms before deleting a note', async () => {
    const mine = makeNote('Sam Rivera', 'mine')
    const { onPatch } = setup({ notes: [mine] })

    click(panel().querySelector('.note__del'))
    await vi.advanceTimersByTimeAsync(0)
    expect(dialogIsOpen()).toBe(true)

    answerDialog('Delete')
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).toHaveBeenCalledWith('c1', { notes: [] })
  })

  it('keeps the note when the confirm is cancelled', async () => {
    const { onPatch } = setup({ notes: [makeNote('Sam Rivera', 'mine')] })
    click(panel().querySelector('.note__del'))
    await vi.advanceTimersByTimeAsync(0)
    answerDialog('Cancel')
    await vi.advanceTimersByTimeAsync(0)
    expect(onPatch).not.toHaveBeenCalled()
  })
})

describe('remote updates', () => {
  it('refreshes a field the user is not editing', () => {
    const { detail, card } = setup()
    titleInput().blur() // open() focuses the title; step away from it first
    detail.update(normalizeCard({ ...card, title: 'Renamed elsewhere' }))
    expect(titleInput().value).toBe('Renamed elsewhere')
  })

  it('refreshes the other fields even while the title is focused', () => {
    const { detail, card } = setup()
    titleInput().focus()
    detail.update(normalizeCard({ ...card, tag: 'infra', body: 'new detail' }))
    expect(field('Tag').value).toBe('infra')
    expect(field('Description').value).toBe('new detail')
  })

  it('does NOT overwrite the field the user is typing in', () => {
    const { detail, card } = setup()
    titleInput().focus()
    type(titleInput(), 'my half-typed thought')

    detail.update(normalizeCard({ ...card, title: 'someone else wrote this' }))
    expect(titleInput().value).toBe('my half-typed thought')
  })

  it('still shows a note that arrived while the user was typing a title', () => {
    const { detail, card } = setup({ notes: [] })
    titleInput().focus()
    type(titleInput(), 'typing')

    detail.update(normalizeCard({ ...card, notes: [makeNote('Alex Chen', 'incoming')] }))
    expect(panel().querySelector('.note__text').textContent).toBe('incoming')
    expect(titleInput().value).toBe('typing')
  })

  it('ignores an update for a different card', () => {
    const { detail } = setup()
    detail.update(normalizeCard({ id: 'other', title: 'Not this one' }))
    expect(titleInput().value).toBe('Fix the export')
  })

  it('closes and explains when the open card is deleted by someone else', () => {
    const { detail, onError } = setup()
    detail.notifyRemoved('c1')
    expect(panel()).toBeNull()
    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0].message).toMatch(/deleted by someone else/i)
  })

  it('ignores a removal notice for a card it does not have open', () => {
    const { detail, onError } = setup()
    detail.notifyRemoved('some-other-card')
    expect(panel()).toBeTruthy()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('deleting the card', () => {
  it('asks first', async () => {
    const { onDelete } = setup()
    click(buttonWithText(panel(), 'Delete'))
    await vi.advanceTimersByTimeAsync(0)

    expect(dialogIsOpen()).toBe(true)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('deletes and closes on confirm', async () => {
    const { onDelete } = setup()
    click(buttonWithText(panel(), 'Delete'))
    await vi.advanceTimersByTimeAsync(0)
    answerDialog('Delete')
    await vi.advanceTimersByTimeAsync(0)

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0][0].id).toBe('c1')
    expect(panel()).toBeNull()
  })

  it('does nothing on cancel', async () => {
    const { onDelete } = setup()
    click(buttonWithText(panel(), 'Delete'))
    await vi.advanceTimersByTimeAsync(0)
    answerDialog('Cancel')
    await vi.advanceTimersByTimeAsync(0)

    expect(onDelete).not.toHaveBeenCalled()
    expect(panel()).toBeTruthy()
  })
})

describe('closing', () => {
  it('closes on Escape', async () => {
    const { detail } = setup()
    press(panel(), 'Escape')
    await vi.advanceTimersByTimeAsync(0)
    expect(panel()).toBeNull()
    expect(detail.currentId).toBeNull()
  })

  it('closes on a scrim click', async () => {
    setup()
    click(document.querySelector('.drawer-scrim'))
    await vi.advanceTimersByTimeAsync(0)
    expect(panel()).toBeNull()
  })

  it('does not close when the click is inside the panel', async () => {
    setup()
    click(panel())
    await vi.advanceTimersByTimeAsync(0)
    expect(panel()).toBeTruthy()
  })

  it('is safe to close twice', async () => {
    const { detail } = setup()
    await detail.close()
    await expect(detail.close()).resolves.not.toThrow()
  })
})
