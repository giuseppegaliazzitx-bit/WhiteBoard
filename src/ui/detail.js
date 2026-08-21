import { h, clear, icon, iconButton } from './dom.js'
import { trapFocus } from './overlay.js'
import { avatar } from './card.js'
import { relativeTime, absoluteTime, plural } from './format.js'
import { STAGES, getStage, LIMITS, personKey } from '../model.js'
import { confirmDialog } from './modal.js'

/** Text fields save this long after the last keystroke. */
const AUTOSAVE_MS = 450

/**
 * The card detail drawer.
 *
 * Editing model: text fields autosave on a debounce, everything else
 * (stage, assignees, notes) saves immediately, because those are single
 * deliberate clicks where a delay reads as the click not registering.
 *
 * Remote updates are merged field by field and never overwrite an input the
 * user currently has focus in -- otherwise someone else's edit would eat your
 * half-typed sentence.
 */
export function createDetail(deps) {
  const root = document.getElementById('detail-root')
  let card = null
  let release = null
  let saveTimer = null
  let pending = {}
  let els = null

  function isOpen() {
    return card !== null
  }

  // ---------------------------------------------------------------- saving

  function setSaveState(state, message) {
    if (!els) return
    els.saved.dataset.state = state
    els.saved.textContent =
      message ||
      { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[state]
    if (state === 'saved') {
      setTimeout(() => {
        if (els?.saved.dataset.state === 'saved') setSaveState('idle')
      }, 1600)
    }
  }

  /** Queue a debounced patch (text fields). */
  function queue(patch) {
    Object.assign(pending, patch)
    setSaveState('saving')
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, AUTOSAVE_MS)
  }

  /** Send a patch right away (stage, assignees, notes). */
  async function commit(patch) {
    if (!card) return
    setSaveState('saving')
    try {
      await deps.onPatch(card.id, patch)
      setSaveState('saved')
    } catch (err) {
      setSaveState('error')
      deps.onError?.(err)
    }
  }

  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const patch = pending
    pending = {}
    if (!card || !Object.keys(patch).length) {
      if (els?.saved.dataset.state === 'saving') setSaveState('idle')
      return
    }
    await commit(patch)
  }

  // ---------------------------------------------------------------- build

  function autosize(textarea) {
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }

  function build() {
    const saved = h('span', { class: 'drawer__saved', dataset: { state: 'idle' }, 'aria-live': 'polite' })
    const eyebrow = h('span', { class: 'drawer__eyebrow' })

    const title = h('textarea', {
      class: 'title-input',
      rows: '1',
      placeholder: 'Untitled',
      maxlength: String(LIMITS.title),
      'aria-label': 'Card title',
      oninput: (e) => {
        autosize(e.target)
        queue({ title: e.target.value })
      },
      onkeydown: (e) => {
        // Enter commits rather than adding a newline; the title is one line.
        if (e.key === 'Enter') {
          e.preventDefault()
          flush()
          els.body.focus()
        }
      },
      onblur: flush,
    })

    const stagePicker = h('div', { class: 'stage-picker', role: 'group', 'aria-label': 'Stage' })
    const stageButtons = new Map()
    for (const stage of STAGES) {
      const btn = h(
        'button',
        {
          class: 'stage-btn',
          type: 'button',
          style: { '--dot': `var(--stage-${stage.id})` },
          title: stage.blurb,
          'aria-pressed': 'false',
          onclick: () => moveToStage(stage.id),
        },
        h('i'),
        h('span', { text: stage.name }),
      )
      stageButtons.set(stage.id, btn)
      stagePicker.appendChild(btn)
    }

    const tagList = h('datalist', { id: 'tag-suggestions' })
    const tag = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'billing, infra, web…',
      maxlength: String(LIMITS.tag),
      list: 'tag-suggestions',
      'aria-label': 'Tag',
      oninput: (e) => queue({ tag: e.target.value.trim() }),
      onblur: flush,
    })

    const body = h('textarea', {
      class: 'input',
      placeholder: 'Add more detail…',
      maxlength: String(LIMITS.body),
      'aria-label': 'Description',
      oninput: (e) => queue({ body: e.target.value }),
      onblur: flush,
    })

    const chips = h('div', { class: 'chips' })
    const assigneeInput = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'Add someone…',
      maxlength: String(LIMITS.assignee),
      autocomplete: 'off',
      'aria-label': 'Add an assignee',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          addAssignee(e.target.value)
          e.target.value = ''
        }
      },
    })
    const assigneeAdd = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        'aria-label': 'Add assignee',
        onclick: () => {
          addAssignee(assigneeInput.value)
          assigneeInput.value = ''
          assigneeInput.focus()
        },
      },
      icon('plus'),
    )
    const suggestions = h('div', { class: 'suggest' })

    const notes = h('div', { class: 'notes' })
    const notesLabel = h('label', { class: 'field__label' })
    const noteInput = h('textarea', {
      class: 'input',
      placeholder: 'Add a note…',
      rows: '2',
      maxlength: String(LIMITS.note),
      'aria-label': 'New note',
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          postNote()
        }
      },
      oninput: () => {
        notePost.disabled = !noteInput.value.trim()
      },
    })
    const notePost = h('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: 'Post note',
      disabled: true,
      onclick: postNote,
    })

    const stamp = h('span', { class: 'drawer__stamp' })

    const panel = h(
      'aside',
      {
        class: 'drawer',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Card detail',
        onclick: (e) => e.stopPropagation(),
      },
      h(
        'header',
        { class: 'drawer__head' },
        eyebrow,
        saved,
        iconButton('close', 'Close (Esc)', () => close()),
      ),
      h(
        'div',
        { class: 'drawer__body' },
        title,
        h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Stage' }), stagePicker),
        h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Tag' }), tag, tagList),
        h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Description' }), body),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field__label', text: 'Assignees' }),
          chips,
          h('div', { class: 'field__row', style: { 'margin-top': '7px' } }, assigneeInput, assigneeAdd),
          suggestions,
        ),
        h(
          'div',
          { class: 'field' },
          notesLabel,
          notes,
          h(
            'div',
            { class: 'note-compose' },
            noteInput,
            h(
              'div',
              { class: 'note-compose__foot' },
              notePost,
              h(
                'span',
                { class: 'note-compose__hint' },
                h('kbd', { text: navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl' }),
                ' + ',
                h('kbd', { text: 'Enter' }),
              ),
            ),
          ),
        ),
      ),
      h(
        'footer',
        { class: 'drawer__foot' },
        h(
          'button',
          { class: 'btn btn--danger', type: 'button', onclick: requestDelete },
          icon('trash'),
          h('span', { text: 'Delete' }),
        ),
        stamp,
      ),
    )

    const scrim = h('div', { class: 'drawer-scrim', onclick: () => close() })

    els = {
      panel, scrim, saved, eyebrow, title, stageButtons, tag, tagList, body,
      chips, assigneeInput, suggestions, notes, notesLabel, noteInput, notePost, stamp,
    }
    return els
  }

  // ---------------------------------------------------------------- actions

  async function moveToStage(status) {
    if (!card || card.status === status) return
    await flush()
    // Land at the bottom of the destination column, like a fresh arrival.
    await commit({ status, position: deps.positionForStage(status, card.id) })
  }

  function addAssignee(raw) {
    const name = String(raw || '').trim().slice(0, LIMITS.assignee)
    if (!card || !name) return
    if (card.assignees.some((a) => personKey(a) === personKey(name))) return
    if (card.assignees.length >= LIMITS.assignees) {
      deps.onError?.(new Error(`A card can hold ${LIMITS.assignees} assignees.`))
      return
    }
    commit({ assignees: [...card.assignees, name] })
  }

  function removeAssignee(name) {
    if (!card) return
    commit({ assignees: card.assignees.filter((a) => personKey(a) !== personKey(name)) })
  }

  async function postNote() {
    const text = els.noteInput.value.trim()
    if (!card || !text) return
    els.noteInput.value = ''
    els.notePost.disabled = true
    await commit({ notes: [...card.notes, deps.makeNote(text)] })
    els.noteInput.focus()
  }

  async function deleteNote(noteId) {
    if (!card) return
    const ok = await confirmDialog({
      title: 'Delete this note?',
      body: 'It will disappear for everyone on the board.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await commit({ notes: card.notes.filter((n) => n.id !== noteId) })
  }

  async function requestDelete() {
    if (!card) return
    const target = card
    const ok = await confirmDialog({
      title: 'Delete this card?',
      body: target.title.trim()
        ? `"${target.title.trim()}" and its ${plural(target.notes.length, 'note')} will be removed.`
        : 'This untitled card will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    close()
    await deps.onDelete(target)
  }

  // ---------------------------------------------------------------- render

  function renderChips() {
    clear(els.chips)
    if (!card.assignees.length) {
      els.chips.appendChild(h('span', { class: 'note__empty', text: 'Nobody yet' }))
    }
    for (const name of card.assignees) {
      els.chips.appendChild(
        h(
          'span',
          { class: 'chip' },
          avatar(name),
          h('span', { class: 'chip__name', text: name }),
          h(
            'button',
            {
              class: 'chip__x',
              type: 'button',
              'aria-label': `Remove ${name}`,
              onclick: () => removeAssignee(name),
            },
            icon('x'),
          ),
        ),
      )
    }
  }

  function renderSuggestions() {
    clear(els.suggestions)
    const assigned = new Set(card.assignees.map(personKey))
    const me = deps.identity.name

    if (!assigned.has(personKey(me))) {
      els.suggestions.appendChild(
        h(
          'button',
          { class: 'suggest__btn', type: 'button', onclick: () => addAssignee(me) },
          avatar(me, 'avatar--sm'),
          h('span', { text: 'Assign to me' }),
        ),
      )
    }

    for (const person of deps.getPeople()) {
      if (assigned.has(personKey(person.name)) || personKey(person.name) === personKey(me)) continue
      els.suggestions.appendChild(
        h(
          'button',
          { class: 'suggest__btn', type: 'button', onclick: () => addAssignee(person.name) },
          avatar(person.name, 'avatar--sm'),
          h('span', { text: person.name }),
        ),
      )
      if (els.suggestions.children.length >= 8) break
    }
  }

  function renderNotes() {
    clear(els.notes)
    els.notesLabel.textContent = card.notes.length ? plural(card.notes.length, 'note') : 'Notes'

    if (!card.notes.length) {
      els.notes.appendChild(h('p', { class: 'note__empty', text: 'No notes yet.' }))
      return
    }

    for (const note of card.notes) {
      const mine = personKey(note.author) === personKey(deps.identity.name)
      els.notes.appendChild(
        h(
          'div',
          { class: 'note' },
          avatar(note.author),
          h(
            'div',
            { class: 'note__main' },
            h(
              'div',
              { class: 'note__head' },
              h('span', { class: 'note__author', text: note.author }),
              h('span', { class: 'note__at', title: absoluteTime(note.at), text: relativeTime(note.at) }),
              mine &&
                iconButton('trash', 'Delete note', () => deleteNote(note.id), 'note__del icon-btn--danger'),
            ),
            h('p', { class: 'note__text', text: note.text }),
          ),
        ),
      )
    }
  }

  function renderTagSuggestions() {
    clear(els.tagList)
    for (const { tag } of deps.getTags()) {
      els.tagList.appendChild(h('option', { value: tag }))
    }
  }

  /** Only write to a field the user is not currently in. */
  function setIfIdle(field, value) {
    if (document.activeElement === field) return
    if (field.value !== value) field.value = value
  }

  function paint() {
    const stage = getStage(card.status)
    els.panel.style.setProperty('--dot', `var(--stage-${stage.id})`)
    els.eyebrow.textContent = stage.name

    setIfIdle(els.title, card.title)
    if (document.activeElement !== els.title) autosize(els.title)
    setIfIdle(els.tag, card.tag)
    setIfIdle(els.body, card.body)

    for (const [id, btn] of els.stageButtons) {
      btn.setAttribute('aria-pressed', String(id === card.status))
    }

    renderChips()
    renderSuggestions()
    renderNotes()
    renderTagSuggestions()

    els.stamp.textContent = `Updated ${relativeTime(card.updated_at)}`
    els.stamp.title = `Created ${absoluteTime(card.created_at)}\nUpdated ${absoluteTime(card.updated_at)}`
  }

  // ---------------------------------------------------------------- lifecycle

  function open(next, { focus = 'title' } = {}) {
    if (isOpen()) closeImmediate({ restoreFocus: false })
    card = next
    const built = build()
    root.appendChild(built.scrim)
    root.appendChild(built.panel)
    paint()
    release = trapFocus(built.panel, () => close())

    if (focus === 'title') {
      built.title.focus()
      // Caret to the end so typing extends rather than replaces.
      const end = built.title.value.length
      built.title.setSelectionRange(end, end)
    }
  }

  function closeImmediate(opts) {
    release?.(opts)
    release = null
    clear(root)
    card = null
    els = null
  }

  async function close() {
    if (!isOpen()) return
    await flush()
    closeImmediate()
    deps.onClose?.()
  }

  /** Called when the card changed elsewhere (another tab, another person). */
  function update(next) {
    if (!isOpen() || next.id !== card.id) return
    card = next
    paint()
  }

  /** Called when the open card was deleted out from under us. */
  function notifyRemoved(id) {
    if (isOpen() && card.id === id) {
      closeImmediate()
      deps.onError?.(new Error('That card was deleted by someone else.'))
    }
  }

  return {
    open,
    close,
    update,
    notifyRemoved,
    flush,
    get currentId() {
      return card?.id ?? null
    },
  }
}
