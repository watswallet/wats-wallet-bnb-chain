// Faz 3 ATS ucreti bayragi: ana bayraga bagli, uretimde KAPALI, testte ACIK (kaynak kilidi).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { yorumsuz } from '../test-utils/kaynakTarama'

const oku = (yol) => fs.readFileSync(new URL(yol, import.meta.url), 'utf8')

describe('XSTOCKS_ATS_FEE_ENABLED kaynak kilidi', () => {
  it('.env.production bayragi false yapar ve true HICBIR yerde yok', () => {
    const env = oku('../../.env.production')
    const satirlar = env.split(/\r?\n/).filter((s) => !s.trim().startsWith('#'))
    expect(satirlar).toContain('VITE_XSTOCKS_ATS_FEE_ENABLED=false')
    expect(satirlar.join('\n')).not.toMatch(/VITE_XSTOCKS_ATS_FEE_ENABLED\s*=\s*true/)
  })

  it('featureFlags.js ifadesi XSTOCKS_ENABLED && ile baslar', () => {
    const kaynak = yorumsuz(oku('./featureFlags.js'))
    const m = kaynak.match(/export const XSTOCKS_ATS_FEE_ENABLED\s*=\s*([^\r\n]*)/)
    expect(m).not.toBeNull()
    expect(m[1].trim().startsWith('XSTOCKS_ENABLED &&')).toBe(true)
    expect(m[1]).toContain("import.meta.env.VITE_XSTOCKS_ATS_FEE_ENABLED === 'true'")
  })

  it("vitest.config.js test ortaminda 'true' verir", () => {
    const kaynak = yorumsuz(oku('../../vitest.config.js'))
    expect(kaynak).toMatch(/VITE_XSTOCKS_ATS_FEE_ENABLED:\s*'true'/)
  })

  it('testte bayrak acik (ana bayrak acik oldugu icin)', async () => {
    const { XSTOCKS_ATS_FEE_ENABLED } = await import('./featureFlags')
    expect(XSTOCKS_ATS_FEE_ENABLED).toBe(true)
  })

  it('ana bayrak kapaliyken Faz 3 bayragi true olsa da kapali', async () => {
    const { vi } = await import('vitest')
    vi.resetModules()
    vi.stubEnv('VITE_XSTOCKS_ENABLED', 'false')
    vi.stubEnv('VITE_XSTOCKS_ATS_FEE_ENABLED', 'true')
    try {
      const mod = await import('./featureFlags')
      expect(mod.XSTOCKS_ATS_FEE_ENABLED).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
