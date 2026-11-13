// Islem sayaci SAYIM NOKTALARI (kaynak taramasi). Davranis analyticsPing/analyticsCounts
// testlerinde; burada her akisin TAM BIR kez ve DOGRU yerde sayildigi kilitlenir.
//
// KOK NEDEN: merkezi sayim noktasi bilerek YOK (updateTxStatus 'queued'u da yazar, TON'da
// hash yoktur, dapp ayni mesaji paylasir). Bu yuzden her akisin kendi basari satirinda
// akis basina TEK cagri var ve "yanlis yere tasindi / iki kez eklendi / hata dalina
// girdi" hatalarini yalniz bu tur bir kilit yakalar. Fazla sayim kabul edilmez.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const yorumsuz = (s) => s.replace(/^\s*\/\/.*$/gm, '')
const src = yorumsuz(oku('./background.js'))

// `async function ad(` ile baslayan fonksiyonun govdesi: bir sonraki ust duzey bildirime kadar.
function govde(ad) {
    const bas = src.indexOf(`async function ${ad}(`)
    expect(bas, `${ad} bulunamadi`).toBeGreaterThan(-1)
    const sonra = src.slice(bas + 10).search(/\n(?:async function|function) \w+\(/)
    return src.slice(bas, sonra === -1 ? src.length : bas + 10 + sonra)
}
const say = (s, re) => (s.match(re) || []).length

describe('transfer', () => {
    it('sendTxInternal: uc basari dalinda countOwnTransfer, hata dalinda yok', () => {
        const g = govde('sendTxInternal')
        expect(say(g, /countOwnTransfer\(message\)/g)).toBe(3)
        // Her sayim bir resolve({ success: true ...}) HEMEN ONCESINDE.
        expect(say(g, /countOwnTransfer\(message\)\n\s*resolve\(\{ success: true/g)).toBe(3)
        expect(g.slice(g.indexOf('} catch (error)'))).not.toContain('countOwnTransfer')
    })

    it('countOwnTransfer YALNIZ countAs === "transfer" ise sayar (dapp yolu sayilmaz)', () => {
        const bas = src.indexOf('function countOwnTransfer(')
        const g = src.slice(bas, src.indexOf('\n}', bas))
        expect(g).toContain("message?.message?.countAs === 'transfer'")
        expect(g).toContain("countAnalytics('transfer')")
    })

    it('ConfirmTransaction EVM mesajinda countAs var; Dapp.vue yolunda YOK', () => {
        expect(oku('./components/ConfirmTransaction.vue')).toMatch(/countAs: 'transfer'/)
        expect(oku('./components/Dapp.vue')).not.toContain('countAs')
    })

    it('TON native: relay yalniz status "sent" ise, self-pay sendTon sonrasi', () => {
        const g = govde('sendTonInternal')
        expect(say(g, /countAnalytics\('transfer'\)/g)).toBe(2)
        expect(g).toMatch(/const relayOut = await tonRelayExecute\(/)
        expect(g).toMatch(/relayOut\?\.status === 'sent'\) countAnalytics\('transfer'\)/)
        expect(g.lastIndexOf("countAnalytics('transfer')")).toBeGreaterThan(g.indexOf('await sendTon('))
    })

    it('TON jetton: relay yalniz "sent", self-pay sendJetton sonrasi', () => {
        const g = govde('sendJettonInternal')
        expect(say(g, /countAnalytics\('transfer'\)/g)).toBe(2)
        expect(g).toMatch(/jettonRelayOut\?\.status === 'sent'\) countAnalytics\('transfer'\)/)
        expect(g.lastIndexOf("countAnalytics('transfer')")).toBeGreaterThan(g.indexOf('await sendJetton('))
    })

    it('Solana: yayin kabulunden sonra, broadcastStatusUnknown dalinda SAYILMAZ', () => {
        const g = govde('sendSolanaTransfer')
        expect(say(g, /countAnalytics\('transfer'\)/g)).toBe(1)
        const sayim = g.indexOf("countAnalytics('transfer')")
        expect(sayim).toBeGreaterThan(g.indexOf('broadcastStatusUnknown: true'))
        expect(sayim).toBeGreaterThan(g.indexOf('signature = await broadcastSignedTransaction'))
    })

    it('TonConnect dapp (tonDappSend) ve tonRelayExecute SAYMAZ', () => {
        expect(govde('tonDappSend')).not.toContain('countAnalytics')
        expect(govde('tonRelayExecute')).not.toContain('countAnalytics')
    })
})

describe('swap', () => {
    it('swap: dort basari dalinda (ATS unverified, ATS, gasless, standart)', () => {
        const g = govde('swap')
        expect(say(g, /countAnalytics\('swap'\)\n\s*resolve\(\{ success: true/g)).toBe(4)
        expect(say(g, /countAnalytics\('swap'\)/g)).toBe(4)
        expect(g.slice(g.indexOf('} catch (error)'))).not.toContain('countAnalytics')
    })

    it('TON takas: relay "sent" ise, self-pay sendTonSwap sonrasi; swap() ayrica saymaz', () => {
        const g = govde('tonSwapExecute')
        expect(say(g, /countAnalytics\('swap'\)/g)).toBe(2)
        expect(g).toMatch(/out\?\.status === 'sent'\) countAnalytics\('swap'\)/)
        expect(g.lastIndexOf("countAnalytics('swap')")).toBeGreaterThan(g.indexOf('await sendTonSwap('))
        const s = govde('swap')
        const ton = s.slice(s.indexOf('await tonSwapExecute('), s.indexOf('resolve(out)'))
        expect(ton).not.toContain('countAnalytics')
    })

    it('ATS satin alma: yalniz basari dalinda; requote/hata dallari sayilmaz', () => {
        const g = govde('atsSaleExecute')
        expect(say(g, /countAnalytics\('swap'\)/g)).toBe(1)
        expect(g.indexOf("countAnalytics('swap')")).toBeGreaterThan(g.indexOf('await executeAtsSale('))
        expect(g.slice(g.indexOf('} catch (e)'))).not.toContain('countAnalytics')
    })

    it('CoW: yalniz open ve duplicated degil', () => {
        const g = govde('cowPlaceOrder')
        expect(g).toMatch(/res\?\.success === true && res\.state === 'open' && res\.duplicated !== true\) countAnalytics\('swap'\)/)
        expect(say(g, /countAnalytics/g)).toBe(1)
        expect(govde('cowApproveExecute')).not.toContain('countAnalytics')
    })
})

describe('bridge', () => {
    it('bridge: uc basari dalinda, hata dalinda yok', () => {
        const g = govde('bridge')
        expect(say(g, /countAnalytics\('bridge'\)\n\s*resolve\(\{ success: true/g)).toBe(3)
        expect(g.slice(g.indexOf('} catch (error)'))).not.toContain('countAnalytics')
    })
})

describe('cuzdan olusturma / ice aktarma (onboarding)', () => {
    const f = (ad) => yorumsuz(oku('./components/onboarding/' + ad))

    it('CreatePassword: walletCreate, kasa yazimindan SONRA', () => {
        const s = f('CreatePassword.vue')
        expect(say(s, /requestAnalyticsCount\('walletCreate'\)/g)).toBe(1)
        expect(s.indexOf("requestAnalyticsCount('walletCreate')")).toBeGreaterThan(s.indexOf('set({ vaults })'))
    })

    it('CreatePassword2: walletImport tek kez, kasa yazimindan SONRA', () => {
        const s = f('CreatePassword2.vue')
        expect(say(s, /requestAnalyticsCount\('walletImport'\)/g)).toBe(1)
        expect(s.indexOf("requestAnalyticsCount('walletImport')")).toBeGreaterThan(s.indexOf('set({ vaults })'))
    })

    it('ImportPrivate: kasa yazimindan sonra', () => {
        const s = f('ImportPrivate.vue')
        expect(say(s, /requestAnalyticsCount\('walletImport'\)/g)).toBe(1)
        expect(s.indexOf("requestAnalyticsCount('walletImport')")).toBeGreaterThan(s.indexOf('set({ active_account: account })'))
    })

    it('ImportPhrases: TON ve BIP39 mevcut-cuzdana-ekleme dallarinda birer kez; ilk cuzdan yolunda (proceed) YOK', () => {
        const s = f('ImportPhrases.vue')
        expect(say(s, /requestAnalyticsCount\('walletImport'\)/g)).toBe(2)
        const proceed = s.slice(s.indexOf('const proceed = () =>'), s.indexOf('if (showResult) {'))
        expect(proceed).not.toContain('requestAnalyticsCount')
    })

    it('settings/CreateAccount (mevcut tohumdan ek hesap) SAYILMAZ', () => {
        const s = oku('./components/settings/CreateAccount.vue')
        expect(s).not.toContain('requestAnalyticsCount')
        expect(s).not.toContain('ANALYTICS_COUNT')
    })

    it('UI sayaca DOGRUDAN yazmaz: yalniz mesaj, kind disinda veri yok', () => {
        const s = oku('./utils/analyticsCountRequest.js')
        expect(s).toContain("type: 'ANALYTICS_COUNT'")
        expect(s).toContain('message: { kind }')
        expect(s).not.toContain('storage')
    })
})

describe('kapilar', () => {
    it('countAnalytics bayrak kapaliyken hicbir sey yapmaz ve countAction a buildEnabled gecer', () => {
        const bas = src.indexOf('function countAnalytics(')
        const g = src.slice(bas, src.indexOf('\n}', bas))
        expect(g).toContain('if (!ANALYTICS_ENABLED) return')
        // Gizli mod kapisi KIMLIKLE hesaplanir ve countAction'a verilir (iki katman: cagiran + modul)
        const kBas = src.indexOf('async function countAnalyticsGated(')
        const kapi = src.slice(kBas, src.indexOf('\n}', kBas))
        expect(kapi).toContain('buildEnabled: ANALYTICS_ENABLED')
        expect(kapi).toContain('privateMode')
        expect(kapi).toContain('await activeIsPrivate()')
    })

    // 1.10.1 ile BILEREK acildi (2026-11-13); kapatmak da bilincli olmali (bkz. featureFlags.test.js kilidi).
    it('.env.production VITE_ANALYTICS_ENABLED=true (1.10.1 ile acildi)', () => {
        expect(oku('../.env.production')).toMatch(/^VITE_ANALYTICS_ENABLED=true\s*$/m)
    })
})
