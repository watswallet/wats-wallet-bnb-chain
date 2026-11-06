// Birlesme Dilim 0b (origin/main 0fd578a, feat/analytics-ping): gunluk kullanim ping'i Gizli Hesap aktifken HICBIR sey
// yapmaz (spec 4.7 satir 27, KAPI): istek yok, kimlik uretilmez, depoya yazilmaz.
//
// KOK NEDEN: analyticsPing.test.js bu kapiyi `{ private: true }` diye elle yazilmis bir nesneyle sinar. Kapinin kendi
// kopyasi (`active_account.private === true`, utils/analyticsPing.js) dalin Gizli Hesap tanimindan (isPrivateAccount /
// derivePrivateAccount, utils/privacy/privateAccount.js) AYRI yasar: tanim degisirse ping Gizli modda sessizce gitmeye
// baslar ve o test yesil kalir. Gizli moddaki kullanici bunu goremez, yalniz test yakalar. Bu dosya kapiyi dalin GERCEK
// Gizli Hesap kaydina ve tanim fonksiyonuna baglar; ayrica kimligin ve istek govdesinin yuzeyini kaynak seviyesinde
// kilitler (govde adres tasimaz, installId yalniz ping modulunde yasar, ping yalniz arka plan alarmindan baslar).
import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { derivePrivateAccount, isPrivateAccount } from './privateAccount'
import { runAnalyticsPing, ANALYTICS_STATE_KEY } from '../analyticsPing'
import { yorumsuz } from '../../test-utils/kaynakTarama'

const MNEMONIC = 'test test test test test test test test test test test junk'
const NOW = new Date('2026-10-16T12:00:00Z')
const ID = '3f2b8c1e-5a7d-4e9a-8b6c-1d2e3f4a5b6c'

// Dalin gercek Gizli Hesap kaydi (kasadaki `privateAccount` ile ayni uretici) ve bir genel hesap kaydi.
const gizli = derivePrivateAccount(MNEMONIC, { fingerprint: 'fp' }, { name: 'Gizli Hesap' })
const genel = { key: 'hd-0', address: '0x' + 'ab'.repeat(20), name: 'Hesap 1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0" }

// chrome.storage.local seklinde sahte depo. get/set/remove CAGRI SAYILIR: "depoya hicbir sey yazilmadi" iddiasi icin.
function depo(baslangic = {}) {
    const data = structuredClone(baslangic)
    return {
        data,
        get: vi.fn(async (keys) => structuredClone(Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])))),
        set: vi.fn(async (obj) => { Object.assign(data, structuredClone(obj)) }),
        remove: vi.fn(async (key) => { delete data[key] }),
    }
}
const kos = (storage) => ({ storage, post: vi.fn().mockResolvedValue({}), version: '1.9.1', locale: 'en', now: NOW, makeId: vi.fn(() => ID) })

describe('Gizli Hesap aktifken ping (spec 4.7 satir 27, KAPI)', () => {
    it('dalin gercek Gizli Hesap kaydi: istek YOK, kimlik uretilmez, depoya hicbir sey yazilmaz', async () => {
        expect(isPrivateAccount(gizli)).toBe(true) // kayit gercekten Gizli Hesap tanimina uyuyor (bos test degil)
        const o = kos(depo({ active_account: gizli }))

        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.makeId).not.toHaveBeenCalled()
        expect(o.storage.set).not.toHaveBeenCalled()
        expect(o.storage.remove).not.toHaveBeenCalled()
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('genel modda yazilmis kimlik varken de: ping gunu gelmis olsa bile istek YOK ve kayit degismez', async () => {
        const onceki = { installId: ID, lastPingDay: '2026-10-15' } // NOW (16 Ekim) icin ping ATILACAK bir kurulum
        const o = kos(depo({ active_account: gizli, [ANALYTICS_STATE_KEY]: onceki }))

        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.storage.set).not.toHaveBeenCalled()
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toEqual(onceki)
    })

    it('KONTROL: ayni durumda aktif hesap genelse ping GIDER (kapi yalniz hesap kimligine bagli)', async () => {
        const o = kos(depo({ active_account: genel, [ANALYTICS_STATE_KEY]: { installId: ID, lastPingDay: '2026-10-15' } }))

        expect(await runAnalyticsPing(o)).toEqual({ sent: true })
        expect(o.post).toHaveBeenCalledTimes(1)
        expect(o.post).toHaveBeenCalledWith({ installId: ID, version: '1.9.1', locale: 'en' })
    })
})

describe('ping kapisi, dalin Gizli Hesap tanimiyla AYNI yargiyi verir', () => {
    // SINIR: bu tablo ping MODULUNUN kendi bayrak kapisini (`private` bayragi, isPrivateAccount ile ayni yargi) sinar.
    // privacyGate.js isPrivateIdentity ayrica kasadaki kaydin adres / key / turetme yolu eslesmesini sayar; modul kasayi
    // BILMEZ. Bayragi dusmus eski bir Gizli Hesap kaydini arka plan yakalar ve `privateMode` olarak iletir (0b-M, Dilim D):
    // asagidaki `privateMode` describe'i modulun o karara uydugunu, kimlikle hesaplamanin kendisi
    // background.analyticsPrivate.test.js'tedir.
    const SEKILLER = [
        ['dalin gercek Gizli Hesap kaydi', gizli],
        ['yalniz { private: true }', { private: true }],
        ['private: false', { ...gizli, private: false }],
        ['private: "true" (dize)', { ...gizli, private: 'true' }],
        ['private: 1', { ...gizli, private: 1 }],
        ['private alani olmayan genel hesap', genel],
        ['bos nesne', {}],
        ['null', null],
        ['kayit yok (undefined)', undefined],
    ]

    it.each(SEKILLER)('%s', async (_ad, hesap) => {
        const o = kos(depo(hesap === undefined ? {} : { active_account: hesap }))
        await runAnalyticsPing(o)
        // Ping atilmadiysa kapi "Gizli" demistir: isPrivateAccount ile birebir ayni yargi.
        expect(o.post.mock.calls.length === 0).toBe(isPrivateAccount(hesap))
    })
})

describe('privateMode: arka planin KIMLIKLE hesapladigi karar (0b-M)', () => {
    it('privateMode true: aktif hesap genel gorunse ve ping gunu gelmis olsa bile istek YOK, kimlik uretilmez, depoya yazilmaz', async () => {
        const onceki = { installId: ID, lastPingDay: '2026-10-15' }
        const o = { ...kos(depo({ active_account: genel, [ANALYTICS_STATE_KEY]: onceki })), privateMode: true }

        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.makeId).not.toHaveBeenCalled()
        expect(o.storage.set).not.toHaveBeenCalled()
        expect(o.storage.remove).not.toHaveBeenCalled()
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toEqual(onceki)
    })

    it('privateMode true: HIC hesap kaydi yokken de (bos depo) istek YOK', async () => {
        const o = { ...kos(depo({})), privateMode: true }
        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.makeId).not.toHaveBeenCalled()
    })

    it('privateMode false iken bile `private` bayrakli kayit ping ATMAZ (modulun kendi bayrak kapisi ikinci kapidir)', async () => {
        const o = { ...kos(depo({ active_account: gizli })), privateMode: false }
        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.storage.set).not.toHaveBeenCalled()
    })

    it('KONTROL: privateMode false + genel hesap: ping GIDER', async () => {
        const o = { ...kos(depo({ active_account: genel, [ANALYTICS_STATE_KEY]: { installId: ID, lastPingDay: '2026-10-15' } })), privateMode: false }
        expect(await runAnalyticsPing(o)).toEqual({ sent: true })
        expect(o.post).toHaveBeenCalledWith({ installId: ID, version: '1.9.1', locale: 'en' })
    })

    it('privateMode verilmezse eski davranis: bayrakli kayit atmaz, genel kayit atar', async () => {
        const gizliOlcum = kos(depo({ active_account: gizli }))
        await runAnalyticsPing(gizliOlcum)
        expect(gizliOlcum.post).not.toHaveBeenCalled()

        const genelOlcum = kos(depo({ active_account: genel }))
        await runAnalyticsPing(genelOlcum)
        expect(genelOlcum.post).toHaveBeenCalledTimes(1)
    })

    it.each([[1], ['true'], [{}]])('dogru ama true olmayan deger (%j) da MOD SAYILIR: belirsizlikte ping atilmaz (fail-closed)', async (deger) => {
        const o = { ...kos(depo({ active_account: genel })), privateMode: deger }
        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
    })
})

describe('ping govdesi adres tasimaz; kimlik yuzeyi dardir', () => {
    const SRC = fileURLToPath(new URL('../../', import.meta.url))
    const kaynaklar = (dir = SRC, cikti = []) => {
        for (const ad of readdirSync(dir)) {
            const yol = join(dir, ad)
            if (statSync(yol).isDirectory()) kaynaklar(yol, cikti)
            else if (/\.(js|vue|ts)$/.test(ad) && !/\.test\.(js|ts)$/.test(ad)) cikti.push(yol)
        }
        return cikti
    }
    const goreli = (yol) => relative(SRC, yol).split('\\').join('/')
    // F1 (Dilim 0b son inceleme): bu tarama ~456 dosyayi bes kez yeniden okuyordu (soguk calisma 12,5 sn; sinir 15 sn).
    // Dosya listesi ve ham metinler bu describe icinde BIR KEZ okunur, testler ayni onbellegi paylasir.
    let liste = null
    const tumKaynaklar = () => (liste ??= kaynaklar())
    const hamMetinler = new Map()
    const oku = (yol) => {
        if (!hamMetinler.has(yol)) hamMetinler.set(yol, readFileSync(yol, 'utf8'))
        return hamMetinler.get(yol)
    }
    const kod = (goreliYol) => yorumsuz(oku(join(SRC, goreliYol)))
    // `iz` ham metinde yoksa dosya yorumsuzlanmaz (hiz); varsa YORUM DISI kodda `re` aranir.
    const nerede = (iz, re) => tumKaynaklar()
        .filter((yol) => { const ham = oku(yol); return ham.includes(iz) && re.test(yorumsuz(ham)) })
        .map(goreli).sort()

    it('kaynak taramasi dosyalari buluyor (bos tarama yesil sayilmaz)', () => {
        const dosyalar = tumKaynaklar().map(goreli)
        expect(dosyalar.length).toBeGreaterThan(300)
        expect(dosyalar).toContain('utils/analyticsPing.js')
        expect(dosyalar).toContain('background.js')
    })

    it('govdenin anahtarlari TAM { installId, locale, version } ve hicbir degerde adres yok', async () => {
        // Depoda Gizli Hesap kaydi ve genel hesap adresi dururken bile govdeye girmez.
        const o = kos(depo({ active_account: genel, vaults: [{ privateAccount: gizli }] }))
        await runAnalyticsPing(o)

        const govde = o.post.mock.calls[0][0]
        expect(Object.keys(govde).sort()).toEqual(['installId', 'locale', 'version'])
        expect(JSON.stringify(govde)).not.toMatch(/0x[0-9a-fA-F]{40}/)
    })

    it('installId yalniz utils/analyticsPing.js icinde gecer (baska hicbir kaynakta kurulum kimligi yok)', () => {
        expect(nerede('installId', /\binstallId\b/)).toEqual(['utils/analyticsPing.js'])
    })

    it('kalici kimlik deposu (analytics_state) yalniz utils/analyticsPing.js icinde', () => {
        expect(nerede('analytics_state', /analytics_state/)).toEqual(['utils/analyticsPing.js'])
        expect(nerede('ANALYTICS_STATE_KEY', /\bANALYTICS_STATE_KEY\b/)).toEqual(['utils/analyticsPing.js'])
    })

    it('ping yalniz arka plan alarmindan baslar: runAnalyticsPing yalniz background.js ve ping modulunde', () => {
        expect(nerede('runAnalyticsPing', /\brunAnalyticsPing\b/)).toEqual(['background.js', 'utils/analyticsPing.js'])
    })

    it('analytics/ping adresi yalniz background.js icinde ve tek kez', () => {
        expect(nerede('analytics/ping', /analytics\/ping/)).toEqual(['background.js'])
        expect(kod('background.js').split('analytics/ping').length - 1).toBe(1)
    })

    it('ping modulu hesap adresine dokunmaz: kaynakta yalniz active_account.private okunur', () => {
        const modul = kod('utils/analyticsPing.js')
        expect(modul).toContain("'active_account'")
        expect(modul).toContain('active_account?.private === true')
        expect(modul).not.toMatch(/\baddress\b|privateAccount|getAddress|mnemonic|vaults|derivationPath/)
    })

    it('ping modulu privateMode parametresini alir ve modul bayragina VEYA ile baglar (iki kapi)', () => {
        const modul = kod('utils/analyticsPing.js')
        expect(modul).toMatch(/privateMode\s*=\s*false/)
        expect(modul).toMatch(/privateMode:\s*Boolean\(privateMode\)\s*\|\|\s*stored\.active_account\?\.private === true/)
    })

    it('background pingAnalytics gizli mod kararini KIMLIKLE verir: privateMode: await activeIsPrivate()', () => {
        const bg = kod('background.js')
        const bas = bg.indexOf('async function pingAnalytics()')
        expect(bas).toBeGreaterThan(-1)
        const govde = bg.slice(bas, bg.indexOf('\n}', bas))
        expect(govde).toContain('privateMode: await activeIsPrivate()')
        // Karari veren yardimci kimlik kuralini kullanir (isPrivateIdentity), yalniz bayrak degil.
        const yardimci = bg.slice(bg.indexOf('async function activeIsPrivate()'), bg.indexOf('\n}', bg.indexOf('async function activeIsPrivate()')))
        expect(yardimci).toMatch(/isPrivateIdentity\(\s*active_account\s*,\s*privateContextFrom\(\s*vaults\s*\)\s*\)/)
    })

    it('background pingAnalytics: tek axios cagrisi, baslik / kimlik bilgisi / hesap verisi yok', () => {
        const bg = kod('background.js')
        const bas = bg.indexOf('async function pingAnalytics()')
        expect(bas).toBeGreaterThan(-1)
        const govde = bg.slice(bas, bg.indexOf('\n}', bas))
        expect(govde.match(/axios\./g)).toHaveLength(1)
        expect(govde).not.toMatch(/headers|withCredentials|Authorization|address|active_account/i)
    })

    it('AnalyticsNotice yalniz yerel depoyu okur / yazar: ag ya da mesaj cagrisi yok (Gizli modda da cizilir)', () => {
        expect(kod('components/AnalyticsNotice.vue')).not.toMatch(/\baxios\b|\bfetch\(|sendMessage|XMLHttpRequest|sendBeacon|chrome\.runtime/)
    })
})
