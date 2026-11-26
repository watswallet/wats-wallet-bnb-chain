// swapTo.vue kaynak testi -- arama kutusu sunucuya da sorar (canli bulgu 2026-11-20).
//
// Arama yalniz YUKLU sayfanin (populer siradaki ilk 50 token) icinde yapiliyordu; BSC'de "usdc" bulunamadi. Mantik
// utils/remoteTokenSearch.js'te ve orada test ediliyor; bu dosya bilesenin ona DOGRU baglandigini olcer (DOM test
// ortami yok, SSR girdi olayi tetikleyemez).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'

const here = dirname(fileURLToPath(import.meta.url))
const kaynak = yorumsuz(readFileSync(join(here, 'swapTo.vue'), 'utf8'))
const betik = kaynak.slice(kaynak.indexOf('<script'))
const govde = (ad) => {
    const i = betik.indexOf(`const ${ad} =`)
    expect(i, `${ad} bulunamadi`).toBeGreaterThan(-1)
    const sonraki = betik.indexOf('\nconst ', i + 1)
    return betik.slice(i, sonraki === -1 ? undefined : sonraki)
}

describe('swapTo.vue sunucu aramasi', () => {
    it('yardimcilari remoteTokenSearch ten alir', () => {
        expect(betik).toMatch(/import\s*\{[^}]*createRemoteTokenSearch[^}]*\}\s*from\s*'..\/..\/utils\/remoteTokenSearch'/)
        expect(betik).toMatch(/import\s*\{[^}]*combineSearchResults[^}]*\}\s*from\s*'..\/..\/utils\/remoteTokenSearch'/)
    })

    it('arama girdisi sunucu aramasini tetikler', () => {
        expect(govde('handleSearch')).toMatch(/remoteSearch\.request\(\s*searchQuery\.value\s*\)/)
    })

    it('sunucu aramasi /getChainTokens e `search` ile, aktif agin chainId siyle gider', () => {
        const g = govde('remoteSearch')
        expect(g).toMatch(/createRemoteTokenSearch\(/)
        expect(g).toMatch(/'\/getChainTokens'/)
        expect(g).toMatch(/search:\s*query/)
        expect(g).toMatch(/chainId:\s*network\.currentNetwork\?\.chainId/)
    })

    it('Gizli modda arama kelimesi sunucuya GITMEZ', () => {
        expect(govde('remoteSearch')).toMatch(/if\s*\(\s*privacy\.active\s*\)\s*return\s*\[\]/)
    })

    it('sonuc listesi combineSearchResults ile birlesir; sunucu satirlarina secicinin suzgeci uygulanir', () => {
        const g = govde('filteredTokens')
        expect(g).toMatch(/combineSearchResults\(/)
        expect(g).toMatch(/keep:\s*keepRemote/)
        const keep = govde('keepRemote')
        expect(keep).toMatch(/swapable\(/)
        expect(keep).toMatch(/hiddenAddresses/)
    })

    // Sunucu takilirsa iskelet sonsuza dek kalmasin: istek 8 sn'de duser, hata bos sonuc olur ("bulunamadi").
    it('sunucu aramasinin zaman siniri var', () => {
        expect(govde('remoteSearch')).toMatch(/\{\s*timeout:\s*8000\s*\}/)
    })

    // Yanit beklenirken bos listede "bulunamadi" yerine iskelet (inceleme bulgusu): sablon kosulu remotePending'e bagli.
    it('iskelet sunucu yaniti beklenirken de gosterilir', () => {
        const sablon = kaynak.slice(0, kaynak.indexOf('<script'))
        expect(sablon).toMatch(/v-if="\(loading \|\| remotePending\) && \(!displayedTokens \|\| displayedTokens\.length === 0\)"/)
    })

    it('secici kapanirken bekleyen arama iptal edilir', () => {
        expect(betik).toMatch(/onUnmounted\(\s*\(\)\s*=>\s*remoteSearch\.cancel\(\)\s*\)/)
    })
})
