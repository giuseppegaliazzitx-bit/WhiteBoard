import { describe, it, expect } from 'vitest'
import { hrefFor, splitLinks, hasLinks, fillLinked } from '../src/linkify.js'

describe('hrefFor', () => {
  it('accepts http and https', () => {
    expect(hrefFor('https://example.com/x')).toBe('https://example.com/x')
    expect(hrefFor('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('promotes www to https', () => {
    expect(hrefFor('www.example.com')).toBe('https://www.example.com')
  })

  it('rejects javascript and bare words', () => {
    expect(hrefFor('javascript:alert(1)')).toBeNull()
    expect(hrefFor('not a link')).toBeNull()
  })
})

describe('splitLinks', () => {
  it('is empty for blank text', () => {
    expect(splitLinks('')).toEqual([])
  })

  it('keeps surrounding text and peels a URL out', () => {
    const parts = splitLinks('see https://x.com/a please')
    expect(parts).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'https://x.com/a', href: 'https://x.com/a' },
      { type: 'text', text: ' please' },
    ])
  })

  it('strips trailing punctuation from the href', () => {
    const parts = splitLinks('go to https://example.com.')
    expect(parts).toEqual([
      { type: 'text', text: 'go to ' },
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
      { type: 'text', text: '.' },
    ])
  })
})

describe('hasLinks', () => {
  it('detects a URL in a sentence', () => {
    expect(hasLinks('nope')).toBe(false)
    expect(hasLinks('www.example.com')).toBe(true)
  })
})

describe('fillLinked', () => {
  it('writes text nodes and anchors, never html', () => {
    const node = document.createElement('div')
    fillLinked(node, 'open https://example.com now')
    expect(node.childNodes).toHaveLength(3)
    expect(node.childNodes[0].textContent).toBe('open ')
    const a = node.childNodes[1]
    expect(a.tagName).toBe('A')
    expect(a.getAttribute('href')).toBe('https://example.com')
    expect(a.target).toBe('_blank')
    expect(a.textContent).toBe('https://example.com')
  })
})
