// ImportPhrases.vue: seed import'unda kullanilmis turetilmis hesaplarin taranmasi (Plan A, Gorev 8).
//
// Bilesen GERCEKTEN render edilir ve confirm() elle cagrilir (captureInstance, bkz. src/test-utils/ssrRender.js).
// GERCEK olanlar: HD turetme, tarama dongusu, useAccountScan, kasa kurulumu (PBKDF2/AES), addHdVaultToWallet ve
// chrome.storage sahtesi. SAHTE olanlar: ag yoklamasi (adres -> 'used'|'unused'|'failed' tablosu), TON tanima ve
// turetmesi (yavas, bu dosyanin konusu degil) ve oturum ana anahtari.
//
// 'vue' mock'u GEREKMEZ: ImportPhrases onMounted kullanmaz (CreatePassword2.accounts.ssr.test.js ile ayni).
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// vi.mock fabrikalari import'lardan ONCE calisir; testin kurdugu degiskenler buradan paylasilir.
const shared = vi.hoisted(() => ({ probe: null, locked: false, masterKey: null }))

vi.mock('../../utils/evmUsageProbe', () => ({
    probeEvmAddress: (...args) => shared.probe(...args),
}))
vi.mock('../../utils/ton/tonMnemonic', async (importOriginal) => ({
    ...(await importOriginal()),
    isTonMnemonic: async () => false,
}))
vi.mock('../../utils/ton/tonMamMnemonic', () => ({ isMamMnemonic: async () => false }))
vi.mock('../../utils/ton/newAccountTonAddress', () => ({
    tonFieldsForNewAccount: async (_m, i) => ({ tonAddress: 'UQ-test-' + i, tonScheme: 'test' }),
}))
// isLockError GERCEK kalir: kilit uyarisi onun taniyisina bagli.
vi.mock('../../utils/masterKey', async (importOriginal) => ({
    ...(await importOriginal()),
    requireSessionMasterKey: async () => {
        if (shared.locked) throw new Error('WALLET_LOCKED')
        return shared.masterKey
    },
}))

import { HDNodeWallet } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { deriveMasterKey, sha256, toHex } from '../../utils/crypto-utils'
import { userStore } from '../../store/user'
import en from '../../i18n/locales/en.json'
import ImportPhrases from './ImportPhrases.vue'

const JUNK = 'test test test test test test test test test test test junk'
const IP = en.onboarding.importPhrases
const AS = en.onboarding.accountScan

// SSR metni HTML-kacisli basar ("We're" -> "We&#39;re"); ham ceviriyle karsilastirma metin DOGRU basilsa bile kalirdi.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// JUNK ifadesinin MetaMask/Trust yolundaki ilk 20 adresi (indeks = dizi sirasi). Yoklama sahtesi adresten indekse bakar.
const ADDR = (() => {
    const base = HDNodeWallet.fromPhrase(JUNK, '', "m/44'/60'/0'/0")
    return Array.from({ length: 20 }, (_, i) => base.deriveChild(i).address)
})()

// Depoda onceden duran, BASKA bir seed'e ait tek HD hesapli kasa.
const VAULT_1 = {
    id: 'kasa-1',
    type: 'hd',
    fingerprint: 'baska-seed-parmak-izi',
    accounts: [{
        key: 'hesap-1', index: 0, name: 'Wats 1', type: 'hd', fingerprint: 'baska-seed-parmak-izi',
        address: '0x0000000000000000000000000000000000000001',
    }],
}

let JUNK_FINGERPRINT
beforeAll(async () => {
    shared.masterKey = await deriveMasterKey('parola-123', new Uint8Array(16))
    JUNK_FINGERPRINT = toHex(await sha256(new TextEncoder().encode(HDNodeWallet.fromPhrase(JUNK).privateKey)))
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete globalThis.chrome
    shared.locked = false
})

// confirm()'in catch'i console.error yazar; tarama kaynakli hatayi useAccountScan da console.error ile yutar.
const quietErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {})

/**
 * Ekrani render eder ve disaridan gorulebilen her seyi dondurur.
 *   vaults      depodaki kasalar
 *   used        'used' donen indeksler; failed: 'failed' donen indeksler ('all' = her adres)
 *   hangOn      o indeksin yoklamasi releaseHang(sonuc) cagrilana dek asili kalir
 *   probeThrows yoklama firlatir
 *   locked      oturum ana anahtari yok (cuzdan kilitli)
 *   setRejects  chrome.storage.local.set reddedilir (taramayla ILGISIZ hata)
 *   onProbe     her yoklamada { store, index } ile cagrilir (tarama SIRASINDA depoyu degistirmek icin)
 */
async function mountImport({
    vaults = [], used = [], failed = [], locked = false, hangOn, probeThrows = false, setRejects = false, onProbe,
} = {}) {
    const { localStore: store } = installChromeStub({ vaults: structuredClone(vaults) })

    // Her yazimin anindaki ekran asamasi da kaydedilir ('saving' asamasinda yazildigini kilitlemek icin).
    let s
    const phaseAtSet = []
    const realSet = globalThis.chrome.storage.local.set
    const setSpy = vi.spyOn(globalThis.chrome.storage.local, 'set').mockImplementation(async (obj) => {
        phaseAtSet.push(s?.phase)
        if (setRejects) throw new Error('disk')
        return realSet(obj)
    })

    let releaseHang
    const hanging = new Promise((resolve) => { releaseHang = resolve })
    const probe = vi.fn(async (address) => {
        const index = ADDR.indexOf(address)
        onProbe?.({ store, index })
        if (probeThrows) throw new Error('rpc patladi')
        if (index === hangOn) return hanging
        if (failed === 'all' || failed.includes(index)) return 'failed'
        return used.includes(index) ? 'used' : 'unused'
    })
    shared.probe = probe
    shared.locked = locked

    const alert = vi.fn()
    vi.stubGlobal('alert', alert)

    const onConfirmed = vi.fn()
    const onMnemonic = vi.fn()
    const onAccount_count = vi.fn()
    const app = createApp(ImportPhrases, { props: { onConfirmed, onMnemonic, onAccount_count } })
    const pinia = createTestPinia()
    app.use(pinia)
    app.use(createTestI18n())
    const captured = captureInstance(app, 'ImportPhrases')
    await render(app)
    s = captured.instance.setupState

    const waitUntil = async (fn, ms = 5000) => {
        const end = Date.now() + ms
        while (!fn()) {
            if (Date.now() > end) throw new Error('waitUntil: zaman asimi')
            await new Promise((resolve) => setTimeout(resolve, 5))
        }
    }

    return {
        s, store, probe, alert, onConfirmed, onMnemonic, onAccount_count, waitUntil, releaseHang, phaseAtSet,
        user: userStore(pinia),
        setCallsWith: (key) => setSpy.mock.calls.filter(([obj]) => key in obj),
        fill: () => { s.words = JUNK.split(' ') },
        confirm: async () => {
            s.words = JUNK.split(' ')
            await s.confirm()
        },
    }
}

describe('ImportPhrases: ilk cuzdan', () => {
    it('indeks 2 kullanilmis -> sonuc ekrani, hicbir sey yazilmaz; devam edilince account_count=3 ile password', async () => {
        const m = await mountImport({ vaults: [], used: [2] }); await m.confirm()
        expect(m.s.phase).toBe('result'); expect(m.onConfirmed).not.toHaveBeenCalled(); expect(m.store.vaults).toEqual([])
        expect(m.s.afterWrite).toBe(false)   // hesaplar henuz YAZILMADI: sifre adiminda yazilacak (ekran "eklenecek" der)
        // Ekranda gorunen satirlar = sifre adiminda olusacak hesaplar (indeks 0..2, Wats 1..3)
        expect(m.s.scanner.rows.value.map((r) => [r.index, r.name, r.address])).toEqual([0, 1, 2].map((i) => [i, `Wats ${i + 1}`, ADDR[i]]))
        m.s.continueAfterResult()
        expect(m.onAccount_count).toHaveBeenCalledWith(3); expect(m.onConfirmed).toHaveBeenCalledWith('password'); expect(m.onMnemonic).toHaveBeenCalledWith(JUNK)
    })

    it('hicbir hesap kullanilmamis -> sonuc ekrani YOK, account_count=1 ve password hemen', async () => {
        const m = await mountImport({ vaults: [] }); await m.confirm()
        expect(m.onAccount_count).toHaveBeenCalledWith(1); expect(m.onConfirmed).toHaveBeenCalledWith('password'); expect(m.s.phase).not.toBe('result')
    })

    it('olay sirasi: account_count, confirmed(password), mnemonic (ust ekran sayiyi ifadeyle birlikte okur)', async () => {
        const order = []
        const m = await mountImport({ vaults: [], used: [1] })
        m.onAccount_count.mockImplementation(() => order.push('account_count'))
        m.onConfirmed.mockImplementation(() => order.push('confirmed'))
        m.onMnemonic.mockImplementation(() => order.push('mnemonic'))
        await m.confirm(); m.s.continueAfterResult()
        expect(order).toEqual(['account_count', 'confirmed', 'mnemonic'])
    })

    it('sonuc ekraninda dugmeye art arda iki kez basmak devri iki kez yapmaz', async () => {
        const m = await mountImport({ vaults: [], used: [1] }); await m.confirm()
        m.s.continueAfterResult(); m.s.continueAfterResult()
        expect(m.onConfirmed).toHaveBeenCalledTimes(1); expect(m.onAccount_count).toHaveBeenCalledTimes(1)
    })

    it('Atla (indeks 1 yoklanirken): account_count=1 ile password, sonuc ekrani yok', async () => {
        const m = await mountImport({ vaults: [], used: [2], hangOn: 1 }); const done = m.confirm()
        await m.waitUntil(() => m.probe.mock.calls.length === 1); m.s.skipScan(); await done
        m.releaseHang('used')
        expect(m.onAccount_count).toHaveBeenCalledWith(1); expect(m.onConfirmed).toHaveBeenCalledWith('password'); expect(m.s.phase).not.toBe('result')
    })

    it('yarim tarama (ag hatasi): sonuc ekrani YOK, account_count=2 ve password hemen', async () => {
        const m = await mountImport({ vaults: [], used: [1], failed: [2] }); await m.confirm()
        expect(m.s.phase).not.toBe('result')
        expect(m.onAccount_count).toHaveBeenCalledWith(2); expect(m.onConfirmed).toHaveBeenCalledWith('password'); expect(m.alert).not.toHaveBeenCalled()
    })

    it('yoklama FIRLATSA bile akis surer: account_count=1 ve password, alert YOK', async () => {
        quietErrors()
        const m = await mountImport({ vaults: [], probeThrows: true }); await m.confirm()
        expect(m.onAccount_count).toHaveBeenCalledWith(1); expect(m.onConfirmed).toHaveBeenCalledWith('password'); expect(m.alert).not.toHaveBeenCalled()
    })
})

describe('ImportPhrases: cuzdan ekle', () => {
    it('indeks 1 kullanilmis -> TEK set, yeni kasada 2 hesap, aktif Hesap 1, sonuc ekrani; ready devam ile', async () => {
        const m = await mountImport({ vaults: [VAULT_1], used: [1] }); await m.confirm()
        expect(m.setCallsWith('vaults')).toHaveLength(1)
        expect(m.store.vaults[1].accounts.map((a) => a.index)).toEqual([0, 1])
        expect(m.store.active_account.key).toBe(m.store.vaults[1].accounts[0].key)
        expect(m.s.phase).toBe('result'); expect(m.onConfirmed).not.toHaveBeenCalled()
        expect(m.s.afterWrite).toBe(true)    // hesaplar YAZILDI: ekran "eklendi" der, dugme "Cuzdana git"
        m.s.continueAfterResult(); expect(m.onConfirmed).toHaveBeenCalledWith('ready')
    })

    it('yeni kasa: Wats 2.. adlari (ekrandaki satirlarla AYNI), kasanin parmak izi mukerrer kontroluyle AYNI, user deposu dolar', async () => {
        const m = await mountImport({ vaults: [VAULT_1], used: [1] }); await m.confirm()
        const yeni = m.store.vaults[1]
        expect(m.store.vaults[0].id).toBe('kasa-1')
        expect(yeni.accounts.map((a) => a.name)).toEqual(['Wats 2', 'Wats 3'])
        expect(m.s.scanner.rows.value.map((r) => r.name)).toEqual(['Wats 2', 'Wats 3'])   // gorunen ad = yazilan ad
        expect(yeni.accounts.map((a) => a.address)).toEqual(ADDR.slice(0, 2))
        expect(m.user.address).toBe(ADDR[0]); expect(m.user.vault.id).toBe(yeni.id)
        // addHdVaultToWallet mukerrer kontrolunu CAGIRANIN verdigi parmak iziyle yapar; kasanin gercek parmak iziyle
        // ayni degilse ayni seed ikinci kez sessizce yazilirdi.
        expect(yeni.fingerprint).toBe(JUNK_FINGERPRINT)
        expect(yeni.accounts.every((a) => a.fingerprint === JUNK_FINGERPRINT)).toBe(true)
    })

    it('yazim "saving" asamasinda yapilir (Atla gizli), tek set vaults + active_account birlikte', async () => {
        const m = await mountImport({ vaults: [VAULT_1], used: [1] }); await m.confirm()
        expect(m.phaseAtSet).toEqual(['saving'])
        expect(Object.keys(m.setCallsWith('vaults')[0][0]).sort()).toEqual(['active_account', 'vaults'])
    })

    it('tum RPCler hata -> import tamamlanir, 1 hesap, ready hemen, alert YOK', async () => {
        const m = await mountImport({ vaults: [VAULT_1], failed: 'all' }); await m.confirm()
        expect(m.store.vaults[1].accounts).toHaveLength(1); expect(m.onConfirmed).toHaveBeenCalledWith('ready'); expect(m.alert).not.toHaveBeenCalled()
    })

    it('kilitli cuzdan: kilit uyarisi taramadan ONCE verilir, probe hic cagrilmaz', async () => {
        quietErrors()
        const m = await mountImport({ vaults: [VAULT_1], locked: true }); await m.confirm()
        expect(m.alert).toHaveBeenCalledWith(IP.alert_wallet_locked); expect(m.probe).not.toHaveBeenCalled()
        expect(m.s.phase).toBe('form'); expect(m.onConfirmed).not.toHaveBeenCalled()
    })

    it('mukerrer seed: alert_already_imported, probe hic cagrilmaz, set yok', async () => {
        const m = await mountImport({ vaults: [{ ...VAULT_1, fingerprint: JUNK_FINGERPRINT }] }); await m.confirm()
        expect(m.alert).toHaveBeenCalledWith(IP.alert_already_imported); expect(m.probe).not.toHaveBeenCalled(); expect(m.setCallsWith('vaults')).toHaveLength(0)
    })

    it('Atla: indeks 1 yoklanirken skipScan -> yalniz Hesap 1 yazilir, gec gelen sonuc yok sayilir', async () => {
        const m = await mountImport({ vaults: [VAULT_1], hangOn: 1 }); const done = m.confirm()
        await m.waitUntil(() => m.probe.mock.calls.length === 1)
        expect(m.s.phase).toBe('scanning')   // tarama surerken form gizli, Atla gorunur asama
        m.s.skipScan(); await done
        m.releaseHang('used')   // asili yoklama sonradan 'used' dondurse bile
        expect(m.store.vaults[1].accounts).toHaveLength(1); expect(m.onConfirmed).toHaveBeenCalledWith('ready')
    })

    // Gorev 3 minor: Atla oncesi yayilmis 'included' satirlari geri alinmaz; ekranda "eklendi" gorunen satir KALMAMALI.
    it('Atla, 2 hesap bulunduktan sonra: satirlar hemen Hesap 1e iner, yalniz Hesap 1 yazilir, sonuc ekrani yok', async () => {
        const m = await mountImport({ vaults: [VAULT_1], used: [1], hangOn: 2 }); const done = m.confirm()
        await m.waitUntil(() => m.probe.mock.calls.length === 2)
        expect(m.s.scanner.rows.value.map((r) => r.index)).toEqual([0, 1])
        m.s.skipScan()
        expect(m.s.scanner.rows.value.map((r) => r.index)).toEqual([0])
        await done
        m.releaseHang('used')
        expect(m.s.scanner.rows.value.map((r) => r.index)).toEqual([0])
        expect(m.store.vaults[1].accounts.map((a) => a.index)).toEqual([0])
        expect(m.s.phase).not.toBe('result'); expect(m.onConfirmed).toHaveBeenCalledWith('ready')
    })

    it('yarim tarama (ag hatasi) 2+ hesap buldugunda sonuc ekrani YOK: bulunanlar sessizce eklenir, ready hemen, alert YOK', async () => {
        const m = await mountImport({ vaults: [VAULT_1], used: [1], failed: [2] }); await m.confirm()
        expect(m.s.phase).not.toBe('result')
        expect(m.store.vaults[1].accounts.map((a) => a.index)).toEqual([0, 1])   // bulunan hesap korunur
        expect(m.onConfirmed).toHaveBeenCalledWith('ready'); expect(m.alert).not.toHaveBeenCalled()
    })

    it('yoklama FIRLATSA bile import Hesap 1 ile tamamlanir: ready emit edilir, alert YOK, form geri gelmez (anti-hedef: tarama import i dusurmez)', async () => {
        quietErrors()   // useAccountScan hatayi console.error ile yutar
        const m = await mountImport({ vaults: [VAULT_1], probeThrows: true }); await m.confirm()
        expect(m.store.vaults[1].accounts).toHaveLength(1)
        expect(m.onConfirmed).toHaveBeenCalledWith('ready'); expect(m.alert).not.toHaveBeenCalled(); expect(m.s.phase).not.toBe('form')
    })

    it('taramayla ILGISIZ hata (depo yazimi reddi): form geri gelir, import_failed uyarisi, ready YOK', async () => {
        quietErrors()   // confirm catch i console.error yazar
        const m = await mountImport({ vaults: [VAULT_1], setRejects: true }); await m.confirm()
        expect(m.s.phase).toBe('form')
        expect(m.alert).toHaveBeenCalledWith(IP.alert_import_failed)
        expect(m.onConfirmed).not.toHaveBeenCalled()
    })

    // DEFTER KARARI (Ruling 2): duplicate donusu catch'e degil return'e bagli; phase sifirlanmazsa kullanici Atla'nin gizli
    // oldugu 'saving' ekraninda sonsuza dek kalirdi.
    it('tarama SIRASINDA baska pencere ayni seed i ekledi: alert_already_imported, form geri gelir, ready YOK, vaults yazilmaz', async () => {
        const m = await mountImport({
            vaults: [VAULT_1],
            onProbe: ({ store }) => {
                if (store.vaults.some((v) => v.fingerprint === JUNK_FINGERPRINT)) return
                store.vaults = [...store.vaults, { ...VAULT_1, id: 'ayni-seed', fingerprint: JUNK_FINGERPRINT }]
            },
        })
        await m.confirm()
        expect(m.alert).toHaveBeenCalledWith(IP.alert_already_imported)
        expect(m.s.phase).toBe('form')
        expect(m.onConfirmed).not.toHaveBeenCalled()
        expect(m.setCallsWith('vaults')).toHaveLength(0)
        expect(m.store.vaults.map((v) => v.id)).toEqual(['kasa-1', 'ayni-seed'])
    })

    // Gorev 5 ONERISI: giris korumasi (`importing`) silinirse ikinci start() birincisini 'skipped'/1 hesapla birakir.
    it('confirm art arda iki kez cagrilirsa ikinci cagri etkisiz: tek tarama, tek vaults yazimi', async () => {
        const m = await mountImport({ vaults: [VAULT_1] })
        m.fill()
        await Promise.all([m.s.confirm(), m.s.confirm()])
        expect(m.probe).toHaveBeenCalledTimes(3)   // indeks 1, 2, 3 (ucu de bos -> dur); ikinci tarama yok
        expect(m.setCallsWith('vaults')).toHaveLength(1)
        expect(m.store.vaults).toHaveLength(2)
    })
})

// SSR yalniz bir kez cizer ve tiklama gelmez; ekran durumu serverPrefetch kancasinda (sablondan ONCE) verilir
// (Receive.ssr.test.js ile ayni desen). <AccountScan> dalini render ettirir: baglar eksik/yanlis olsa burada dusulur.
async function renderScreen({ phase, afterWrite = false, rows = [], checking = null, override = {} }) {
    installChromeStub({ vaults: [] })
    const app = createApp(ImportPhrases)
    app.use(createTestPinia())
    app.use(createTestI18n())
    captureInstance(app, 'ImportPhrases', (instance) => {
        const state = instance.setupState
        state.phase = phase
        state.afterWrite = afterWrite
        state.scanner.rows.value = rows
        state.scanner.checking.value = checking
        Object.assign(state, override)
    })
    const child = captureInstance(app, 'AccountScan')
    const html = await render(app)
    return { html, child: child.instance }
}

const ROWS = [
    { index: 0, name: 'Wats 1', address: ADDR[0], used: true },
    { index: 1, name: 'Wats 2', address: ADDR[1], used: true },
]

describe('ImportPhrases: ekran asamalari AccountScan a dogru baglanir', () => {
    it('form: ifade formu gorunur, AccountScan yok', async () => {
        const { html, child } = await renderScreen({ phase: 'form' })
        expect(html).toContain(esc(IP.btn_submit)); expect(html).toContain(esc(IP.title))
        expect(child).toBeNull(); expect(html).not.toContain(esc(AS.title_scanning))
    })

    it('scanning: form gizlenir; satirlar, kontrol satiri ve ilk satirin adiyla Atla gorunur', async () => {
        const checking = { index: 2, name: 'Wats 3', address: ADDR[2] }
        const { html, child } = await renderScreen({ phase: 'scanning', rows: ROWS, checking })
        expect(html).not.toContain(esc(IP.btn_submit)); expect(html).not.toContain(esc(IP.title))
        expect(child.props.phase).toBe('scanning'); expect(child.props.checking).toEqual(checking)
        expect(child.props.rows.map((r) => r.index)).toEqual([0, 1]); expect(child.props.firstName).toBe('Wats 1')
        expect(html).toContain(esc(AS.title_scanning)); expect(html).toContain(esc(AS.checking))
        expect(html).toContain(esc(AS.btn_skip.replace('{name}', 'Wats 1')))
    })

    it('saving: Atla ve kontrol satiri yok', async () => {
        const { html, child } = await renderScreen({ phase: 'saving', rows: ROWS, checking: { index: 2, name: 'Wats 3', address: ADDR[2] } })
        expect(child.props.phase).toBe('saving')
        expect(html).not.toContain(esc(AS.btn_skip.replace('{name}', 'Wats 1'))); expect(html).not.toContain(esc(AS.checking))
    })

    it('result + afterWrite=true (cuzdan ekle): "eklendi" notu ve Cuzdana git', async () => {
        const { html, child } = await renderScreen({ phase: 'result', afterWrite: true, rows: ROWS })
        expect(child.props.phase).toBe('result'); expect(child.props.afterWrite).toBe(true)
        expect(html).toContain(esc(AS.title_found.replace('{count}', '2')))
        expect(html).toContain(esc(AS.note_added)); expect(html).toContain(esc(AS.btn_go_wallet))
        expect(html).not.toContain(esc(AS.btn_continue))
    })

    it('result + afterWrite=false (ilk cuzdan): "eklenecek" notu ve Devam et', async () => {
        const { html, child } = await renderScreen({ phase: 'result', afterWrite: false, rows: ROWS })
        expect(child.props.afterWrite).toBe(false)
        expect(html).toContain(esc(AS.note_will_add)); expect(html).toContain(esc(AS.btn_continue))
        expect(html).not.toContain(esc(AS.btn_go_wallet))
    })

    it('@skip skipScan a, @continue continueAfterResult a gider (yer degistirmis baglar dusurulur)', async () => {
        const skipScan = vi.fn()
        const continueAfterResult = vi.fn()
        const { child } = await renderScreen({ phase: 'result', rows: ROWS, override: { skipScan, continueAfterResult } })
        child.vnode.props.onContinue()
        expect(continueAfterResult).toHaveBeenCalledTimes(1); expect(skipScan).not.toHaveBeenCalled()
        child.vnode.props.onSkip()
        expect(skipScan).toHaveBeenCalledTimes(1); expect(continueAfterResult).toHaveBeenCalledTimes(1)
    })
})

// Kaynak taramalari: davranis testlerinin olcemedigi baglar ve sira.
const IMPORT = readFileSync(fileURLToPath(new URL('./ImportPhrases.vue', import.meta.url)), 'utf8')
const CONFIRM = IMPORT.slice(IMPORT.indexOf('const confirm ='))   // importTonWallet in cagrisini disarida birakir

describe('ImportPhrases: kaynak taramalari', () => {
    it('<AccountScan kullanir; form kapsayicisi v-if="phase === \'form\'" ile sarilidir', () => {
        expect(IMPORT).toMatch(/import AccountScan from '\.\/AccountScan\.vue'/)
        expect(IMPORT).toContain('<AccountScan')
        expect(IMPORT).toMatch(/<div\s+v-if="phase === 'form'"\s+class="relative w-full max-w-2xl space-y-6 md:space-y-8"/)
    })

    it('AccountScan etiketi dogru baglari tasir (v-else, phase, rows, checking, first-name, after-write, skip, continue)', () => {
        const bas = IMPORT.indexOf('<AccountScan')
        const etiket = IMPORT.slice(bas, IMPORT.indexOf('/>', bas))
        expect(etiket).toMatch(/\bv-else\b/)
        expect(etiket).toMatch(/:phase="phase"/)
        expect(etiket).toMatch(/:rows="scanner\.rows\.value"/)
        expect(etiket).toMatch(/:checking="scanner\.checking\.value"/)
        expect(etiket).toMatch(/:first-name="scanner\.rows\.value\[0\]\?\.name \?\? ''"/)
        expect(etiket).toMatch(/:after-write="afterWrite"/)
        expect(etiket).toMatch(/@skip="skipScan"/)
        expect(etiket).toMatch(/@continue="continueAfterResult"/)
    })

    it("defineEmits 'account_count' i bildirir ve confirm govdesi onu yayar", () => {
        expect(IMPORT).toMatch(/defineEmits\(\[[^\]]*'account_count'[^\]]*\]\)/)
        expect(CONFIRM).toMatch(/emit\('account_count', count\)/)
    })

    it('confirm govdesinde scanner.start( cagrisi requireSessionMasterKey() cagrisindan SONRA gelir', () => {
        const key = CONFIRM.indexOf('requireSessionMasterKey()'), scan = CONFIRM.indexOf('scanner.start(')
        expect(key).toBeGreaterThan(-1); expect(scan).toBeGreaterThan(-1)   // ikisi de confirm icinde VAR (bos gecmeyi onler)
        expect(scan).toBeGreaterThan(key)
    })

    it("confirm govdesinde phase 'saving' atamasi buildHdAccounts( cagrisindan ONCE gelir", () => {
        const saving = CONFIRM.indexOf("phase.value = 'saving'"), build = CONFIRM.indexOf('buildHdAccounts(')
        expect(saving).toBeGreaterThan(-1); expect(build).toBeGreaterThan(-1)
        expect(saving).toBeLessThan(build)
    })

    it('eski tek hesapli yazim kalmadi: Wallet.fromPhrase, createVault ve iki ayri set yok', () => {
        expect(IMPORT).not.toMatch(/\bWallet\.fromPhrase/)   // HDNodeWallet.fromPhrase (parmak izi) KALIR
        expect(IMPORT).not.toMatch(/\bcreateVault\(/)
        expect(CONFIRM).not.toMatch(/chrome\.storage\.local\.set\(/)   // yazim addHdVaultToWallet icinde (tek set)
    })
})
