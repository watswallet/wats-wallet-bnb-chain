// Her sabit `<Back page="X">` hedefi App.vue'de gercekten cizilen bir sayfa olmali.
// 2026-11-13: UnlockVault.vue'de hedef 'settings_security_select_phrase' (sondaki s eksik)
// idi; App.vue'de boyle bir sayfa olmadigi icin Geri dugmesi bos ekran aciyordu.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..')

function vueFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...vueFiles(p))
    else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

const appSource = readFileSync(join(SRC, 'popup', 'App.vue'), 'utf8')
const appPages = new Set([...appSource.matchAll(/currentPage === '([^']+)'/g)].map(m => m[1]))

const targets = vueFiles(SRC).flatMap(file =>
  [...readFileSync(file, 'utf8').matchAll(/<Back\s+page="([^"]+)"/g)].map(m => ({
    file: relative(SRC, file).replace(/\\/g, '/'),
    page: m[1],
  })),
)

describe('Geri dugmesi hedefleri', () => {
  it('en az bir sabit hedef bulunur (tarama calisiyor)', () => {
    expect(targets.length).toBeGreaterThan(10)
    expect(appPages.size).toBeGreaterThan(10)
  })

  it('her sabit hedef App.vue de cizilen bir sayfadir', () => {
    const missing = targets.filter(t => !appPages.has(t.page))
    expect(missing).toEqual([])
  })
})
