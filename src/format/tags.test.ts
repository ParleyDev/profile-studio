import { describe, expect, it } from 'vitest'
import type { Item } from './workspace'
import { allTags, cleanTag, cleanTags, matchesQuery, parseQuery, specialTag, tagsOf, toggleTagInQuery } from './tags'

const item = (name: string, tags?: unknown): Item => ({ uid: name, kind: 'decoration', entry: { file: `${name}.png`, name, tags }, files: {} })

describe('tags', () => {
  it('tidies tags', () => {
    expect(cleanTag('  Winter   Sports! ')).toBe('winter sports')
    expect(cleanTag('Noël_2026')).toBe('noël_2026')
    expect(cleanTag('x'.repeat(40))).toHaveLength(32)
    expect(cleanTags(['A', 'a', '', 3, 'b'])).toEqual(['a', 'b'])
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20)
    expect(tagsOf(item('x', 'nope'))).toEqual([])
  })
  it('counts tags, most used first', () => {
    expect(allTags([item('a', ['xmas', 'red']), item('b', ['xmas']), item('c')])).toEqual([['xmas', 2], ['red', 1]])
  })
  it('searches #tags and words', () => {
    const tree = item('Tree', ['christmas', 'winter sports'])
    const q = (s: string) => matchesQuery(tree, parseQuery(s), 'tree.png')
    expect(q('#christmas')).toBe(true)
    expect(q('#winter-sports #christmas')).toBe(true)
    expect(q('#winter_sports')).toBe(true)
    expect(q('#christ')).toBe(false)
    expect(q('tree #christmas')).toBe(true)
    expect(q('winter')).toBe(true)
    expect(q('#halloween')).toBe(false)
  })
  it('adds and takes #tags out of a search', () => {
    expect(toggleTagInQuery('star', 'winter sports')).toBe('star #winter-sports ')
    expect(toggleTagInQuery('star #winter-sports', 'winter sports')).toBe('star')
  })
})

describe('special tags', () => {
  it('store color: and theme: with a tidy code', () => {
    expect(cleanTag('Color: Light Blue')).toBe('color:light_blue')
    expect(cleanTag('#colour:red')).toBe('color:red')
    expect(cleanTag('theme:Cute & Cozy')).toBe('theme:cute_cozy')
    expect(cleanTag('theme:')).toBe('')
    expect(cleanTag('mood:happy')).toBe('mood happy')
    expect(specialTag('color:light_blue')).toEqual({ facet: 'color', code: 'light_blue' })
    expect(specialTag('blue')).toBeNull()
  })
})
