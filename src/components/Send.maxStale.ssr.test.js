// Bekleyen (hash'li, henuz bakiyeye yansimamis) islem varken Max/yuzde cipleri bayat bakiyeden tutar uretmez.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./Send.vue', import.meta.url), 'utf8')

describe('Send.vue - bayat bakiye guvencesi', () => {
  it('hasUnsettledOutgoing yalniz okuma ile cagrilir (yeni yazim yok)', () => {
    expect(src).toMatch(/hasUnsettledOutgoing\(/)
    const i = src.indexOf('hasUnsettledOutgoing(')
    const win = src.slice(i - 900, i + 400)
    expect(win).toMatch(/chrome\.storage\.local\.get/)
    expect(win).not.toMatch(/storage\.local\.set/)
  })
  it('cipler maxStale ile kilitlenir ve setPercent de savunma amacli durur', () => {
    expect(src).toMatch(/:disabled="solanaMaxDisabled \|\| maxStale"/)
    const sp = src.indexOf('const setPercent = async (percent) => {')
    expect(sp).toBeGreaterThan(0)
    expect(src.slice(sp, sp + 300)).toMatch(/if \(maxStale\.value\) return/)
  })
})
