import { describe, it, expect } from 'vitest'
import { Address } from '@ton/core'
import {
    isJettonWallet, jettonSendFits, sendJetton,
    JETTON_ATTACH_TON, JETTON_FORWARD_TON,
} from './jettonSend'
import { hasPendingTonTx } from './tonPending'
import { JETTON_TRANSFER_OP } from './jettonTransfer'

// Plan metnindeki fixture'lar 'EQ1'/'UQ1' gibi SAHTE adresler kullaniyordu;
// Address.parse bunlari reddeder ve testler yanlis sebepten duserdi (ayni tuzak
// Gorev 5'te yasandi). Buradaki adresler GERCEK ve ayristirilabilir.
const OWNER = 'UQBdZGtyeYCHjpWco6qxuL_GzdTb4unw9_4FDBMaISgvNoE_'
const RECIPIENT = 'UQBVXGNqcXh_ho2Um6KpsLe-xczT2uHo7_b9BAsSGSAnLkuY'
const MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const MY_JETTON_WALLET = 'EQDJ0Nfe5ezz-gEIDxYdJCsyOUBHTlVcY2pxeH-GjZSboriR'

// ---------------------------------------------------------------------------
// K1: `destination` ALICININ SAHIP adresi olmali, jetton cuzdani DEGIL. Ikisi de
// ayni UQ.../EQ... biciminde gorunur ve GOZLE AYIRT EDILEMEZ. Yanlisina
// gonderilen token pratikte kaybolur.
// ---------------------------------------------------------------------------
describe('isJettonWallet', () => {
    it('get_wallet_data cevap veriyorsa TRUE', async () => {
        const client = {
            getContractState: async () => ({ state: 'active' }),
            open: () => ({ getBalance: async () => 5n }),
        }
        expect(await isJettonWallet({ client, address: MY_JETTON_WALLET })).toBe(true)
    })

    it('aktif ama get_wallet_data yoksa FALSE - normal cuzdan', async () => {
        const client = {
            getContractState: async () => ({ state: 'active' }),
            open: () => ({ getBalance: async () => { throw new Error('exit_code: -13') } }),
        }
        expect(await isJettonWallet({ client, address: RECIPIENT })).toBe(false)
    })

    // BU TESTIN KAPSADIGI KUSUR PLANIN KENDI TASARIMINDAYDI.
    //
    // Plan `isJettonWallet`i "getBalance cozulurse true" diye tarif ediyordu. Ama
    // @ton/ton'un JettonWallet.getBalance'i (dist/jetton/JettonWallet.js:18-25)
    // hesap AKTIF DEGILSE hata ATMAZ, sessizce 0n doner:
    //     let state = await provider.getState();
    //     if (state.state.type !== "active") { return 0n; }
    // Yani plan tasarimi, zincirde HENUZ OLMAYAN her adresi "jetton cuzdani"
    // sayardi. Bu adresler en yaygin mesru alici tipidir (hic TON almamis yeni
    // bir kullanici). K1 kapisi kullaniciyi korumak yerine, yeni birine jetton
    // gondermeyi KALICI OLARAK imkansiz kilardi.
    //
    // Dogrusu: dagitilmamis hesap jetton cuzdani OLAMAZ. Jetton cuzdani bakiye
    // tasidigi icin zaten aktiftir.
    it('hesap DAGITILMAMISSA FALSE - getBalance 0n dondurse bile', async () => {
        const client = {
            getContractState: async () => ({ state: 'uninitialized' }),
            // Kutuphanenin gercek davranisi: aktif olmayan hesapta 0n doner.
            open: () => ({ getBalance: async () => 0n }),
        }
        expect(await isJettonWallet({ client, address: RECIPIENT })).toBe(false)
    })

    it('donmus hesap da jetton cuzdani sayilmaz', async () => {
        const client = {
            getContractState: async () => ({ state: 'frozen' }),
            open: () => ({ getBalance: async () => 0n }),
        }
        expect(await isJettonWallet({ client, address: RECIPIENT })).toBe(false)
    })

    // AG HATASI "jetton cuzdani degil" DEMEK DEGILDIR. Sessizce false donmek,
    // proxy dustugu anda K1 kapisini tamamen devre disi birakirdi - kapinin
    // varlik sebebi olan tek durumda calismamasi.
    it('ag hatasinda SESSIZCE gecirmez, ayri anahtarla durdurur', async () => {
        const client = {
            getContractState: async () => { throw new Error('fetch failed') },
            open: () => ({ getBalance: async () => 0n }),
        }
        await expect(isJettonWallet({ client, address: RECIPIENT }))
            .rejects.toThrow('JETTON_RECIPIENT_CHECK_FAILED')
    })

    it('get_wallet_data ag hatasi verirse de durdurur', async () => {
        const client = {
            getContractState: async () => ({ state: 'active' }),
            open: () => ({ getBalance: async () => { throw new Error('Request timeout') } }),
        }
        await expect(isJettonWallet({ client, address: RECIPIENT }))
            .rejects.toThrow('JETTON_RECIPIENT_CHECK_FAILED')
    })
})

// ---------------------------------------------------------------------------
// IKI AYRI bakiye kontrolu. Jettonu olup gaz icin TON'u olmayan kullanici COK
// YAYGIN ve dogru mesaji hak ediyor - "yetersiz bakiye" demek hangi bakiye
// oldugunu gizler.
// ---------------------------------------------------------------------------
describe('jettonSendFits', () => {
    it('ikisi de yeterliyse gecer', () => {
        expect(jettonSendFits({ jettonAmount: 1, jettonBalance: 2, tonBalance: 1, attach: JETTON_ATTACH_TON })).toBe(true)
    })

    it('jetton yetersizse reddeder', () => {
        expect(jettonSendFits({ jettonAmount: 3, jettonBalance: 2, tonBalance: 1, attach: JETTON_ATTACH_TON })).toBe(false)
    })

    it('TON yetersizse reddeder - jetton bol olsa bile', () => {
        expect(jettonSendFits({ jettonAmount: 1, jettonBalance: 100, tonBalance: 0, attach: JETTON_ATTACH_TON })).toBe(false)
    })

    it('tam esitlik GECER - sinir degeri degil, SIGMAMA reddediliyor', () => {
        expect(jettonSendFits({ jettonAmount: 2, jettonBalance: 2, tonBalance: JETTON_ATTACH_TON, attach: JETTON_ATTACH_TON })).toBe(true)
    })

    // MUTASYON BOSLUGU: `Number.isFinite` kapisini silmek asagidaki NaN
    // testlerini DUSURMUYORDU - NaN karsilastirmalari zaten false doner. Kapinin
    // TEK BASINA yakaladigi durum Infinity: bozuk bir bakiye okumasi (or. bir
    // katmanin hatayi Infinity'ye cevirmesi) `amount <= Infinity` ile GECERDI ve
    // sahibi olmayan bir jetton gonderilmeye calisilirdi.
    it('Infinity bakiye GECMEZ - NaN kadar acik degil ama ayni sinif hata', () => {
        expect(jettonSendFits({ jettonAmount: 1, jettonBalance: Infinity, tonBalance: 1, attach: JETTON_ATTACH_TON })).toBe(false)
        expect(jettonSendFits({ jettonAmount: 1, jettonBalance: 2, tonBalance: Infinity, attach: JETTON_ATTACH_TON })).toBe(false)
    })

    it('sayisal olmayan girdi GECMEZ', () => {
        expect(jettonSendFits({ jettonAmount: 'abc', jettonBalance: 2, tonBalance: 1, attach: JETTON_ATTACH_TON })).toBe(false)
        expect(jettonSendFits({ jettonAmount: 1, jettonBalance: undefined, tonBalance: 1, attach: JETTON_ATTACH_TON })).toBe(false)
        expect(jettonSendFits({ jettonAmount: 1, jettonBalance: 2, tonBalance: NaN, attach: JETTON_ATTACH_TON })).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// P1'de bu kapi OLU cikmisti: kod `t.chainId` okuyordu ama updateTxStatus
// `meta.chainId` yaziyordu, ve testler YANLIS BICIMLI fixture kullandigi icin
// yesildi. Bu yuzden fixture GERCEK YAZICIDAN turetiliyor
// (background.js:updateTxStatus): { id, status, meta: data, timestamp: Date.now() }
// ---------------------------------------------------------------------------
describe('bekleyen islem kapisi jetton yolunu da kapsar', () => {
    it('bekleyen TON islemi varken jetton gonderimi ENGELLENIR', () => {
        const pending = { id: 'x', status: 'processing', meta: { chainId: -239, amount: 1, type: 'Jetton' }, timestamp: Date.now() }
        expect(hasPendingTonTx([pending])).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Olculmus sabitler. Degerler docs/superpowers/notes/2026-08-24-jetton-ucret-olcumu.md
// ---------------------------------------------------------------------------
describe('olculmus ucret sabitleri', () => {
    it('forward tutari ASLA sifir degil', () => {
        expect(JETTON_FORWARD_TON).toBeGreaterThan(0)
    })

    it('sabitler olculen degerlerdir', () => {
        expect(JETTON_ATTACH_TON).toBe(0.05)
        expect(JETTON_FORWARD_TON).toBe(0.000000001)
    })
})

// ---------------------------------------------------------------------------
// Dort kapinin SIRAYLA calistigi ve hicbiri gecmeden imzaya gidilmedigi.
// ---------------------------------------------------------------------------
function makeHarness(overrides = {}) {
    const sent = []
    const client = {
        getContractState: async () => ({ state: 'active' }),
        getBalance: async () => 1_000_000_000n,           // 1 TON (sahip cuzdani)
        open: (contract) => {
            // Jetton master -> cuzdan adresi turetme
            if (typeof contract?.getWalletAddress === 'function') {
                return { getWalletAddress: async () => Address.parse(MY_JETTON_WALLET) }
            }
            const addr = contract?.address?.toString({ bounceable: true })
            // Alicinin sahip adresi: normal cuzdan, get_wallet_data YOK
            if (addr === Address.parse(RECIPIENT).toString({ bounceable: true })) {
                return { getBalance: async () => { throw new Error('exit_code: -13') } }
            }
            // Gonderenin jetton cuzdani
            return { getBalance: async () => 5_000_000n }   // 5 USDT @ 6 ondalik
        },
        ...overrides.client,
    }

    const wallet = {
        address: Address.parse(OWNER),
        getSeqno: async () => 7,
        sendTransfer: async (args) => { sent.push(args) },
    }

    return { client, wallet, sent }
}

const BASE_ARGS = {
    to: RECIPIENT,
    amount: 1,
    master: MASTER,
    decimals: 6,
    owner: OWNER,
    chainId: -239,
    storage: { get: async () => ({}), set: async () => {} },
    pendingTransactions: [],
}

describe('sendJetton dort kapi', () => {
    it('hepsi gecerse imzalar ve seqno doner', async () => {
        const h = makeHarness()
        const res = await sendJetton({ ...BASE_ARGS, client: h.client, wallet: h.wallet })

        expect(res.seqno).toBe(7)
        expect(h.sent).toHaveLength(1)

        const msg = h.sent[0].messages[0]
        // Deger OLCULMUS sabit kadar iliştirilir
        expect(msg.info.value.coins).toBe(50_000_000n)   // 0.05 TON

        // bounce = TRUE. Gercek zincirde 12 transferin 11'i boyle
        // (docs/.../2026-08-24-jetton-ucret-olcumu.md "Ek bulgu"). Jetton transferi
        // GONDERENIN KENDI jetton cuzdanina gider; o sozlesme kesin dagitilmistir.
        // false secilirse sozlesme transferi reddettiginde iliştirilen TON YANAR.
        expect(msg.info.bounce).toBe(true)

        // Mesaj GONDERENIN jetton cuzdanina gider, aliciya DEGIL
        expect(msg.info.dest.toString({ bounceable: true }))
            .toBe(Address.parse(MY_JETTON_WALLET).toString({ bounceable: true }))

        // Govde TEP-74 transfer opcode'u ile basliyor
        expect(msg.body.beginParse().loadUint(32)).toBe(JETTON_TRANSFER_OP)
    })

    it('KAPI 1 - alici bir jetton cuzdaniysa DURDURUR, imzalamaz', async () => {
        const h = makeHarness()
        // Alici adresi get_wallet_data'ya cevap veriyor => jetton cuzdani
        h.client.open = (contract) => {
            if (typeof contract?.getWalletAddress === 'function') {
                return { getWalletAddress: async () => Address.parse(MY_JETTON_WALLET) }
            }
            return { getBalance: async () => 5_000_000n }
        }
        await expect(sendJetton({ ...BASE_ARGS, client: h.client, wallet: h.wallet }))
            .rejects.toThrow('JETTON_RECIPIENT_IS_JETTON_WALLET')
        expect(h.sent).toHaveLength(0)
    })

    it('KAPI 1 - gecersiz adres DURDURUR', async () => {
        const h = makeHarness()
        await expect(sendJetton({ ...BASE_ARGS, to: 'lorem', client: h.client, wallet: h.wallet }))
            .rejects.toThrow('TON_ADDRESS_INVALID')
        expect(h.sent).toHaveLength(0)
    })

    it('KAPI 2 - jetton bakiyesi yetersizse DURDURUR, imzalamaz', async () => {
        const h = makeHarness()
        await expect(sendJetton({ ...BASE_ARGS, amount: 99, client: h.client, wallet: h.wallet }))
            .rejects.toThrow('JETTON_INSUFFICIENT_BALANCE')
        expect(h.sent).toHaveLength(0)
    })

    it('KAPI 3 - TON bakiyesi yetersizse DURDURUR, jetton bol olsa bile', async () => {
        const h = makeHarness()
        h.client.getBalance = async () => 1_000_000n    // 0.001 TON, 0.05 gerekiyor
        await expect(sendJetton({ ...BASE_ARGS, client: h.client, wallet: h.wallet }))
            .rejects.toThrow('JETTON_INSUFFICIENT_TON')
        expect(h.sent).toHaveLength(0)
    })

    it('KAPI 4 - bekleyen TON islemi varsa DURDURUR, imzalamaz', async () => {
        const h = makeHarness()
        const pending = [{ id: 'x', status: 'processing', meta: { chainId: -239 }, timestamp: Date.now() }]
        await expect(sendJetton({ ...BASE_ARGS, pendingTransactions: pending, client: h.client, wallet: h.wallet }))
            .rejects.toThrow('TON_TX_ALREADY_PENDING')
        expect(h.sent).toHaveLength(0)
    })

    // Ondalik jettonTransfer.js'in kapisina ULASMADAN once burada da zorunlu:
    // yanlis ondalik gonderilen miktari 1000 kat yanlis yapar.
    it('ondalik yoksa DURDURUR', async () => {
        const h = makeHarness()
        await expect(sendJetton({ ...BASE_ARGS, decimals: undefined, client: h.client, wallet: h.wallet }))
            .rejects.toThrow('JETTON_DECIMALS_MISSING')
        expect(h.sent).toHaveLength(0)
    })

    // MUTASYON BOSLUGU: sendJetton'daki ondalik kapisini silmek testi
    // DUSURMUYORDU, cunku ayni hata asagida getJettonBalance/jettonTransfer
    // katmanlarindan da geliyor. Katmanlarin ust uste binmesi DOGRU (bilincli
    // savunma derinligi) ama EN ERKEN kapinin gercekten en erken oldugu ayrica
    // kanitlanmali: gecersiz ondalikta ZINCIRE HIC DOKUNULMAMALI, yoksa her
    // bozuk kayit icin bosuna ag cagrisi yapilir ve hata sebebi bulaniklasir.
    it('ondalik gecersizse ZINCIRE HIC DOKUNMAZ', async () => {
        const h = makeHarness()
        let touched = 0
        h.client.getContractState = async () => { touched++; return { state: 'active' } }
        h.client.getBalance = async () => { touched++; return 1_000_000_000n }
        h.client.open = () => { touched++; return { getBalance: async () => 0n } }

        await expect(sendJetton({ ...BASE_ARGS, decimals: 1.5, client: h.client, wallet: h.wallet }))
            .rejects.toThrow('JETTON_DECIMALS_MISSING')
        expect(touched).toBe(0)
        expect(h.sent).toHaveLength(0)
    })

    it('yorum govdeye tasinir', async () => {
        const h = makeHarness()
        await sendJetton({ ...BASE_ARGS, comment: 'memo123', client: h.client, wallet: h.wallet })
        const body = h.sent[0].messages[0].body.beginParse()
        body.loadUint(32)                 // op
        body.loadUint(64)                 // query_id
        body.loadCoins()                  // amount
        body.loadAddress()                // destination
        body.loadAddress()                // response_destination
        body.loadBit()                    // custom_payload
        body.loadCoins()                  // forward_ton_amount
        const fwd = body.loadMaybeRef()
        expect(fwd).not.toBeNull()
        const s = fwd.beginParse()
        expect(s.loadUint(32)).toBe(0)    // TEP-74 metin yorumu oneki
        expect(s.loadStringTail()).toBe('memo123')
    })

    // response_destination GONDERENIN SAHIP adresi olmali: fazla iliştirilen TON
    // (0.05'ten gercek maliyet ~0.003 dusuldukten sonrasi) buraya iade edilir.
    // Yanlis adres yazilirsa kullanicinin parasi her gonderimde baskasina gider.
    it('iade adresi GONDERENIN sahip adresidir', async () => {
        const h = makeHarness()
        await sendJetton({ ...BASE_ARGS, client: h.client, wallet: h.wallet })
        const body = h.sent[0].messages[0].body.beginParse()
        body.loadUint(32); body.loadUint(64); body.loadCoins()
        body.loadAddress()                                  // destination
        const response = body.loadAddress()
        expect(response.toString({ bounceable: false }))
            .toBe(Address.parse(OWNER).toString({ bounceable: false }))
    })

    // destination ALICININ SAHIP adresidir, alicinin jetton cuzdani DEGIL:
    // jetton cuzdanini alicinin KENDI jetton master'i turetir.
    it('destination alicinin SAHIP adresidir', async () => {
        const h = makeHarness()
        await sendJetton({ ...BASE_ARGS, client: h.client, wallet: h.wallet })
        const body = h.sent[0].messages[0].body.beginParse()
        body.loadUint(32); body.loadUint(64); body.loadCoins()
        const dest = body.loadAddress()
        expect(dest.toString({ bounceable: false }))
            .toBe(Address.parse(RECIPIENT).toString({ bounceable: false }))
    })
})
