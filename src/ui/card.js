import { h, icon } from './dom.js'
import { initials, avatarColor, getStage, nextStageId, DONE_STAGE, daysIdle, STALE_DAYS, personKey } from '../model.js'
import { plural, relativeTime } from './format.js'

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
 * A board card. An `<article>` so nested controls can be real buttons
 * (nested buttons are invalid HTML). Enter/Space on the card still open it.
 */
export function renderCard(card, { onOpen, onAdvance, onClaim, onFilterTag, onFilterStale, me = '' }) {
  const stage = getStage(card.status)
  const hasTitle = card.title.trim().length > 0
  const next = nextStageId(card.status)
  const idle = daysIdle(card.updated_at)
  const stale = card.status !== DONE_STAGE && idle >= STALE_DAYS
  const age = relativeTime(card.updated_at)
  const mine = Boolean(me) && card.assignees.some((a) => personKey(a) === personKey(me))

  const meta = h('div', { class: 'card__meta' })
  if (card.tag) {
    meta.appendChild(
      onFilterTag
        ? h('button', {
            class: 'tag tag--btn',
            type: 'button',
            title: `Filter by ${card.tag}`,
            text: card.tag,
            onclick: (e) => {
              e.stopPropagation()
              onFilterTag(card.tag)
            },
          })
        : h('span', { class: 'tag', title: card.tag, text: card.tag }),
    )
  }
  if (age) {
    const staleTitle = stale ? `No movement in ${idle} days` : `Updated ${age}`
    meta.appendChild(
      stale && onFilterStale
        ? h('button', {
            class: 'badge badge--stale badge--btn',
            type: 'button',
            title: `${staleTitle}. Filter idle cards`,
            text: age,
            onclick: (e) => {
              e.stopPropagation()
              onFilterStale()
            },
          })
        : h('span', {
            class: `badge${stale ? ' badge--stale' : ''}`,
            title: staleTitle,
            text: age,
          }),
    )
  }
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
  if (me && !mine && onClaim) {
    meta.appendChild(
      h('button', {
        class: 'card__take',
        type: 'button',
        title: card.assignees.length ? `Join as ${me}` : `Take this as ${me}`,
        'aria-label': card.assignees.length ? `Join as ${me}` : `Take this as ${me}`,
        text: card.assignees.length ? 'Join' : 'Take',
        onclick: (e) => {
          e.stopPropagation()
          onClaim(card.id)
        },
      }),
    )
  }
  if (next && onAdvance) {
    const dest = getStage(next)
    meta.appendChild(
      h(
        'button',
        {
          class: 'card__advance',
          type: 'button',
          title: `Move to ${dest.name}`,
          'aria-label': `Move to ${dest.name}`,
          onclick: (e) => {
            e.stopPropagation()
            onAdvance(card.id)
          },
        },
        icon('arrow'),
      ),
    )
  }

  return h(
    'article',
    {
      class: `card${stale ? ' is-stale' : ''}`,
      tabindex: '0',
      dataset: { id: card.id, status: card.status, pos: card.position },
      style: { '--dot': `var(--stage-${stage.id})` },
      'aria-label': `${hasTitle ? card.title : 'Untitled card'} — ${stage.name}`,
      onclick: (e) => {
        if (e.target.closest('button')) return
        onOpen(card.id, e)
      },
      onkeydown: (e) => {
        if (e.target.closest('button')) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(card.id, e)
        }
      },
    },
    h('p', {
      class: `card__title${hasTitle ? '' : ' card__title--empty'}`,
      text: hasTitle ? card.title : 'Untitled',
    }),
    meta,
  )
}
