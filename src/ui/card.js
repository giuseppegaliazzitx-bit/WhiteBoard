import { h, icon } from './dom.js'
import { initials, avatarColor, getStage } from '../model.js'
import { plural } from './format.js'

/** One avatar bubble. `title` gives the full name on hover for truncated initials. */
export function avatar(name, size = '') {
  return h('span', {
    class: `avatar ${size}`.trim(),
    style: { '--av': avatarColor(name) },
    title: name,
    'aria-hidden': 'true',
    text: initials(name),
  })
}

export function avatarStack(names, max = 3) {
  const shown = names.slice(0, max)
  const extra = names.length - shown.length
  return h(
    'span',
    { class: 'avatar-stack', 'aria-label': `Assigned to ${names.join(', ')}` },
    shown.map((n) => avatar(n)),
    extra > 0 &&
      h('span', {
        class: 'avatar',
        style: { '--av': 'var(--text-3)' },
        title: names.slice(max).join(', '),
        text: `+${extra}`,
      }),
  )
}

/**
 * A board card. Rendered as a real <button> so Enter/Space open it and screen
 * readers announce it correctly -- which is why nothing inside it is
 * interactive (nested interactive content is invalid and breaks both).
 */
export function renderCard(card, { onOpen }) {
  const stage = getStage(card.status)
  const hasTitle = card.title.trim().length > 0

  const meta = h('div', { class: 'card__meta' })
  if (card.tag) meta.appendChild(h('span', { class: 'tag', title: card.tag, text: card.tag }))
  meta.appendChild(h('span', { class: 'card__spacer' }))
  if (card.body.trim()) {
    meta.appendChild(
      h('span', { class: 'badge', title: 'Has a description' }, icon('text')),
    )
  }
  if (card.notes.length) {
    meta.appendChild(
      h(
        'span',
        { class: 'badge', title: plural(card.notes.length, 'note') },
        icon('note'),
        String(card.notes.length),
      ),
    )
  }
  if (card.assignees.length) meta.appendChild(avatarStack(card.assignees))

  return h(
    'button',
    {
      class: 'card',
      type: 'button',
      dataset: { id: card.id, status: card.status, pos: card.position },
      style: { '--dot': `var(--stage-${stage.id})` },
      'aria-label': `${hasTitle ? card.title : 'Untitled card'} — ${stage.name}`,
      onclick: (e) => onOpen(card.id, e),
    },
    h('p', {
      class: `card__title${hasTitle ? '' : ' card__title--empty'}`,
      text: hasTitle ? card.title : 'Untitled',
    }),
    meta,
  )
}
