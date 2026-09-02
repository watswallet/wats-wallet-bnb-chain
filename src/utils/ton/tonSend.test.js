import { describe, it, expect, vi } from 'vitest'
import { Address, SendMode } from '@ton/core'
import { buildTonTransfer, sendTon, waitForSeqno, walletFromKeyPair, TON_FEE_RESERVE, tonSendAmountFits } from './tonSend'
import { tonKeyPairFromPrivateKey } from './tonAccount'

const UQ = 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P'
const EQ = 'EQDCYzNSXhwMVrgXY_YIeU2PskDKedKNldHLz1G-I4Ch4cqT'
// Ayni raw adresin testnet (0Q...) bicimi: sendTon'u testnet:true ile cagirmak icin,
// normalizeTonRecipient'in testnet dogrulamasini gecen bir alici lazim.
const UQ_TESTNET = Address.parse(UQ).toString({ testOnly: true, bounceable: false })
const KEY_PAIR = tonKeyPairFromPrivateKey('0x' + '11'.repeat(32))

function fakeClient(seqno = 5) {
    const contract = {
        getSeqno: vi.fn(async () => seqno),
        sendTransfer: vi.fn(async () => undefined),
        address: { toString: () => UQ },
    }
    return { client: { open: vi.fn(() => contract) }, contract }
}

describe('buildTonTransfer', () => {
    it('miktari nanoton a cevirir', () => {
        expect(buildTonTransfer({ to: UQ, amount: '1.5' }).value).toBe(1500000000n)
        expect(buildTonTransfer({ to: UQ, amount: 0.000000001 }).value).toBe(1n)
    })

    it('alici non-bounceable e normalize edilir', () => {
        // EQ ile giden para, hedef cuzdan zincirde YOKSA geri seker.
        expect(buildTonTransfer({ to: EQ, amount: '1' }).to.startsWith('UQ')).toBe(true)
        expect(buildTonTransfer({ to: UQ, amount: '1' }).bounce).toBe(false)
    })

    it('yorum verilirse govdeye girer, verilmezse govde yok', () => {
        expect(buildTonTransfer({ to: UQ, amount: '1', comment: 'faturam' }).body).toBe('faturam')
        expect(buildTonTransfer({ to: UQ, amount: '1' }).body).toBeUndefined()
        expect(buildTonTransfer({ to: UQ, amount: '1', comment: '   ' }).body).toBeUndefined()
    })

    it('gecersiz alici reddedilir', () => {
        expect(() => buildTonTransfer({ to: '0x' + '1'.repeat(40), amount: '1' })).toThrow('TON_ADDRESS_IS_EVM')
    })

    it('gecersiz miktar reddedilir', () => {
        expect(() => buildTonTransfer({ to: UQ, amount: '0' })).toThrow('TON_AMOUNT_INVALID')
        expect(() => buildTonTransfer({ to: UQ, amount: '-1' })).toThrow('TON_AMOUNT_INVALID')
        expect(() => buildTonTransfer({ to: UQ, amount: 'cop' })).toThrow('TON_AMOUNT_INVALID')
    })

    it('nanoton a yuvarlanirken SIFIRA dusen miktar reddedilir', () => {
        // 0.0000000004 sifirdan BUYUKTUR (yukaridaki `numeric > 0` kontrolunu GECER)
        // ama 9 ondalik basamaga (nanoton) yuvarlanirken 0n olur. Bu deger sendTon'a
        // verilirse zincirde GERCEK bir sifir-degerli islem kurulur: gaz yakilir,
        // aliciya HICBIR SEY gitmez, kod tarafinda hata firlamadigi icin gonderim
        // "basarili" gorunur. Kullanici parasinin (aslinda yalnizca ucretinin)
        // nereye gittigini SESSIZCE kaybeder — bu yuzden donusumden SONRA da kontrol.
        expect(() => buildTonTransfer({ to: UQ, amount: 0.0000000004 })).toThrow('TON_AMOUNT_INVALID')
    })

    it('toNano nun ham hatalari TON_AMOUNT_INVALID e normalize edilir, disari SIZMAZ', () => {
        // Ustel gosterim: toNano dize dalinda kendi ham SyntaxError'ini firlatir
        // ("Cannot convert 1e-9 to a BigInt"). Hata sozlesmemiz TEK bicimlidir.
        expect(() => buildTonTransfer({ to: UQ, amount: '1e-9' })).toThrow('TON_AMOUNT_INVALID')
        // 9 ondalik basamaktan fazlasi: toNano "Invalid number" firlatir.
        expect(() => buildTonTransfer({ to: UQ, amount: '1.0000000001' })).toThrow('TON_AMOUNT_INVALID')
        expect(() => buildTonTransfer({ to: UQ, amount: '0.30000000000000004' })).toThrow('TON_AMOUNT_INVALID')
    })

    it('tam 1 nanoton hala KABUL edilir (filtre gercek mikro-transferleri yutmamali)', () => {
        expect(buildTonTransfer({ to: UQ, amount: '0.000000001' }).value).toBe(1n)
        expect(buildTonTransfer({ to: UQ, amount: 0.000000001 }).value).toBe(1n)
    })

    it('ucret rezervi ihtiyatli bir sabittir', () => {
        expect(TON_FEE_RESERVE).toBe(0.01)
    })
})

describe('tonSendAmountFits', () => {
    // Bulgu 1 (merge engelleyici): Send.vue eskiden yalniz `amount > balance`
    // bakiyordu, ucreti hesaba katmiyordu. Bakiye 5.0 TON iken "5" yazan kullanici
    // eski kontrolu GECIYORDU; zincirde compute fazi calisiyor (seqno artiyor),
    // action fazi ~0.005 ucreti karsilayamayip PAY_GAS_SEPARATELY | IGNORE_ERRORS
    // altinda sessizce dusuyordu — alici hicbir sey almazken cuzdan "basarili"
    // gosteriyordu. Bu testler o senaryonun bir daha GECMEDIGINI kilitler.
    it('tam bakiyeyi yazan kullanici artik REDDEDILIR (eski kontrol bunu GECIYORDU)', () => {
        expect(tonSendAmountFits({ amount: '5', balance: 5 })).toBe(false)
        expect(tonSendAmountFits({ amount: 5, balance: 5 })).toBe(false)
    })

    it('ucret payi dusuldukten sonra tam SIGAN miktar KABUL edilir', () => {
        expect(tonSendAmountFits({ amount: 4.99, balance: 5 })).toBe(true)
        // Esitlik SINIRDA kabul: amount + reserve tam bakiyeye esit olsa da
        // ucretin TAMAMI karsilanir (bkz. tonSend.js yorumu).
        expect(tonSendAmountFits({ amount: 4.99, balance: 5, reserve: 0.01 })).toBe(true)
    })

    it('ucrete yer birakmayan miktar REDDEDILIR (bakiyenin altinda olsa bile)', () => {
        // 4.995 < 5 (eski kontrolden GECERDI) ama 4.995 + 0.01 > 5.
        expect(tonSendAmountFits({ amount: 4.995, balance: 5 })).toBe(false)
    })

    it('bakiyeyi asan miktar REDDEDILIR', () => {
        expect(tonSendAmountFits({ amount: 6, balance: 5 })).toBe(false)
    })

    it('ozel bir rezerv verilebilir (varsayilan TON_FEE_RESERVE degil)', () => {
        expect(tonSendAmountFits({ amount: 4, balance: 5, reserve: 1 })).toBe(true)
        expect(tonSendAmountFits({ amount: 4.01, balance: 5, reserve: 1 })).toBe(false)
    })

    it('sayisal olmayan / sonsuz girdilerde FAIL-CLOSED: false doner', () => {
        expect(tonSendAmountFits({ amount: 'cop', balance: 5 })).toBe(false)
        expect(tonSendAmountFits({ amount: '1', balance: 'cop' })).toBe(false)
        expect(tonSendAmountFits({ amount: NaN, balance: 5 })).toBe(false)
        expect(tonSendAmountFits({ amount: 1, balance: Infinity })).toBe(false)
    })

    it('varsayilan rezerv TON_FEE_RESERVE ile birebir aynidir', () => {
        expect(tonSendAmountFits({ amount: 5 - TON_FEE_RESERVE, balance: 5 })).toBe(true)
        expect(tonSendAmountFits({ amount: 5 - TON_FEE_RESERVE + 0.0001, balance: 5 })).toBe(false)
    })
})

describe('sendTon', () => {
    it('seqno okur ve dogru send mode ile gonderir', async () => {
        const { client, contract } = fakeClient(5)
        const result = await sendTon({ client, keyPair: KEY_PAIR, to: UQ, amount: '2' })

        expect(result.seqno).toBe(5)
        expect(contract.sendTransfer).toHaveBeenCalledTimes(1)

        const [args] = contract.sendTransfer.mock.calls[0]
        expect(args.seqno).toBe(5)
        expect(args.secretKey).toBe(KEY_PAIR.secretKey)
        expect(args.sendMode).toBe(SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS)
        expect(args.messages).toHaveLength(1)
    })

    it('gonderim patlarsa hata YUTULMAZ', async () => {
        const { client, contract } = fakeClient(1)
        contract.sendTransfer.mockRejectedValueOnce(new Error('proxy down'))
        await expect(sendTon({ client, keyPair: KEY_PAIR, to: UQ, amount: '1' })).rejects.toThrow('proxy down')
    })

    it('gecersiz alici zincire HIC gitmez', async () => {
        const { client, contract } = fakeClient(1)
        await expect(sendTon({ client, keyPair: KEY_PAIR, to: 'cop', amount: '1' })).rejects.toThrow('TON_ADDRESS_INVALID')
        expect(contract.sendTransfer).not.toHaveBeenCalled()
    })

    it('gecersiz miktar zincire HIC gitmez', async () => {
        // Dogrulama zincire cikmadan ONCE olmali: sifira yuvarlanan bir miktarda bile
        // getSeqno okunmamali — okunursa zaten bir sonraki adim bir sifir-degerli
        // gonderime kadar gidebilir.
        const { client, contract } = fakeClient(1)
        await expect(sendTon({ client, keyPair: KEY_PAIR, to: UQ, amount: 0.0000000004 })).rejects.toThrow('TON_AMOUNT_INVALID')
        expect(client.open).not.toHaveBeenCalled()
        expect(contract.getSeqno).not.toHaveBeenCalled()
        expect(contract.sendTransfer).not.toHaveBeenCalled()
    })
})

describe('waitForSeqno', () => {
    it('seqno degisince true doner', async () => {
        const contract = { getSeqno: vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(6) }
        const sleep = vi.fn(async () => {})
        expect(await waitForSeqno({ contract, previous: 5, sleep })).toBe(true)
    })

    it('deneme biterse false doner (zincirde olmadigi ANLAMINA GELMEZ)', async () => {
        const contract = { getSeqno: vi.fn(async () => 5) }
        const sleep = vi.fn(async () => {})
        expect(await waitForSeqno({ contract, previous: 5, attempts: 3, sleep })).toBe(false)
        expect(contract.getSeqno).toHaveBeenCalledTimes(3)
    })

    it('okuma hatasi denemeyi bitirmez', async () => {
        const contract = {
            getSeqno: vi.fn()
                .mockRejectedValueOnce(new Error('gecici'))
                .mockResolvedValueOnce(9),
        }
        const sleep = vi.fn(async () => {})
        expect(await waitForSeqno({ contract, previous: 5, attempts: 3, sleep })).toBe(true)
    })
})

describe('walletFromKeyPair', () => {
    // Bu esitlik para guvenligi icin kritik: waitForSeqno cagrisi genelde
    // walletFromKeyPair'in yeniden kurdugu sozlesmeyi izler (kuyruk disinda,
    // sendTon'un actigi 'contract' referansi elde yokken). Ikisi FARKLI adres
    // uretirse izleme yanlis sozlesmeyi bekler ve gonderilen islem sonsuza
    // dek "beklemede" gorunur — kullanici tekrar gonderip parayi iki kez yollayabilir.
    it('sendTon icinde acilan cuzdanla AYNI adresi uretir (mainnet)', async () => {
        const { client } = fakeClient(5)
        await sendTon({ client, keyPair: KEY_PAIR, to: UQ, amount: '1' })

        const [openedWallet] = client.open.mock.calls[0]
        const tracked = walletFromKeyPair(KEY_PAIR)

        expect(tracked.address.toString()).toBe(openedWallet.address.toString())
    })

    it('sendTon icinde acilan cuzdanla AYNI adresi uretir (testnet)', async () => {
        const { client } = fakeClient(1)
        await sendTon({ client, keyPair: KEY_PAIR, to: UQ_TESTNET, amount: '1', testnet: true })

        const [openedWallet] = client.open.mock.calls[0]
        const tracked = walletFromKeyPair(KEY_PAIR, true)

        expect(tracked.address.toString()).toBe(openedWallet.address.toString())
    })

    it('varsayilan mainnet dir', () => {
        expect(walletFromKeyPair(KEY_PAIR).address.toString())
            .toBe(walletFromKeyPair(KEY_PAIR, false).address.toString())
    })

    it('mainnet ve testnet farkli adres uretir', () => {
        const mainnet = walletFromKeyPair(KEY_PAIR, false)
        const testnet = walletFromKeyPair(KEY_PAIR, true)
        expect(mainnet.address.toString()).not.toBe(testnet.address.toString())
    })
})
