import { promptDialog } from './modal.js'
import { LIMITS } from '../model.js'

/**
 * Who you are on this board.
 *
 * No auth in v1 (see SECURITY.md): a name in localStorage, used as the author
 * on notes and to power "assign to me". Nothing stops someone typing a
 * different name -- that is the accepted trade for a board with no login.
 */
const KEY = 'board:name'
const FALLBACK = 'Anonymous'

export function createIdentity() {
  const listeners = new Set()
  let name = read()

  function read() {
    try {
      return (localStorage.getItem(KEY) || '').trim()
    } catch {
      return ''
    }
  }

  function write(value) {
    name = value
    try {
      localStorage.setItem(KEY, value)
    } catch {
      /* private mode: the name just will not survive a reload */
    }
    for (const fn of listeners) fn(value)
  }

  async function ask({ first }) {
    const answer = await promptDialog({
      title: first ? 'What should we call you?' : 'Change your name',
      body: first
        ? 'Used as the author on notes, and so the other person can assign cards to you.'
        : 'Existing notes keep the name they were written under.',
      label: 'Name',
      value: first ? '' : name,
      placeholder: 'Sam Rivera',
      confirmLabel: first ? 'Start' : 'Save',
      maxlength: LIMITS.assignee,
      required: !first,
      dismissible: !first,
    })

    // Dismissed on first run: fall back rather than blocking the board.
    if (answer === null) {
      if (first) write(FALLBACK)
      return name
    }
    write(answer.trim() || FALLBACK)
    return name
  }

  return {
    get name() {
      return name || FALLBACK
    },

    /** True until the user has actually picked a name. */
    get isDefault() {
      return !name || name === FALLBACK
    },

    /** Prompt on first visit only. */
    async ensure() {
      if (!name) await ask({ first: true })
      return this.name
    },

    change() {
      return ask({ first: false })
    },

    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
