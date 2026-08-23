import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderCard } from '../src/ui/card.js'
import { normalizeCard } from '../src/model.js'
import { click } from './helpers/shell.js'

function mount(props = {}, handlers = {}) {
  const card = normalizeCard({
    id: 'c1',
    title: 'Fix the export',
    tag: 'billing',
    status: 'idea',
    updated_at: new Date().toISOString(),
    ...props,
  })
  const onOpen = handlers.onOpen ?? vi.fn()
  const node = renderCard(card, { onOpen, ...handlers })
  document.body.appendChild(node)
  return { node, card, onOpen }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('renderCard', () => {
  it('opens on click, but not from a nested control', () => {
    const onAdvance = vi.fn()
    const { node, onOpen } = mount({}, { onAdvance })
    click(node)
    expect(onOpen).toHaveBeenCalledTimes(1)
    click(node.querySelector('.card__advance'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onAdvance).toHaveBeenCalledWith('c1')
  })

  it('offers Take when you are named and not on the card', () => {
    const onClaim = vi.fn()
    const { node } = mount({ assignees: [] }, { me: 'Sam Rivera', onClaim })
    const take = node.querySelector('.card__take')
    expect(take.textContent).toBe('Take')
    click(take)
    expect(onClaim).toHaveBeenCalledWith('c1')
  })

  it('offers Join when someone else already has it', () => {
    const { node } = mount({ assignees: ['Alex Chen'] }, { me: 'Sam Rivera', onClaim: vi.fn() })
    expect(node.querySelector('.card__take').textContent).toBe('Join')
  })

  it('hides Take when you are already assigned', () => {
    const { node } = mount({ assignees: ['Sam Rivera'] }, { me: 'Sam Rivera', onClaim: vi.fn() })
    expect(node.querySelector('.card__take')).toBeNull()
  })

  it('filters from the tag and from a stale age badge', () => {
    const onFilterTag = vi.fn()
    const onFilterStale = vi.fn()
    const { node } = mount(
      { tag: 'infra', status: 'progress', updated_at: new Date(Date.now() - 10 * 86400000).toISOString() },
      { onFilterTag, onFilterStale },
    )
    click(node.querySelector('.tag--btn'))
    expect(onFilterTag).toHaveBeenCalledWith('infra')
    click(node.querySelector('.badge--stale'))
    expect(onFilterStale).toHaveBeenCalledTimes(1)
  })

  it('does not show a next-stage chevron on Done cards', () => {
    const { node } = mount({ status: 'done' }, { onAdvance: vi.fn() })
    expect(node.querySelector('.card__advance')).toBeNull()
  })
})
