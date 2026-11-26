// Arka plan sayim ISKELETI (kaynak taramasi + saf davranis): UNLOCK_WALLET sayimi,
// ANALYTICS_COUNT beyaz listesi, ag/hata yardimcilari. Akis dallarindaki sayim noktalari
// background.analyticsSites.test.js ve background.analyticsFailures.test.js'te.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { requestAnalyticsCount } from './utils/analyticsCountRequest'

const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const yorumsuz = (s) => s.replace(/^\s*\/\/.*$/gm, '')
const src = yorumsuz(oku('./background.js'))

function caseGovdesi(ad) {
    const bas = src.indexOf(`case '${ad}':`) > -1 ? src.indexOf(`case '${ad}':`) : src.indexOf(`case "${ad}":`)
    expect(bas, `${ad} case bulunamadi`).toBeGreaterThan(-1)
    const sonra = src.slice(bas + 10).search(/\n\s*case ['"]/)
    return src.slice(bas, sonra === -1 ? src.length : bas + 10 + sonra)
}
function fnGovdesi(ad) {
    const bas = src.indexOf(`function ${ad}(`)
    expect(bas, `${ad} bulunamadi`).toBeGreaterThan(-1)
    return src.slice(bas, src.indexOf('\n}', bas))
}

describe('UNLOCK_WALLET', () => {
    it('unlockWalletSession SONRASI tek unlock sayimi, sendResponse oncesinde', () => {
        const g = caseGovdesi('UNLOCK_WALLET')
        expect(g).toMatch(/unlockWalletSession\(.*\)\.then\(\(\) => \{\s*countAnalytics\('unlock'\)/)
        expect(g.indexOf("countAnalytics('unlock')")).toBeLessThan(g.indexOf('sendResponse'))
        expect(g.match(/countAnalytics\(/g).length).toBe(1)
    })

    it('Login.vue sayim cagrisi icermez', () => {
        const l = oku('./components/Login.vue')
        expect(l).not.toContain('requestAnalyticsCount')
        expect(l).not.toContain('ANALYTICS_COUNT')
    })
})

describe('ANALYTICS_COUNT beyaz liste', () => {
    it('yalniz walletCreate, walletImport, open, screen', () => {
        const g = caseGovdesi('ANALYTICS_COUNT')
        expect(g).toMatch(/kind === 'walletCreate' \|\| kind === 'walletImport' \|\| kind === 'open'/)
        expect(g).toMatch(/kind === 'screen'/)
        expect(g).toMatch(/countAnalyticsGated\('screen', \{ screen: message\.message\.key \}\)/)
        // Kod (yorum haric) icinde yasakli kind'lara sayim yok.
        expect(g).not.toMatch(/['"](transfer|swap|bridge|unlock)\w*['"]/)
        expect(g).toContain('sendResponse({ success: true })')
    })

    it('messageGate.INTERNAL_ACTIONS ve privacyGate.ALWAYS_ALLOWED ANALYTICS_COUNT icerir', () => {
        expect(oku('./utils/messageGate.js')).toContain('ANALYTICS_COUNT')
        const pg = readFileSync(fileURLToPath(new URL('./utils/privacy/privacyGate.js', import.meta.url)), 'utf8')
        expect(pg).toContain('ANALYTICS_COUNT')
    })
})

describe('requestAnalyticsCount govdesi', () => {
    afterEach(() => { delete globalThis.chrome })
    const yolla = (...a) => {
        const sendMessage = vi.fn(() => Promise.resolve())
        globalThis.chrome = { runtime: { sendMessage } }
        requestAnalyticsCount(...a)
        return sendMessage.mock.calls[0][0]
    }

    it('yalniz kind', () => {
        expect(yolla('open')).toEqual({ type: 'ANALYTICS_COUNT', message: { kind: 'open' } })
    })
    it('kind + yalniz key; baska alan sizmaz', () => {
        expect(yolla('screen', { key: 'send', address: '0xabc', amount: '1' }))
            .toEqual({ type: 'ANALYTICS_COUNT', message: { kind: 'screen', key: 'send' } })
    })
})

describe('yardimcilar', () => {
    it('countOwnTransfer ag message.message.chainId ile', () => {
        expect(fnGovdesi('countOwnTransfer')).toContain("countAnalytics('transfer', message.message.chainId)")
    })
    it('countOwnTransferFailure yalniz countAs transfer ise', () => {
        const g = fnGovdesi('countOwnTransferFailure')
        expect(g).toContain("message?.message?.countAs === 'transfer'")
        expect(g).toContain("countAnalyticsFailure('transfer')")
    })
    it('countAnalyticsFailure yalniz transfer/swap/bridge kabul eder, kind *Failed', () => {
        const g = fnGovdesi('countAnalyticsFailure')
        expect(g).toMatch(/kind !== 'transfer' && kind !== 'swap' && kind !== 'bridge'\) return/)
        expect(g).toContain("countAnalytics(kind + 'Failed')")
    })
    it('countAnalytics ag anahtarini networkKeyForChain ile, yalniz transfer/swap/bridge icin turetir', () => {
        const g = fnGovdesi('countAnalytics')
        expect(g).toContain('network: networkKeyForChain(chainId)')
        expect(g).toMatch(/kind === 'transfer' \|\| kind === 'swap' \|\| kind === 'bridge'/)
    })
})
