import { describe, it, expect, vi } from 'vitest'
import { Address } from '@ton/core'
import {
    sendTonSwap, swapGasFor, MAX_PRICE_IMPACT, NATIVE_SWAP_SENTINEL,
} from './tonSwap'

// GERCEK, ayristirilabilir adresler. Uydurma dize ('EQ1') Address.parse
// tarafindan reddedilir ve testler YANLIS SEBEPTEN duser - bu tuzak bu oturumda
// uc kez yasandi.
const OWNER = 'UQBdZGtyeYCHjpWco6qxuL_GzdTb4unw9_4FDBMaISgvNoE_'
const USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const NOT = 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT'
const PTON = 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S'
const ROUTER = 'EQByADL5Ra2dldrMSBctgfSm2X2W1P61NVW2RYDb8eJNJGx6'
const MY_JETTON_WALLET = 'EQDJ0Nfe5ezz-gEIDxYdJCsyOUBHTlVcY2pxeH-GjZSboriR'

const ROUTER_INFO = {
    address: ROUTER, majorVersion: 2, minorVersion: 2,
    routerType: 'ConstantProduct', ptonMasterAddress: PTON,
}

const QUOTE = {
    offerAddress: USDT,
    askAddress: NOT,
    offerUnits: '1000000',        // 1 USDT @ 6 ondalik
    askUnits: '500000000000',
    // BILEREK askUnits'in %99'u DEGIL (o 495000000000 ederdi).
    //
    // MUTASYON BOSLUGU - BU OTURUMDA DORDUNCU KEZ: fixture minAskUnits'i
    // askUnits'ten turetilebilir bir deger yapinca, "minAskAmount'i askUnits'ten
    // hesapla" mutasyonu AYNI sayiyi uretiyor ve hicbir test dusmuyor. Yani
    // kayma korumasinin TEKLIFTEN geldigi kurali test edilmemis oluyor.
    // Ayni sinif tuzak daha once jetton altin vektorlerinde, tonSwapQuote
    // fixture'inda ve pTON filo fixture'inda yasandi.
    minAskUnits: '400000000000',
    poolAddress: null,
    priceImpact: 0.001,
    feeUnits: '3000',
    router: ROUTER_INFO,
    fetchedAt: Date.now(),
}

const USDT_ASSET = { address: USDT, decimals: 6 }
const NOT_ASSET = { address: NOT, decimals: 9 }
const TON_ASSET = { address: NATIVE_SWAP_SENTINEL, decimals: 9 }

function makeHarness(over = {}) {
    const sent = []
    const sdkCalls = []

    const client = {
        getBalance: async () => 2_000_000_000n,                 // 2 TON
        getContractState: async () => ({ state: 'active' }),
        open: (contract) => {
            // Sahte router AYNEN gecer: gasConstants ve takas metotlari onda.
            if (contract?.gasConstants) return contract
            if (typeof contract?.getWalletAddress === 'function') {
                return { getWalletAddress: async () => Address.parse(MY_JETTON_WALLET) }
            }
            return { getBalance: async () => 5_000_000n }        // 5 USDT
        },
        ...over.client,
    }

    const wallet = {
        address: Address.parse(OWNER),
        getSeqno: async () => 11,
        sendTransfer: async (args) => { sent.push(args) },
    }

    // SDK'nin yerine gecen sahte router fabrikasi. GERCEK SDK burada
    // CAGRILMAZ: bu dosya kapilari test ediyor, SDK'nin govde uretimini degil -
    // o Gorev 3'te zincire karsi dogrulandi.
    const routerFactory = vi.fn((info) => {
        sdkCalls.push({ kind: 'factory', info })
        return {
            getSwapJettonToJettonTxParams: async (p) => { sdkCalls.push({ kind: 'j2j', p }); return TX_PARAMS },
            getSwapJettonToTonTxParams: async (p) => { sdkCalls.push({ kind: 'j2t', p }); return TX_PARAMS },
            getSwapTonToJettonTxParams: async (p) => { sdkCalls.push({ kind: 't2j', p }); return TX_PARAMS },
            gasConstants: GAS,
        }
    })
    const dexFactory = vi.fn(() => ({ pTON: class { constructor(a) { this.address = a } } }))

    return { client, wallet, sent, sdkCalls, routerFactory, dexFactory }
}

const TX_PARAMS = { to: Address.parse(ROUTER), value: 300_000_000n, body: null }
const GAS = {
    swapJettonToJetton: { gasAmount: 300_000_000n, forwardGasAmount: 240_000_000n },
    swapJettonToTon: { gasAmount: 300_000_000n, forwardGasAmount: 240_000_000n },
    swapTonToJetton: { forwardGasAmount: 300_000_000n },
}

const args = (h, over = {}) => ({
    client: h.client, wallet: h.wallet, keyPair: { secretKey: new Uint8Array(64) },
    quote: QUOTE, offerAsset: USDT_ASSET, askAsset: NOT_ASSET, amount: '1',
    owner: OWNER, chainId: -239, storage: { get: async () => ({}), set: async () => {} },
    pendingTransactions: [], testnet: false,
    routerFactory: h.routerFactory, dexFactory: h.dexFactory,
    ...over,
})

// ---------------------------------------------------------------------------
describe('KAPI 1 — teklif tazeligi', () => {
    // Bayat teklifle imzalamak, kullanicinin EKRANDA GORDUGU fiyatla zincire
    // GIDEN fiyatin ayrismasi demektir.
    it('bayat teklif DURDURUR', async () => {
        const h = makeHarness()
        const stale = { ...QUOTE, fetchedAt: Date.now() - 10 * 60 * 1000 }
        await expect(sendTonSwap(args(h, { quote: stale }))).rejects.toThrow('TON_SWAP_QUOTE_STALE')
        expect(h.sent).toHaveLength(0)
    })

    it('zaman damgasiz teklif DURDURUR', async () => {
        const h = makeHarness()
        const { fetchedAt, ...noStamp } = QUOTE
        await expect(sendTonSwap(args(h, { quote: noStamp }))).rejects.toThrow('TON_SWAP_QUOTE_STALE')
        expect(h.sent).toHaveLength(0)
    })
})

describe('KAPI 2 — teklif BU cift ve BU miktar icin mi', () => {
    // Kullanici teklifi aldiktan sonra token degistirirse, eski teklifin
    // minAskUnits'i BASKA BIR CIFT icin hesaplanmistir. Onunla imzalamak,
    // kullanicinin gormedigi bir korumayla takas yapmaktir.
    it('teklif BASKA bir verilen varlik icinse DURDURUR', async () => {
        const h = makeHarness()
        await expect(sendTonSwap(args(h, { offerAsset: NOT_ASSET })))
            .rejects.toThrow('TON_SWAP_QUOTE_MISMATCH')
        expect(h.sent).toHaveLength(0)
    })

    it('teklif BASKA bir alinan varlik icinse DURDURUR', async () => {
        const h = makeHarness()
        await expect(sendTonSwap(args(h, { askAsset: { address: USDT, decimals: 6 } })))
            .rejects.toThrow('TON_SWAP_QUOTE_MISMATCH')
        expect(h.sent).toHaveLength(0)
    })

    // Miktar da eslesmeli: teklif 1 USDT icin alinip 100 USDT gonderilirse
    // minAskUnits 100 kat KUCUK bir koruma olur - pratikte koruma yok demektir.
    it('teklif BASKA bir miktar icinse DURDURUR', async () => {
        const h = makeHarness()
        await expect(sendTonSwap(args(h, { amount: '2' })))
            .rejects.toThrow('TON_SWAP_QUOTE_MISMATCH')
        expect(h.sent).toHaveLength(0)
    })
})

describe('KAPI 3 — fiyat etkisi', () => {
    // Sig havuzda buyuk emir SESSIZCE kabul edilmez.
    it('esik ustu fiyat etkisi ONAY olmadan DURDURUR', async () => {
        const h = makeHarness()
        const risky = { ...QUOTE, priceImpact: MAX_PRICE_IMPACT + 0.01 }
        await expect(sendTonSwap(args(h, { quote: risky })))
            .rejects.toThrow('TON_SWAP_PRICE_IMPACT_HIGH')
        expect(h.sent).toHaveLength(0)
    })

    it('kullanici ACIKCA onaylarsa gecer', async () => {
        const h = makeHarness()
        const risky = { ...QUOTE, priceImpact: MAX_PRICE_IMPACT + 0.01 }
        await sendTonSwap(args(h, { quote: risky, priceImpactAcknowledged: true }))
        expect(h.sent).toHaveLength(1)
    })

    it('tam esikte onaysiz GECER - sinir degeri degil ASILMASI reddediliyor', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h, { quote: { ...QUOTE, priceImpact: MAX_PRICE_IMPACT } }))
        expect(h.sent).toHaveLength(1)
    })
})

describe('KAPI 4 — ondalik', () => {
    it('verilen varligin ondaligi gecersizse DURDURUR', async () => {
        const h = makeHarness()
        await expect(sendTonSwap(args(h, { offerAsset: { address: USDT, decimals: undefined } })))
            .rejects.toThrow('JETTON_DECIMALS_MISSING')
        expect(h.sent).toHaveLength(0)
    })

    it('alinan varligin ondaligi gecersizse DURDURUR', async () => {
        const h = makeHarness()
        await expect(sendTonSwap(args(h, { askAsset: { address: NOT, decimals: 1.5 } })))
            .rejects.toThrow('JETTON_DECIMALS_MISSING')
        expect(h.sent).toHaveLength(0)
    })
})

describe('KAPI 5/6 — bakiyeler', () => {
    it('jetton bakiyesi yetersizse DURDURUR', async () => {
        const h = makeHarness()
        h.client.open = (c) => {
            if (c?.gasConstants) return c
            if (typeof c?.getWalletAddress === 'function') {
                return { getWalletAddress: async () => Address.parse(MY_JETTON_WALLET) }
            }
            return { getBalance: async () => 100n }   // 0.0001 USDT
        }
        await expect(sendTonSwap(args(h))).rejects.toThrow('TON_SWAP_INSUFFICIENT_BALANCE')
        expect(h.sent).toHaveLength(0)
    })

    // Jetton takasi jettonun KENDISINDEN gaz harcamaz ama TON harcar. Jettonu bol
    // olup TON'u bitmis kullanici COK YAYGIN ve AYRI mesaji hak ediyor.
    it('gaz icin TON yetersizse AYRI anahtarla DURDURUR', async () => {
        const h = makeHarness()
        h.client.getBalance = async () => 1_000_000n   // 0.001 TON
        await expect(sendTonSwap(args(h))).rejects.toThrow('TON_SWAP_INSUFFICIENT_TON')
        expect(h.sent).toHaveLength(0)
    })

    // Native TON verildiginde miktar VE gaz AYNI bakiyeden cikar - ikisi birden
    // sigmali. Yalnizca gaza bakmak, tum bakiyesini takas etmek isteyen
    // kullaniciyi zincirde dusen bir isleme birakirdi.
    it('native TON verilirken miktar + gaz BIRLIKTE kontrol edilir', async () => {
        const h = makeHarness()
        h.client.getBalance = async () => 1_100_000_000n   // 1.1 TON
        const tonQuote = { ...QUOTE, offerAddress: NATIVE_SWAP_SENTINEL, offerUnits: '1000000000' }
        await expect(sendTonSwap(args(h, {
            quote: tonQuote, offerAsset: TON_ASSET, amount: '1',
        }))).rejects.toThrow('TON_SWAP_INSUFFICIENT_TON')
        expect(h.sent).toHaveLength(0)
    })
})

describe('KAPI 7 — bekleyen islem', () => {
    it('bekleyen TON islemi varsa DURDURUR', async () => {
        const h = makeHarness()
        const pending = [{ id: 'x', status: 'processing', meta: { chainId: -239 }, timestamp: Date.now() }]
        await expect(sendTonSwap(args(h, { pendingTransactions: pending })))
            .rejects.toThrow('TON_TX_ALREADY_PENDING')
        expect(h.sent).toHaveLength(0)
    })
})

describe('SDK cagrisi', () => {
    it('router TEKLIFTEN kurulur - adres koda YAZILMAZ', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        expect(h.routerFactory).toHaveBeenCalledWith({
            address: ROUTER, majorVersion: 2, minorVersion: 2, routerType: 'ConstantProduct',
        })
    })

    // KOMISYON YOKTUR. SDK varsayilan olarak ref_fee = 10 (%0.1) yaziyor
    // (docs/superpowers/notes/2026-08-26-stonfi-dogrulama.md §2); referralValue: 0
    // ACIKCA gecilmezse kullanicidan haberi olmadan kesilir.
    it('referralValue 0 ACIKCA gecilir - SDK varsayilani %0.1', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        const call = h.sdkCalls.find((c) => c.kind === 'j2j')
        expect(call.p.referralValue).toBe(0)
        expect(call.p.referralAddress).toBeUndefined()
    })

    // minAskUnits TEKLIFTEN gelir; burada yeniden hesaplanmaz.
    it('minAskAmount TEKLIFTEKI deger', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        const call = h.sdkCalls.find((c) => c.kind === 'j2j')
        expect(String(call.p.minAskAmount)).toBe(QUOTE.minAskUnits)
    })

    // Jetton cuzdan adresleri SDK'ya VERILIR: zaten biliyoruz (P2 onbellegi) ve
    // vermezsek SDK zincire ek sorgu atar - genel toncenter ucu bu cagrilarda
    // 429 donuyordu (Gorev 3 §7).
    it('jetton cuzdan adresi SDK ya VERILIR - cozdurulmez', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        const call = h.sdkCalls.find((c) => c.kind === 'j2j')
        // getJettonWalletAddress non-bounceable (UQ...) bicimde doner - AYNI hesap,
        // farkli dize. Dize esitligi yerine HESAP esitligi karsilastiriliyor;
        // aksi halde test bicim degisiminde yanlis sebepten duserdi.
        expect(Address.parse(call.p.offerJettonWalletAddress)
            .equals(Address.parse(MY_JETTON_WALLET))).toBe(true)
    })

    it('miktar HAM birime dize tabanli cevrilir', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        const call = h.sdkCalls.find((c) => c.kind === 'j2j')
        expect(String(call.p.offerAmount)).toBe('1000000')   // 1 USDT @ 6
    })
})

describe('uc yon DOGRU SDK metodunu cagirir', () => {
    it('jetton -> jetton', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        expect(h.sdkCalls.some((c) => c.kind === 'j2j')).toBe(true)
    })

    it('jetton -> TON', async () => {
        const h = makeHarness()
        const q = { ...QUOTE, askAddress: NATIVE_SWAP_SENTINEL }
        await sendTonSwap(args(h, { quote: q, askAsset: TON_ASSET }))
        expect(h.sdkCalls.some((c) => c.kind === 'j2t')).toBe(true)
    })

    it('TON -> jetton', async () => {
        const h = makeHarness()
        const q = { ...QUOTE, offerAddress: NATIVE_SWAP_SENTINEL, offerUnits: '1000000000' }
        await sendTonSwap(args(h, { quote: q, offerAsset: TON_ASSET, amount: '1' }))
        expect(h.sdkCalls.some((c) => c.kind === 't2j')).toBe(true)
    })

    // pTON SURUMU ROUTER SURUMUYLE ESLENMELI: dexFactory router surumunden pTON
    // sinifini veriyor. Uyusmazsa mesaj YANLIS SOZLESMEYE gider.
    it('pTON sinifi router SURUMUNDEN turetilir', async () => {
        const h = makeHarness()
        const q = { ...QUOTE, askAddress: NATIVE_SWAP_SENTINEL }
        await sendTonSwap(args(h, { quote: q, askAsset: TON_ASSET }))
        expect(h.dexFactory).toHaveBeenCalledWith({
            majorVersion: 2, minorVersion: 2, routerType: 'ConstantProduct',
        })
    })
})

describe('swapGasFor', () => {
    it('yone gore SDK sabitini secer', () => {
        expect(swapGasFor(GAS, 'j2j').gasAmount).toBe(300_000_000n)
        expect(swapGasFor(GAS, 't2j').forwardGasAmount).toBe(300_000_000n)
    })

    // Sabit SDK'dan OKUNUR, kopyalanmaz: catallamak SDK guncellendiginde
    // sessiz ayrisma uretir (Gorev 4 karari).
    it('bilinmeyen yonde HATA atar - sessizce sifir kullanmaz', () => {
        expect(() => swapGasFor(GAS, 'x2y')).toThrow()
    })
})

describe('imza', () => {
    it('hepsi gecerse imzalar ve seqno doner', async () => {
        const h = makeHarness()
        const res = await sendTonSwap(args(h))
        expect(res.seqno).toBe(11)
        expect(h.sent).toHaveLength(1)
    })

    // bounce = TRUE. Hedef router ya da pTON sozlesmesidir; ikisi de KESIN
    // dagitilmistir. false secilirse sozlesme cagriyi reddettiginde iliştirilen
    // TON GERI DONMEZ, yanar. Jetton gonderimindeki ayni karar.
    it('mesaj bounce=true ile gider', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        expect(h.sent[0].messages[0].info.bounce).toBe(true)
    })

    it('gonderilen mesaj SDK nin urettigi parametrelerdir', async () => {
        const h = makeHarness()
        await sendTonSwap(args(h))
        const msg = h.sent[0].messages[0]
        expect(msg.info.value.coins).toBe(300_000_000n)
        expect(msg.info.dest.toString()).toBe(Address.parse(ROUTER).toString())
    })
})
