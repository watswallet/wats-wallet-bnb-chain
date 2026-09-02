import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import manifest from '../manifest.config.js'

/**
 * Saglayici enjeksiyon zamanlamasi (dapp bug taramasi):
 *
 * content.js `<script src=...>` ekleyerek enjekte ediyordu. src'li betik
 * ASENKRON yuklenir: run_at document_start olsa bile window.ethereum sayfanin
 * kendi betikleri calistiktan SONRA olusabilir -- dapp'in ilk yoklamasi
 * saglayiciyi bulamaz ve "cuzdan yok" der. MV3'un dogru araci manifest'te
 * `world: 'MAIN'` iceren bir content script kaydidir (Chrome 111+; bu uzanti
 * minimum 115 istiyor): tarayici betigi sayfa dunyasinda, sayfanin HICBIR
 * betigi calismadan once yurutur.
 */
describe('injected.js sayfa dunyasina MANIFEST uzerinden, senkron girer', () => {
    it("manifest'te world: MAIN + document_start + all_frames kaydi vardir", () => {
        const entry = manifest.content_scripts.find(cs => (cs.js || []).some(p => p.endsWith('injected.js')))
        expect(entry).toBeDefined()
        expect(entry.world).toBe('MAIN')
        expect(entry.run_at).toBe('document_start')
        expect(entry.all_frames).toBe(true)
    })

    it('content.js artik script etiketi ENJEKTE ETMEZ (cift enjeksiyon olmasin)', () => {
        const source = readFileSync(
            fileURLToPath(new URL('./content.js', import.meta.url)),
            'utf8'
        )
        expect(source).not.toMatch(/createElement\(\s*['"]script['"]\s*\)/)
        expect(source).not.toMatch(/getURL\(\s*['"]injected\.js['"]\s*\)/)
    })
})

/**
 * K5 -- Solana yetki kaynagi TAM ORIGIN'dir ve iframe reddi ENJEKSIYON
 * seviyesinde uygulanir (Phantom'un deseni): kullanicinin adres cubugunda
 * gordugu site ile onay veren site HER ZAMAN ayni olmalidir. `all_frames: true`
 * yazilsaydi kullanicinin hic gormedigi bir iframe kendi origin'i adina
 * baglanti/imza isteyebilirdi.
 */
describe('solanaInjected.js DORDUNCU content script -- kapsam DARALTILMIS', () => {
    const solana = manifest.content_scripts.find(cs => (cs.js || []).includes('src/solanaInjected.js'))

    it('world: MAIN + document_start + all_frames FALSE', () => {
        expect(solana).toBeDefined()
        expect(solana.world).toBe('MAIN')
        expect(solana.run_at).toBe('document_start')
        expect(solana.all_frames).toBe(false)
    })

    it('kapsam yalnizca https + localhost, <all_urls> DEGIL', () => {
        expect(solana.matches).toEqual(['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'])
    })

    // Bu tur EVM/TON yuzeyine DOKUNMAZ. Diger uc girdiyi daraltmak (ya da
    // yanlislikla `all_frames: false` yapmak) bugun calisan her iframe icindeki
    // dapp'i sessizce cuzdansiz birakirdi.
    it('mevcut UC girdi DEGISMEDI', () => {
        const digerleri = manifest.content_scripts.filter(cs => !(cs.js || []).includes('src/solanaInjected.js'))
        expect(digerleri.map(cs => cs.js)).toEqual([
            ['src/content.js'], ['src/injected.js'], ['src/tonInjected.js'],
        ])
        for (const cs of digerleri) {
            expect(cs.matches).toEqual(['<all_urls>'])
            expect(cs.all_frames).toBe(true)
            expect(cs.run_at).toBe('document_start')
        }
        expect(digerleri[1].world).toBe('MAIN')
        expect(digerleri[2].world).toBe('MAIN')
    })
})
