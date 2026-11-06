// useAccountScan: tarama durumu (satirlar, "kontrol ediliyor", Atla). Ilk describe'ta `scan`
// testte elle kurulur (onProgress'i cagirip cozulur); ikincisinde gercek scanUsedAccounts
// kosar, yalniz yoklama sahtedir. Ag ve zamanlayici bu dosyada YOK.
//
// Bu composable'in iki sozlesmesi uygulamanin "ekranda takili kalma" anti-hedefini tasir:
//   - start() HICBIR kosulda firlatmaz / reddedilmez ve phase her zaman 'done'a ulasir,
//   - skip() asili (iptale yanit vermeyen) bir tarama olsa bile ekrani serbest birakir.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { HDNodeWallet } from 'ethers'
import { useAccountScan } from './useAccountScan'

// Bilinen test ifadesi (Hardhat): gercek bir cuzdan degil, yalnizca turetme dogrulugu icin.
const JUNK = 'test test test test test test test test test test test junk'
const BASE = HDNodeWallet.fromPhrase(JUNK, '', "m/44'/60'/0'/0")
const addrOf = (i) => BASE.deriveChild(i).address
const SKIPPED = { accountCount: 1, usedIndexes: [], outcome: 'skipped' }
const ERROR = { accountCount: 1, usedIndexes: [], outcome: 'error' }
const nameOf = (i) => `Wats ${i + 1}`

// Her cagrida `onProgress` ve `signal`i yakalayan, HIC COZULMEYEN (asili) sahte tarama.
// `runs[n]` n. start()'in `scan`e verdigi secenekler.
function hangingScan() {
    const runs = []
    const scan = vi.fn((opts) => {
        runs.push(opts)
        return new Promise(() => {})
    })
    return { scan, runs }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('useAccountScan', () => {
    it('olaylar satirlari ve "kontrol ediliyor" durumunu doldurur', async () => {
        const scan = vi.fn(async ({ onProgress }) => {
            onProgress({ type: 'included', index: 0, address: '0xA0', used: true })
            onProgress({ type: 'checking', index: 1, address: '0xA1' })
            onProgress({ type: 'checked', index: 1, address: '0xA1', status: 'used' })
            onProgress({ type: 'included', index: 1, address: '0xA1', used: true })
            return { accountCount: 2, usedIndexes: [1], outcome: 'completed' }
        })
        const s = useAccountScan({ scan, probe: 'P' })
        const r = await s.start(JUNK, { nameFor: (i) => `Wats ${i + 1}` })
        expect(s.rows.value).toEqual([
            { index: 0, name: 'Wats 1', address: '0xA0', used: true },
            { index: 1, name: 'Wats 2', address: '0xA1', used: true },
        ])
        expect(s.checking.value).toBeNull()
        expect(s.phase.value).toBe('done')
        expect(s.result.value).toEqual(r)
        expect(scan).toHaveBeenCalledWith(expect.objectContaining({ mnemonic: JUNK, probe: 'P' }))
    })

    it('tarama surerken: phase scanning, "kontrol ediliyor" satiri olayla gelir ve olayla kalkar', () => {
        // Yukaridaki test yalniz SON durumu olcer (orada checking zaten null); ara durumu burada kilitleriz.
        const h = hangingScan()
        const s = useAccountScan({ scan: h.scan, probe: 'P' })
        expect(s.phase.value).toBe('idle')
        void s.start(JUNK, { nameFor: nameOf })
        expect(s.phase.value).toBe('scanning')
        expect(h.runs[0].signal.aborted).toBe(false)

        h.runs[0].onProgress({ type: 'included', index: 0, address: '0xA0', used: true })
        h.runs[0].onProgress({ type: 'checking', index: 1, address: '0xA1' })
        expect(s.checking.value).toEqual({ index: 1, name: 'Wats 2', address: '0xA1' })
        expect(s.rows.value).toHaveLength(1)
        expect(s.result.value).toBeNull()

        h.runs[0].onProgress({ type: 'checked', index: 1, address: '0xA1', status: 'unused' })
        expect(s.checking.value).toBeNull()
        expect(s.phase.value).toBe('scanning')
    })

    it('nameFor verilmezse adlar bos dizgidir', () => {
        const h = hangingScan()
        const s = useAccountScan({ scan: h.scan, probe: 'P' })
        void s.start(JUNK)
        h.runs[0].onProgress({ type: 'included', index: 0, address: '0xA0', used: true })
        h.runs[0].onProgress({ type: 'checking', index: 1, address: '0xA1' })
        expect(s.rows.value[0].name).toBe('')
        expect(s.checking.value.name).toBe('')
    })

    it("skip: signal iptal edilir, asili tarama beklenmeden 'skipped' ve 1 hesap doner", async () => {
        let signal
        const scan = vi.fn((o) => {
            signal = o.signal
            return new Promise(() => {}) // hic cozulmez
        })
        const s = useAccountScan({ scan, probe: 'P' })
        const started = s.start(JUNK)
        s.skip()
        expect(await started).toEqual({ accountCount: 1, usedIndexes: [], outcome: 'skipped' })
        expect(signal.aborted).toBe(true)
        expect(s.phase.value).toBe('done')
    })

    it('skip sonrasi gelen olaylar yok sayilir', async () => {
        let emit
        const scan = vi.fn((o) => {
            emit = o.onProgress
            return new Promise(() => {})
        })
        const s = useAccountScan({ scan, probe: 'P' })
        const started = s.start(JUNK, { nameFor: (i) => `W${i}` })
        emit({ type: 'included', index: 0, address: '0xA0', used: true })
        s.skip()
        await started
        emit({ type: 'included', index: 5, address: '0xA5', used: true })
        emit({ type: 'checking', index: 6, address: '0xA6' })
        expect(s.rows.value.map((r) => r.index)).toEqual([0])
        expect(s.checking.value).toBeNull()
    })

    it('skip, yayilmis satirlari geri alir: yalniz ilk satir kalir ve "kontrol ediliyor" kalkar', async () => {
        // accountScan 'skipped' donerken onceden yaydigi 'included' olaylarini geri almaz; "Atla" denince
        // eklenecek tek hesap Hesap 1'dir, liste de bunu gostermeli (defter: Task 3 notu).
        const h = hangingScan()
        const s = useAccountScan({ scan: h.scan, probe: 'P' })
        const started = s.start(JUNK, { nameFor: nameOf })
        const emit = h.runs[0].onProgress
        emit({ type: 'included', index: 0, address: '0xA0', used: true })
        emit({ type: 'checking', index: 2, address: '0xA2' })
        emit({ type: 'checked', index: 2, address: '0xA2', status: 'used' })
        emit({ type: 'included', index: 1, address: '0xA1', used: false })
        emit({ type: 'included', index: 2, address: '0xA2', used: true })
        emit({ type: 'checking', index: 3, address: '0xA3' })
        expect(s.rows.value).toHaveLength(3)

        s.skip()
        // skip() aninda, start() donusunu beklemeden:
        expect(s.rows.value.map((r) => r.index)).toEqual([0])
        expect(s.checking.value).toBeNull()

        expect(await started).toEqual(SKIPPED)
        expect(s.rows.value.map((r) => r.index)).toEqual([0])
        expect(s.result.value).toEqual(SKIPPED)
    })

    it("skip her zaman kazanir: tarama ayni anda bitmis olsa bile sonuc 'skipped' ve tek hesaptir", async () => {
        // scan zaten cozulmus bir sozle doner; skip() ayni senkron blokta gelir. Kullanici "Atla" dediyse
        // yalniz Hesap 1 yazilmali: sonuc 'completed / 3 hesap' olarak sizamaz.
        const scan = vi.fn(async () => ({ accountCount: 3, usedIndexes: [2], outcome: 'completed' }))
        const s = useAccountScan({ scan, probe: 'P' })
        const started = s.start(JUNK)
        s.skip()
        expect(await started).toEqual(SKIPPED)
        expect(s.result.value).toEqual(SKIPPED)
        expect(s.phase.value).toBe('done')
    })

    it('scan firlatirsa start FIRLATMAZ: tek hesap ve outcome error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const s = useAccountScan({
            scan: async () => {
                throw new Error('boom')
            },
            probe: 'P',
        })
        expect(await s.start(JUNK)).toEqual({ accountCount: 1, usedIndexes: [], outcome: 'error' })
        // Sessiz hatanin tek izi konsoldur.
        expect(console.error).toHaveBeenCalledTimes(1)
        expect(s.phase.value).toBe('done')
        expect(s.result.value).toEqual(ERROR)
    })

    it('scan yarida firlatirsa: bulunan satirlar atilir (eklenecek tek hesap), phase done', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const scan = vi.fn(async ({ onProgress }) => {
            onProgress({ type: 'included', index: 0, address: '0xA0', used: true })
            onProgress({ type: 'included', index: 1, address: '0xA1', used: true })
            onProgress({ type: 'checking', index: 2, address: '0xA2' })
            throw new Error('boom')
        })
        const s = useAccountScan({ scan, probe: 'P' })
        expect(await s.start(JUNK, { nameFor: nameOf })).toEqual(ERROR)
        // `rows` = eklenecek hesaplar: sonuc 1 hesap diyorsa liste de 1 satir gosterir.
        expect(s.rows.value.map((r) => r.index)).toEqual([0])
        expect(s.checking.value).toBeNull()
        expect(s.phase.value).toBe('done')
    })

    it.each([
        ['senkron firlatma', () => { throw new Error('sync boom') }],
        ['sonuc yok (undefined)', () => undefined],
        ['gecersiz hesap sayisi (0)', async () => ({ accountCount: 0, usedIndexes: [], outcome: 'completed' })],
    ])('bozuk scan (%s): start firlatmaz, phase done, tek hesap ve error', async (_ad, scan) => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const s = useAccountScan({ scan, probe: 'P' })
        expect(await s.start(JUNK)).toEqual(ERROR)
        expect(s.phase.value).toBe('done')
        expect(s.result.value).toEqual(ERROR)
    })

    it('taramadan once cagrilan skip etkisizdir', () => {
        const s = useAccountScan({ scan: vi.fn(), probe: 'P' })
        expect(() => s.skip()).not.toThrow()
        expect(s.phase.value).toBe('idle')
    })

    it('skip art arda cagrilirsa zararsizdir', async () => {
        const h = hangingScan()
        const s = useAccountScan({ scan: h.scan, probe: 'P' })
        const started = s.start(JUNK, { nameFor: nameOf })
        h.runs[0].onProgress({ type: 'included', index: 0, address: '0xA0', used: true })
        s.skip()
        expect(() => s.skip()).not.toThrow()
        expect(await started).toEqual(SKIPPED)
        expect(s.rows.value.map((r) => r.index)).toEqual([0])
        expect(s.phase.value).toBe('done')
    })

    it('tarama bittikten sonra skip etkisizdir: sonuc, satirlar ve phase degismez', async () => {
        // Kaydediliyor ekraninda Atla gizlidir; yine de composable seviyesinde de hicbir seyi durduramaz.
        const scan = vi.fn(async ({ onProgress }) => {
            onProgress({ type: 'included', index: 0, address: '0xA0', used: true })
            onProgress({ type: 'included', index: 1, address: '0xA1', used: true })
            return { accountCount: 2, usedIndexes: [1], outcome: 'completed' }
        })
        const s = useAccountScan({ scan, probe: 'P' })
        const r = await s.start(JUNK, { nameFor: nameOf })
        s.skip()
        expect(s.result.value).toEqual(r)
        expect(r.outcome).toBe('completed')
        expect(s.rows.value).toHaveLength(2)
        expect(s.phase.value).toBe('done')
    })

    it('tarama surerken yeni start eskisini birakir: eskisi asili kalmaz, durum yenisine ait', async () => {
        const runs = []
        let finishSecond
        const scan = vi.fn((opts) => {
            runs.push(opts)
            return runs.length === 1 ? new Promise(() => {}) : new Promise((resolve) => { finishSecond = resolve })
        })
        const s = useAccountScan({ scan, probe: 'P' })

        const first = s.start(JUNK, { nameFor: nameOf })
        runs[0].onProgress({ type: 'included', index: 0, address: '0xA0', used: true })
        const second = s.start(JUNK, { nameFor: nameOf })

        // Eski tarama iptal edilir ve eski start() asili kalmaz...
        expect(runs[0].signal.aborted).toBe(true)
        expect(runs[1].signal.aborted).toBe(false)
        expect(await first).toEqual(SKIPPED)
        // ...ama ortak durumu yazmaz: yeni tarama suruyor, durum sifirlanmis.
        expect(s.phase.value).toBe('scanning')
        expect(s.result.value).toBeNull()
        expect(s.rows.value).toEqual([])

        // Eski taramanin gec olaylari yok sayilir, yenisinin olaylari uygulanir.
        runs[0].onProgress({ type: 'included', index: 7, address: '0xA7', used: true })
        runs[0].onProgress({ type: 'checking', index: 8, address: '0xA8' })
        expect(s.rows.value).toEqual([])
        expect(s.checking.value).toBeNull()
        runs[1].onProgress({ type: 'included', index: 0, address: '0xB0', used: true })
        expect(s.rows.value).toEqual([{ index: 0, name: 'Wats 1', address: '0xB0', used: true }])

        finishSecond({ accountCount: 1, usedIndexes: [], outcome: 'completed' })
        expect(await second).toEqual({ accountCount: 1, usedIndexes: [], outcome: 'completed' })
        expect(s.phase.value).toBe('done')
        expect(s.result.value).toEqual({ accountCount: 1, usedIndexes: [], outcome: 'completed' })
    })
})

// Sahte `scan` olay SEKLINI test sahibi belirler; burada olay akisini GERCEK scanUsedAccounts yayar
// (varsayilan `scan`, yalniz yoklama enjekte edilir). Boylece composable'in accountScan.js olay
// sozlesmesiyle (included/checking/checked, aradaki bos indeksler) uyumu ve varsayilan baglanti olculur.
describe('useAccountScan + gercek scanUsedAccounts', () => {
    it('aradaki bos indeksler used=false satir olur, adlar nameFor ile verilir', async () => {
        const probe = vi.fn(async (address) => (address === addrOf(2) ? 'used' : 'unused'))
        const s = useAccountScan({ probe })
        const r = await s.start(JUNK, { nameFor: nameOf })
        expect(r).toEqual({ accountCount: 3, usedIndexes: [2], outcome: 'completed' })
        expect(s.rows.value).toEqual([
            { index: 0, name: 'Wats 1', address: addrOf(0), used: true },
            { index: 1, name: 'Wats 2', address: addrOf(1), used: false },
            { index: 2, name: 'Wats 3', address: addrOf(2), used: true },
        ])
        expect(s.checking.value).toBeNull()
        expect(s.phase.value).toBe('done')
        expect(s.result.value).toEqual(r)
    })

    it('yoklama firlatirsa: start firlatmaz, import Hesap 1 ile surer', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const probe = vi.fn(async () => {
            throw new Error('rpc coktu')
        })
        const s = useAccountScan({ probe })
        expect(await s.start(JUNK, { nameFor: nameOf })).toEqual(ERROR)
        expect(s.rows.value.map((r) => r.index)).toEqual([0])
        expect(s.phase.value).toBe('done')
    })

    it('Atla: iptale hic yanit vermeyen yoklama ekrani tutamaz, yoklamaya giden sinyal iptal edilir', async () => {
        const probe = vi.fn(() => new Promise(() => {}))
        const s = useAccountScan({ probe })
        const started = s.start(JUNK, { nameFor: nameOf })
        // scan'in ilk dilimi senkron kosar: indeks 0 eklendi, indeks 1 yoklaniyor.
        expect(probe).toHaveBeenCalledTimes(1)
        expect(s.checking.value).toEqual({ index: 1, name: 'Wats 2', address: addrOf(1) })

        s.skip()
        expect(await started).toEqual(SKIPPED)
        expect(probe.mock.calls[0][1].signal.aborted).toBe(true)
        expect(s.rows.value.map((r) => r.index)).toEqual([0])
        expect(s.checking.value).toBeNull()
        expect(s.phase.value).toBe('done')
    })
})
