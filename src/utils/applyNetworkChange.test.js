import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Bu dosya IKI dalda AYRI AYRI yazildi (Solana ve TON) ve ikisi de AYNI ariza
// modunu buldu: applyNetworkChange her zincirde EVM RPC'lerini yokluyordu.
//
// TON: `rpc` listesi TASARIM GEREGI bos (zincire erisim kendi backend proxy'mizden).
// Bos liste -> findFastestRPC null -> `reachable = false` -> alert(). alert()
// SENKRONDUR ve ana is parcacigini kilitler; setCurrentNetwork'un tetikledigi Vue
// guncellemesi mikro-gorevde sirada bekledigi icin DOM daha boyanmadan donuyor:
// kullanici eski EVM arayuzune bakiyor. Uyari kapatilinca popup odagi kaybedip
// kapaniyor, tekrar acilinca ag zaten TON oldugundan kapilar dogru calisiyor.
//
// Solana: kayitta `rpc` alani HIC YOK (vm.js), yani `chain.rpc.map(...)` dogrudan
// TypeError atiyordu. setCurrentNetwork zaten zinciri degistirmisti ama eski-token
// temizligi ve CHAIN_CHANGED dapp bildirimi HIC calismiyordu (yakalanmamis hata
// networksPopup.vue'de akisi kesiyordu).
//
// Bu testler ORTAK kapiyi kilitler: EVM DISI zincirlerde ne RPC yoklamasi ne uyari
// olmali, ama EVM zincirlerinde uyari AYNEN durmali - gercekten erisilemeyen bir
// zincirde kullaniciyi sessiz birakmak daha kotu olurdu.

vi.mock('./testRPC', () => ({ findFastestRPC: vi.fn() }))

import { findFastestRPC } from './testRPC'
import { applyNetworkChange } from './applyNetworkChange'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import supported_chains from '../data/supported_chains.json'
import { SOLANA_CHAIN_ID } from './solana/constants'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === SOLANA_CHAIN_ID)
const ETHEREUM_CHAIN = supported_chains.find((c) => c.chainId === 1)

// TON ve ikinci EVM kaydi BILEREK elle yazildi: bu testler zincir kaydinin
// ALANLARINA (kind / rpc) bagli davranisi kilitliyor, paketteki JSON'un o gunku
// haline degil.
const TON = { name: 'TON', chainId: -239, kind: 'ton', rpc: [] }
const ETHEREUM = { name: 'Ethereum', chainId: 1, rpc: [{ url: 'https://eth.example' }] }

// Ceviri anahtari ve `name` parametresi birlikte donuyor: yanlis anahtarla atilan
// bir uyari testte sessizce dogru gorunmesin.
const t = (key, params) => `${key}:${params?.name ?? ''}`

let storage
let sentMessages
let alertSpy

// Store olusturulurken initializeCurrentNetwork() await edilmeden baslatiliyor
// (network.test.js'teki desenle ayni); bir tik beklenmezse yaris kosulu olusur.
const freshNetwork = async () => {
    const store = networkStore()
    await new Promise((resolve) => setTimeout(resolve, 0))
    return store
}

beforeEach(() => {
    setActivePinia(createPinia())
    findFastestRPC.mockReset()

    storage = {}
    sentMessages = []
    globalThis.chrome = {
        storage: {
            local: {
                get: vi.fn(async (k) => (typeof k === 'string' ? { [k]: storage[k] } : {})),
                set: vi.fn(async (obj) => { Object.assign(storage, obj) })
            }
        },
        runtime: {
            sendMessage: vi.fn((msg) => { sentMessages.push(msg); return Promise.resolve() })
        }
    }
    alertSpy = vi.fn()
    globalThis.alert = alertSpy
})

// vm.js tam bunu ongoruyordu: Solana kaydinda `rpc` alani BILEREK yok.
describe('applyNetworkChange — Solana secilince cokmez', () => {
    it('zincir gecer, eski token secimleri temizlenir, dapp CHAIN_CHANGED alir', async () => {
        await freshNetwork()
        const crypto = cryptoStore()
        crypto.swap.inToken = { symbol: 'USDC' }
        crypto.swap.outToken = { symbol: 'USDT' }
        crypto.bridge.inToken = { symbol: 'ETH' }
        crypto.bridge.outToken = { symbol: 'SOL' }
        crypto.bridge.toChain = 137
        crypto.bridge.amount = 5

        const reachable = await applyNetworkChange(SOLANA_CHAIN, t)

        expect(reachable).toBe(true)
        expect(networkStore().currentNetwork.chainId).toBe(SOLANA_CHAIN_ID)

        expect(crypto.swap.inToken).toBeNull()
        expect(crypto.swap.outToken).toBeNull()
        expect(crypto.bridge.inToken).toBeNull()
        expect(crypto.bridge.outToken).toBeNull()
        expect(crypto.bridge.toChain).toBeNull()
        expect(crypto.bridge.amount).toBe(0)

        expect(sentMessages).toContainEqual({ type: 'CHAIN_CHANGED', chainId: SOLANA_CHAIN_ID })

        // RPC hiz testi EVM'e ozgu; Solana'da rpc alani olmadigi icin hic cagrilmaz
        // (bos diziyle bile cagrilsa "erisilemez" uyarisi yanlis olurdu).
        expect(findFastestRPC).not.toHaveBeenCalled()
    })

    it('Solana secilince "hicbir dugum yanit vermedi" uyarisi ATMAZ', async () => {
        await freshNetwork()
        await applyNetworkChange(SOLANA_CHAIN, t)
        expect(alertSpy).not.toHaveBeenCalled()
    })
})

describe('applyNetworkChange — TON kapisi', () => {
    it('TON secilince EVM RPC yoklamasi YAPMAZ', async () => {
        await applyNetworkChange(TON, t)
        expect(findFastestRPC).not.toHaveBeenCalled()
    })

    it('TON secilince "hicbir dugum yanit vermedi" uyarisi ATMAZ', async () => {
        await applyNetworkChange(TON, t)
        expect(alertSpy).not.toHaveBeenCalled()
    })

    it('TON secilince erisilebilir doner — cagiran akis DURMAMALI', async () => {
        await expect(applyNetworkChange(TON, t)).resolves.toBe(true)
    })

    it('TON secilince aktif ag gercekten TON olur', async () => {
        await applyNetworkChange(TON, t)
        expect(networkStore().currentNetwork?.chainId).toBe(-239)
    })
})

describe('applyNetworkChange — EVM davranisi korunur (regresyon)', () => {
    it('hala RPC hiz testi calisir ve en hizli calisan uca gecer', async () => {
        await freshNetwork()
        findFastestRPC.mockResolvedValue({ url: 'https://eth-2.example' })

        const reachable = await applyNetworkChange(ETHEREUM_CHAIN, t)

        expect(reachable).toBe(true)
        // rpcUrlsOf(chain) ile cagriliyor; icerik paketteki kaydin rpc listesiyle AYNI
        // olmali — EVM tarafinda hicbir sey degismedi.
        expect(findFastestRPC).toHaveBeenCalledWith(ETHEREUM_CHAIN.rpc.map((r) => r.url))
        expect(networkStore().rpc).toBe('https://eth-2.example')
    })

    it('hicbir uc yanit vermezse reachable false doner ve mevcut RPC bozulmaz', async () => {
        await freshNetwork()
        findFastestRPC.mockResolvedValue(null)

        const reachable = await applyNetworkChange(ETHEREUM_CHAIN, t)

        expect(reachable).toBe(false)
        expect(alertSpy).toHaveBeenCalled()
    })

    it('EVM zincirinde hicbir RPC yanit vermezse uyari AYNEN atilir', async () => {
        findFastestRPC.mockResolvedValue(null)
        const reachable = await applyNetworkChange(ETHEREUM, t)
        expect(alertSpy).toHaveBeenCalledTimes(1)
        expect(reachable).toBe(false)
    })

    it('EVM zincirinde calisan RPC bulunursa uyari atilmaz', async () => {
        findFastestRPC.mockResolvedValue({ url: 'https://eth.example' })
        const reachable = await applyNetworkChange(ETHEREUM, t)
        expect(alertSpy).not.toHaveBeenCalled()
        expect(reachable).toBe(true)
    })
})

// AKIS KAPISI. Bu fonksiyon "aktif agi degistiren tek govde" olarak tasarlanmisti ama
// akisa bakmiyordu: Kopru ekranindaki zincir secicisi buraya TON gonderdiginde aktif
// ag TON oluyor, kullanici korumasiz bir kopru ekraninda kaliyordu.
//
// Kritik denge: kapi YALNIZCA acikca bir akis verildiginde calisir. Baslikta ag
// degistirip TON'a gecmek P1'de gelen MESRU bir akis; varsayilan fail-open olmasaydi
// bu duzeltme TON'u tumden erisilemez yapardi.
describe('applyNetworkChange — akis kapisi', () => {
    it('flow=bridge iken TON reddedilir ve setCurrentNetwork CAGRILMAZ', async () => {
        const store = networkStore()

        const reachable = await applyNetworkChange(TON, t, { flow: 'bridge' })

        // Nesne kimligi KARSILASTIRILMAZ: store'un kendi async acilisi (initializeCurrentNetwork)
        // bu arada varsayilan zinciri yazabiliyor ve o bir yaris, bizim degisimimiz degil.
        // Asil degismez su: aktif ag TON OLMAMALI.
        expect(reachable).toBe(false)
        expect(Number(store.currentNetwork?.chainId ?? 0)).not.toBe(-239)
    })

    // TAKAS artik TON'da ACIK: gecis KABUL EDILMELI, yoksa kullanici takas
    // ekranindan TON'a gecemez ve ozellik erisilemez kalir.
    it('flow=swap iken TON KABUL EDILIR', async () => {
        await expect(applyNetworkChange(TON, t, { flow: 'swap' })).resolves.toBe(true)
        expect(networkStore().currentNetwork?.chainId).toBe(-239)
    })

    // KOPRU HALA KAPALI. Takas kapisinin acilmasi kopruyu de acmis olmamali -
    // bu ikisi ayri kararlar ve ayri saglayicilar.
    it('flow=bridge iken TON REDDEDILIR', async () => {
        await expect(applyNetworkChange(TON, t, { flow: 'bridge' })).resolves.toBe(false)
    })

    it('flow VERILMEZSE TON kabul edilir — baslik ag secici kirilmaz', async () => {
        await applyNetworkChange(TON, t)
        expect(networkStore().currentNetwork?.chainId).toBe(-239)
    })

    it('flow=swap iken EVM zinciri AYNEN gecer', async () => {
        findFastestRPC.mockResolvedValue({ url: 'https://eth.example' })
        const reachable = await applyNetworkChange(ETHEREUM, t, { flow: 'swap' })
        expect(reachable).toBe(true)
        expect(networkStore().currentNetwork?.chainId).toBe(1)
    })

    it('reddedilen gecis dapp lere CHAIN_CHANGED yayinlamaz', async () => {
        await applyNetworkChange(TON, t, { flow: 'bridge' })
        expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    })

    // BIRLESME SONUCU (Solana + TON). Akis kapisi TON dalindan geliyor ama
    // chainSupportsFlow artik Solana'yi da TANIYOR (chainKind.js'teki NON_EVM_KINDS):
    // Faz 1'de Solana'da ne takas ne kopru var, ikisi de EVM motorlarina bagli
    // (Uniswap tarzi router tablosu / LI.FI). Kapi acik kalsaydi kullanici takas
    // ekranindan Solana'ya gecip motoru olmayan bir ekranda kalirdi — TON'da
    // duzeltilen ariza modunun AYNISI. Ag secici flow VERMEZ, ondan etkilenmez;
    // alttaki test onu ayrica kilitliyor.
    it('flow=swap iken Solana REDDEDILIR — Faz 1 de Solana takasi YOK', async () => {
        await expect(applyNetworkChange(SOLANA_CHAIN, t, { flow: 'swap' })).resolves.toBe(false)
    })

    it('flow=bridge iken Solana REDDEDILIR', async () => {
        await expect(applyNetworkChange(SOLANA_CHAIN, t, { flow: 'bridge' })).resolves.toBe(false)
    })

    it('flow VERILMEZSE Solana kabul edilir — ag secici kirilmaz', async () => {
        await freshNetwork()
        await applyNetworkChange(SOLANA_CHAIN, t)
        expect(networkStore().currentNetwork?.chainId).toBe(SOLANA_CHAIN_ID)
    })
})

// HESAP KAPISI. TON ifadesiyle ice aktarilmis bir hesabin EVM anahtari HIC
// URETILMEMISTIR; o hesapla Ethereum'a gecmek, imzalayacak anahtari olmayan bir agda
// islem hazirlamaktir. Kapi FAIL-OPEN: `active_account` okunamazsa kilit uygulanmaz
// (accountKind.js'in acik kurali) — yukaridaki testlerin hepsi bu yoldan geciyor.
describe('applyNetworkChange — hesap kapisi', () => {
    const TON_ACCOUNT = { key: 'ton-1', type: 'ton', address: 'UQB1' }

    it('TON hesabi EVM agina GECEMEZ', async () => {
        storage.active_account = TON_ACCOUNT

        const reachable = await applyNetworkChange(ETHEREUM, t)

        expect(reachable).toBe(false)
        expect(alertSpy).toHaveBeenCalledTimes(1)
        expect(findFastestRPC).not.toHaveBeenCalled()
    })

    it('TON hesabi TON agina gecebilir', async () => {
        storage.active_account = TON_ACCOUNT

        await expect(applyNetworkChange(TON, t)).resolves.toBe(true)
    })
})
