import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(__dirname, 'locales')
const BAD = /Swaping|\badress\b|recieve|occured|succesful|seperate|confrim/i

describe('yazim hatalari', () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    it(`${f} bilinen yazim hatalarini icermez`, () => {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n')
      const hits = lines.map((l, i) => (BAD.test(l) ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean)
      expect(hits).toEqual([])
    })
  }
})
