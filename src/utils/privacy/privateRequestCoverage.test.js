// OZEL MOD ISTEK ENVANTERI -- KAPSAM TARAMASI (gizli-mod cok-ag spec 4.7 ve 5.1 `privateRequestInventory.ssr.test.js`
// satirinin son cumlesi): "src altindaki her sunucu ucu envanter tablosunda ya da 'ulasilamayan uc noktalar' notunda
// adiyla gecmek zorundadir; yeni bir uc nokta ikisinden birine yazilmadan test kirmizidir".
//
// Evren, sunucunun KENDI yollari: `server/router.js`'teki her `router.get/post(...)` yolu. Istemci kaynaginda (`client/src`,
// test dosyalari ve test-utils haric, yorumlar temizlenmis) o yolu dizge ya da sablon olarak anan her dosya o yolu
// KULLANIYOR sayilir; temel adres degiskeninin adi (`config.api`, `api`, `base`, `apiBase`, `API_BASE`, `bundlerBase`...)
// onemli degildir. Boylece yeni bir cagri yeri hangi bicimde yazilirsa yazilsin yakalanir.
//
// KAPSAM tablosu elle tutulur ve spec 4.7 envanter tablosuyla (satir numaralari) ya da "ulasilamayan uc noktalar" notuyla
// ayni sirada okunur. Iki yonlu kilit: kullanilan her yol tabloda olmali (yeni uc kirmizi), tablodaki her yol hem sunucuda
// hem istemcide bulunmali (yazim hatasi ve bayat satir kirmizi).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const ROUTER = join(SRC, '..', '..', 'server', 'router.js')

// Etiketler: KALIR / DARALIR / KAPI / KALKAR = spec 4.7 envanter satiri; ULASILAMAZ = ozel modda ulasilamaz (spec 4.7
// "Ozel modda ulasilamayan uc noktalar" notu); MOD_DISI = mod ile ilgisiz (eklenti kurulum/guncelleme olayi).
export const KAPSAM = {
    '/getTokensDataById': 'KALKAR (satir 2)',
    '/getTokenDataById': 'KALKAR (satir 3)',
    '/getTokenPriceHistory': 'KALKAR (satir 3)',
    '/getTokenByAddress': 'KALKAR (satir 3)',
    '/getRates': 'KALKAR (fiat kur tablosu: ozel modda fiyat gosterilmedigi icin kesici reddeder, depo da istemez)',
    '/getImportedTokens': 'KALKAR (satir 5)',
    '/getChainTokens': 'KALIR (satir 6)',
    '/wallet/history': 'KALIR yalniz desteklenen aglarda, digerlerinde KAPI (satir 8)',
    '/news': 'KALIR (satir 9)',
    '/bundler/auth': 'KAPI (satir 16)',
    '/rpc/:chainId': 'KAPI (satir 16: yalniz GASLESS token-ile-gaz yolu)',
    '/wallet/reputation': 'KALIR (satir 19)',
    '/getTokenByName': 'KALIR (satir 23)',
    '/analytics/ping': 'KAPI (satir 27)',
    '/cow/refund-claim': 'KAPI (satir 32: claimRefundsSafe ozel modda atlanir)',
    '/moonpay/getSignUrl': 'ULASILAMAZ (ONRAMP_ENABLED = false)',
    '/checkUsername': 'ULASILAMAZ (profil ekranlari ozel modda kapali)',
    '/profile': 'ULASILAMAZ (profil olusturma yalniz kurulumda)',
    '/profile/changeUsername': 'ULASILAMAZ (profil ekranlari ozel modda kapali)',
    '/profile/getProfile': 'MOD_DISI (yalniz kurulum/guncelleme gocunde, genel kullanici adi)',
    '/ton/history': 'ULASILAMAZ (Gizli Hesap EVM-yalnizdir)',
    '/ton/rpc': 'ULASILAMAZ (Gizli Hesap EVM-yalnizdir)',
    '/ton/swap/simulate': 'ULASILAMAZ (Gizli Hesap EVM-yalnizdir)',
    '/solana/rpc': 'ULASILAMAZ (Gizli Hesap EVM-yalnizdir)',
    '/solana/history': 'ULASILAMAZ (Gizli Hesap EVM-yalnizdir)',
    '/solana/tokens': 'ULASILAMAZ (Gizli Hesap EVM-yalnizdir)',
}

const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function istemciDosyalari(dizin = SRC) {
    const sonuc = []
    for (const ad of readdirSync(dizin)) {
        const yol = join(dizin, ad)
        if (statSync(yol).isDirectory()) {
            if (ad === 'test-utils' || ad === 'node_modules') continue
            sonuc.push(...istemciDosyalari(yol))
            continue
        }
        if (/\.(js|vue|ts)$/.test(ad) && !/\.test\.(js|ts)$/.test(ad)) sonuc.push(yol)
    }
    return sonuc
}

const sunucuYollari = [...readFileSync(ROUTER, 'utf8').matchAll(/router\.(?:get|post|put|delete)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
const kaynaklar = istemciDosyalari().map((yol) => ({ yol: relative(SRC, yol).split(sep).join('/'), kod: yorumsuz(readFileSync(yol, 'utf8')) }))

/** Bir sunucu yolunu dizge/sablon olarak anan istemci dosyalari (`:param` -> `${...}`). */
function kullananlar(sunucuYolu) {
    const govde = kacis(sunucuYolu).replace(/:\w+/g, '\\$\\{[^}]+\\}')
    const desen = new RegExp('[\'"`}]' + govde + '(?=[\'"`?$)\\s])')
    return kaynaklar.filter((k) => desen.test(k.kod)).map((k) => k.yol)
}

const kullanilan = new Map(sunucuYollari.map((y) => [y, kullananlar(y)]).filter(([, dosyalar]) => dosyalar.length > 0))

describe('Ozel mod istek envanteri -- kapsam taramasi (spec 5.1)', () => {
    it('tarama bos degil: sunucu yollari okundu ve istemci dosyalari bulundu', () => {
        expect(sunucuYollari.length).toBeGreaterThan(30)
        expect(kaynaklar.length).toBeGreaterThan(200)
        expect(kullanilan.size).toBeGreaterThan(15)
    })

    it('istemcinin kullandigi HER sunucu yolu KAPSAM tablosunda adiyla gecer (yeni uc nokta kirmizi)', () => {
        const eksik = [...kullanilan].filter(([yol]) => !(yol in KAPSAM)).map(([yol, dosyalar]) => `${yol} <- ${dosyalar.join(', ')}`)
        expect(eksik, 'Bu uclar envanter tablosuna (spec 4.7) ve KAPSAM tablosuna yazilmali').toEqual([])
    })

    it('KAPSAM tablosundaki HER yol sunucuda var (yazim hatasi) ve istemcide kullaniliyor (bayat satir)', () => {
        const sunucuda = new Set(sunucuYollari)
        const sunucudaYok = Object.keys(KAPSAM).filter((yol) => !sunucuda.has(yol))
        expect(sunucudaYok).toEqual([])
        const kullanilmayan = Object.keys(KAPSAM).filter((yol) => !kullanilan.has(yol))
        expect(kullanilmayan).toEqual([])
    })

    it('her KAPSAM satirinin etiketi tanimli bir karar ile baslar', () => {
        for (const [yol, etiket] of Object.entries(KAPSAM)) {
            expect(etiket, yol).toMatch(/^(KALIR|DARALIR|KAPI|KALKAR|ULASILAMAZ|MOD_DISI)\b/)
        }
    })

    it('tarayici sabotaja dayanikli: bilinen bir cagri yeri bulunur', () => {
        expect(kullanilan.get('/getTokensDataById')).toEqual(expect.arrayContaining(['components/Home.vue', 'composables/useUsdPrice.js']))
        expect(kullanilan.get('/rpc/:chainId')).toEqual(expect.arrayContaining(['utils/smartAccount.js']))
        expect(kullanilan.get('/wallet/history')).toEqual(expect.arrayContaining(['components/History.vue', 'utils/historyRecipients.js']))
    })
})

// BUNDLER ANA MAKINESI (bundler.watswallet.com; envanter satir 15 ve 24-25): sunucu yollari (server/router.js) yalniz ana API'yi
// kapsar, bundler istemcisinin yollari ayri bir kapsam tablosu ister. GaslessClient'in cagirdigi HER uc burada adiyla gecer;
// yeni bir uc (ornegin satis yoluna eklenen bir yardimci uc) satir numarasi yazilmadan kirmizidir. Iki yonlu: tablodaki her
// yol istemcide cagriliyor olmali (bayat satir kirmizi). Satis ucunun ek kisitlari atsSalePrivacy.test.js ve inventory'dedir.
export const BUNDLER_KAPSAM = {
    '/health': 'KALIR (satir 15)',
    '/paymaster/status': 'KALIR (satir 15)',
    '/paymaster/quote': 'KALIR (satir 15)',
    '/paymaster/sponsor': 'KALIR (satir 15)',
    '/paymaster/relay': 'KALIR (satir 15 ve 25: ATS satin alma yurutmesi de bu uctan gecer)',
    '/sale/quote': 'KALIR (satir 24: ATS satin alma teklifi, K13)',
    '/sale/sponsor': 'KALIR (satir 25: ATS satin alma yurutmesi, K13)',
}

describe('Ozel mod istek envanteri -- bundler uclari kapsam taramasi (satir 15, 24, 25)', () => {
    const gasless = yorumsuz(readFileSync(join(SRC, 'utils', 'sdk', 'gasless.ts'), 'utf8'))
    const cagrilanlar = [...gasless.matchAll(/this\.(?:post|get)\(\s*[`'"](\/[a-zA-Z/]+)/g)].map((m) => m[1])

    it('tarama bos degil: GaslessClient in uclari okundu', () => {
        expect(cagrilanlar.length).toBeGreaterThanOrEqual(7)
    })

    it('GaslessClient in cagirdigi HER uc BUNDLER_KAPSAM da adiyla gecer (yeni uc kirmizi)', () => {
        expect([...new Set(cagrilanlar)].filter((yol) => !(yol in BUNDLER_KAPSAM))).toEqual([])
    })

    it('BUNDLER_KAPSAM daki her yol istemcide cagriliyor (bayat satir kirmizi) ve etiketi bir karar ile baslar', () => {
        expect(Object.keys(BUNDLER_KAPSAM).filter((yol) => !cagrilanlar.includes(yol))).toEqual([])
        for (const [yol, etiket] of Object.entries(BUNDLER_KAPSAM)) expect(etiket, yol).toMatch(/^(KALIR|DARALIR|KAPI|KALKAR)\b/)
    })

    it('satis uclari (satir 24-25) tablodadir: /sale/quote ve /sale/sponsor', () => {
        expect(BUNDLER_KAPSAM['/sale/quote']).toMatch(/satir 24/)
        expect(BUNDLER_KAPSAM['/sale/sponsor']).toMatch(/satir 25/)
    })
})

// '/ton/rpc' ve '/solana/rpc' satirlarindaki "ULASILAMAZ (Gizli Hesap EVM-yalnizdir)" iddiasi YALNIZ arayuz icin degil ARKA PLAN
// icin de dogru olmak zorundadir: alarm tiki / HEARTBEAT / onStartup / onInstalled'in kurtarma iscileri (TON ucret kurtarmasi ve
// bekleyen Solana/EVM islem kurtarmasi) bu uclara normal hesap adina gidebilirdi (yayin 1.10, Gorev C). Kapi iscilerin KENDI
// govdesinde, ilk ag/depo isinden ONCE olmali; calisma davranisi background.privateRecovery.test.js'te sinanir.
describe('Ozel mod istek envanteri -- ULASILAMAZ iddiasi arka plan kurtarma iscilerinde de tutar', () => {
    const arkaPlan = readFileSync(join(SRC, 'background.js'), 'utf8')

    it('/ton/rpc ve /solana/rpc hala ULASILAMAZ etiketli (iddia silinirse bu kapi anlamsiz)', () => {
        expect(KAPSAM['/ton/rpc']).toMatch(/^ULASILAMAZ/)
        expect(KAPSAM['/solana/rpc']).toMatch(/^ULASILAMAZ/)
    })

    it.each([
        ['async function recoverTonFees(', 'recoverTonSettlements('],
        ['async function runPendingRecovery(', 'chrome.storage.local.get'],
    ])('%s govdesi activeIsPrivate() kapisiyla baslar (fail-closed), ilk ag/depo isinden ONCE', (imza, ilkIs) => {
        const govde = blokGovdesi(arkaPlan, imza)
        expect(govde).not.toBeNull()
        const kapi = govde.indexOf('activeIsPrivate()')
        const is = govde.indexOf(ilkIs)
        expect(kapi).toBeGreaterThan(-1)
        expect(is).toBeGreaterThan(-1)
        expect(kapi).toBeLessThan(is)
    })

    it('tum tetikleyiciler (alarm, HEARTBEAT, onStartup, onInstalled) bu iki isciden gecer, dogrudan RPC cagrisi yapmaz', () => {
        const kod = yorumsuz(arkaPlan)
        for (const imza of ['case "HEARTBEAT":', "chrome.runtime.onStartup.addListener(async", "chrome.runtime.onInstalled.addListener(async"]) {
            const bas = kod.indexOf(imza)
            expect(bas, imza).toBeGreaterThan(-1)
            const parca = kod.slice(bas, bas + 900)
            expect(parca, imza).toMatch(/checkAndRecoverPendingTxs\(\)|recoverTonFees\(\)/)
            expect(parca, imza).not.toMatch(/solanaRpc\(|tonSeqnoFor\(/)
        }
    })
})

// Klasik Takas/Kopru gizli modda VITE_PRIVATE_SWAP_BRIDGE degerinden BAGIMSIZ kapali. Envanter iddiasi: Swap/Bridge ekranlarinin ve ATS ucret
// composable'inin arka plana gonderdigi Takas/Kopru mesajlarinin HEPSI bayrak ne olursa olsun gizli modda kapidan reddedilir; yeni bir SWAP*/BRIDGE*
// ya da ATS_{SWAP,BRIDGE}_FEE_QUOTE gonderimi eklenirse (ya da kapi listesinden bir ad dusurulurse) bu test kirmizi olur.
describe('Ozel mod istek envanteri -- gizli modda klasik Takas ve Kopru mesajlari bayraktan bagimsiz kapi tarafindan reddedilir', () => {
    const KAYNAKLAR = ['components/Swap.vue', 'components/Bridge.vue', 'composables/useAtsOpFee.js']
    const gonderilen = () => {
        const bulunan = new Set()
        for (const yol of KAYNAKLAR) {
            const kod = yorumsuz(readFileSync(join(SRC, yol), 'utf8'))
            for (const m of kod.matchAll(/['"]((?:SWAP|BRIDGE)(?:_QUOTE)?|ATS_(?:SWAP|BRIDGE)_FEE_QUOTE)['"]/g)) bulunan.add(m[1])
        }
        return [...bulunan].sort()
    }
    const KLASOR = { activeAccount: { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true } }

    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('tarama bos degil: dort ana mesaj ve iki ATS ucret teklifi ekranlarda gonderilir', () => {
        expect(gonderilen()).toEqual(['ATS_BRIDGE_FEE_QUOTE', 'ATS_SWAP_FEE_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE', 'SWAP', 'SWAP_QUOTE'])
    })

    it('her biri bayrak ne olursa olsun gizli modda PRIVATE_SWAP_BRIDGE_CLOSED ile reddedilir', async () => {
        vi.resetModules()
        vi.stubEnv('VITE_PRIVATE_SWAP_BRIDGE', 'false')
        const kapali = await import('./privacyGate')
        // Bayrak bu yarida GERCEKTEN kapali (yoksa asagidaki dongu bayragi hic sinamazdi: iki yarinin beklentisi ayni).
        expect((await import('../featureFlags')).PRIVATE_SWAP_BRIDGE).toBe(false)
        for (const ad of gonderilen()) {
            expect(kapali.privacyDecision(ad, { ...KLASOR, signer: KLASOR.activeAccount, chainKind: 'evm' }), ad)
                .toEqual({ block: kapali.PRIVATE_GATE_CODES.SWAP_BRIDGE_CLOSED })
        }
        vi.resetModules()
        vi.stubEnv('VITE_PRIVATE_SWAP_BRIDGE', 'true')
        const acik = await import('./privacyGate')
        // Bayrak bu yarida GERCEKTEN acik: ikinci stubEnv sessizce uygulanmasaydi ikinci dongu yine gecerdi.
        expect((await import('../featureFlags')).PRIVATE_SWAP_BRIDGE).toBe(true)
        for (const ad of gonderilen()) {
            expect(acik.privacyDecision(ad, { ...KLASOR, signer: KLASOR.activeAccount, chainKind: 'evm' }), ad)
                .toEqual({ block: acik.PRIVATE_GATE_CODES.SWAP_BRIDGE_CLOSED })
        }
    })
})
