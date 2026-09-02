import { describe, it, expect, beforeEach, vi } from 'vitest'
import axios from 'axios'
import {
    extractHistoryCounterparties, extractSolanaHistoryCounterparties, fetchHistoryCounterparties
} from './historyRecipients'
import { buildTrustedList } from './addressPoisoning'
import { fetchSolanaHistory } from './solana/history'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))
vi.mock('./solana/history', () => ({ fetchSolanaHistory: vi.fn() }))

const ME = '0x' + 'a'.repeat(40)
const PEER = '0x' + 'b'.repeat(40)
const OTHER = '0x' + 'c'.repeat(40)

const sendTx = (to, value = '5') => ({
    native_transfers: [{ from_address: ME, to_address: to, value_formatted: value, direction: 'send' }]
})
const receiveTx = (from, value = '5') => ({
    native_transfers: [{ from_address: from, to_address: ME, value_formatted: value, direction: 'receive' }]
})

describe('extractHistoryCounterparties — gonderdiklerim', () => {
    it('gonderdigim adresi alir', () => {
        expect(extractHistoryCounterparties([sendTx(PEER)], ME))
            .toEqual([{ address: PEER, label: null, source: 'history' }])
    })

    it('SIFIR tutarli gonderimde bile alir — o adresi ben sectim', () => {
        expect(extractHistoryCounterparties([sendTx(PEER, '0')], ME)).toHaveLength(1)
    })

    it('ayni adres birden fazla islemde varsa bir kez cikar', () => {
        expect(extractHistoryCounterparties([sendTx(PEER), sendTx(PEER)], ME)).toHaveLength(1)
    })
})

describe('extractHistoryCounterparties — gelen islemler', () => {
    it('gercek tutarli gelen odemenin gonderenini alir', () => {
        expect(extractHistoryCounterparties([receiveTx(PEER, '2.5')], ME))
            .toEqual([{ address: PEER, label: null, source: 'history' }])
    })

    it('SIFIR tutarli gelen transfer ALINMAZ — zehirleme yeminin ta kendisi', () => {
        // Saldirinin klasik teslimati: 0 degerli transfer, sahte adresi gecmisine dusurur.
        // Bunu "guvenilir" saymak, sahte adrese gonderimi SESSIZ hale getirirdi.
        expect(extractHistoryCounterparties([receiveTx(PEER, '0')], ME)).toEqual([])
    })

    it('okunamayan tutarli gelen transfer alinmaz', () => {
        expect(extractHistoryCounterparties([receiveTx(PEER, null)], ME)).toEqual([])
        expect(extractHistoryCounterparties([receiveTx(PEER, 'abc')], ME)).toEqual([])
    })
})

describe('extractHistoryCounterparties — ERC-20 transferleri', () => {
    it('token transferlerini de tarar', () => {
        const tx = {
            erc20_transfers: [
                { from_address: ME, to_address: PEER, value_formatted: '100', direction: 'send' },
                { from_address: OTHER, to_address: ME, value_formatted: '0', direction: 'receive' }
            ]
        }
        // Gonderilen alinir, 0 degerli gelen (sahte token yemi) alinmaz.
        expect(extractHistoryCounterparties([tx], ME))
            .toEqual([{ address: PEER, label: null, source: 'history' }])
    })
})

describe('extractHistoryCounterparties — kendim ve bozuk veri', () => {
    it('kendi adresim karsi taraf sayilmaz', () => {
        expect(extractHistoryCounterparties([sendTx(ME)], ME)).toEqual([])
    })

    it('kendi adresim buyuk/kucuk harf farkiyla gelse de elenir', () => {
        expect(extractHistoryCounterparties([sendTx(ME.toUpperCase().replace('0X', '0x'))], ME)).toEqual([])
    })

    it('gecersiz adresler elenir', () => {
        expect(extractHistoryCounterparties([sendTx('0x123'), sendTx(null)], ME)).toEqual([])
    })

    it('transfer dizisi olmayan islemlerde patlamaz', () => {
        expect(extractHistoryCounterparties([{}, { native_transfers: null }, null], ME)).toEqual([])
    })

    it('bozuk girdilere toleranslidir', () => {
        expect(extractHistoryCounterparties(null, ME)).toEqual([])
        expect(extractHistoryCounterparties([], ME)).toEqual([])
        expect(extractHistoryCounterparties([sendTx(PEER)], null)).toEqual([])
        expect(extractHistoryCounterparties([sendTx(PEER)], '0x123')).toEqual([])
    })
})

// Sabitler addressPoisoning.test.js'teki ile AYNI (gercek base58 karakter
// kumesi/uzunlugu ile uyumlu oldugu icin orada dogrulandi).
const SOL_ME = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SOL_PEER = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
// SOL_PEER ile YALNIZCA bas 4 karakterin harf kasasi farkli — gerisi birebir ayni.
const SOL_PEER_CASE_VARIANT = 'drpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

// Helius zenginlestirilmis islem sekli — solana/historyRow.test.js'teki ile AYNI.
// Moralis'in from_address/to_address/direction'i DEGIL, fromUserAccount/
// toUserAccount/lamports kullanir; iki saglayici birbirine benzemez.
const solNativeTx = (from, to, lamports = 5_000_000_000) => ({
    signature: 'SIG_NATIVE',
    timestamp: 1_700_000_000,
    nativeTransfers: [{ fromUserAccount: from, toUserAccount: to, amount: lamports }],
    tokenTransfers: [],
    transactionError: null,
})
const solTokenTx = (from, to, tokenAmount = 10) => ({
    signature: 'SIG_TOKEN',
    timestamp: 1_700_000_000,
    nativeTransfers: [],
    tokenTransfers: [{ fromUserAccount: from, toUserAccount: to, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount }],
    transactionError: null,
})

describe('extractSolanaHistoryCounterparties — Helius sekli', () => {
    it('gonderdigim (SOL) adresi alir', () => {
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_PEER)], SOL_ME))
            .toEqual([{ address: SOL_PEER, label: null, source: 'history' }])
    })

    it('gercek tutarli gelen (SOL) odemenin gonderenini alir', () => {
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_PEER, SOL_ME, 2_500_000_000)], SOL_ME))
            .toEqual([{ address: SOL_PEER, label: null, source: 'history' }])
    })

    it('SIFIR tutarli gelen (SOL) transfer ALINMAZ — zehirleme yeminin ta kendisi', () => {
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_PEER, SOL_ME, 0)], SOL_ME)).toEqual([])
    })

    it('SPL token transferlerini de tarar', () => {
        expect(extractSolanaHistoryCounterparties([solTokenTx(SOL_ME, SOL_PEER)], SOL_ME))
            .toEqual([{ address: SOL_PEER, label: null, source: 'history' }])
    })

    it('kendine transfer (self) karsi taraf sayilmaz', () => {
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_ME)], SOL_ME)).toEqual([])
    })

    // KOD INCELEMESI (Task 13, onemli 4): toHistoryRow (DISPLAY yardimcisi) bir
    // islemden yalnizca TEK bacak alir (tokenTransfers tercih edilir, sonra ILK
    // nativeTransfer) — coklu-bacakli bir Solana islemi (swap, birden fazla alici)
    // ROUTINE'dir ve digger gercek karsi taraflari SESSIZCE kaybederdi. Guvenlik
    // yolu (extractSolanaHistoryCounterparties) toHistoryRow'u KULLANMAZ, HER
    // bacagi kendisi gezer.
    it('AYNI islemde IKI giden nativeTransfer varsa IKISI de alinir (toHistoryRow tek bacak alirdi)', () => {
        const twoLegTx = {
            signature: 'SIG_MULTI',
            timestamp: 1_700_000_000,
            nativeTransfers: [
                { fromUserAccount: SOL_ME, toUserAccount: SOL_PEER, amount: 1_000_000_000 },
                { fromUserAccount: SOL_ME, toUserAccount: SOL_PEER_CASE_VARIANT, amount: 2_000_000_000 }
            ],
            tokenTransfers: [],
            transactionError: null,
        }
        const list = extractSolanaHistoryCounterparties([twoLegTx], SOL_ME)
        expect(list.map(e => e.address)).toEqual([SOL_PEER, SOL_PEER_CASE_VARIANT])
    })

    // toHistoryRow TOKEN bacagini native'e TERCIH EDER (hit = tokenHit || nativeHit).
    // Eger token bacagi SIFIR tutarliysa (yem) ve gercek tutarli native bacak
    // AYNI islemdeyse, toHistoryRow'u kullanan bir ayristirici sifir bacagi
    // "kazanir", sifir-valfine takilir ve GERCEK karsi tarafi (native) TAMAMEN
    // gizlerdi. Burada ikisi de BAGIMSIZ degerlendirilir.
    it('sifir tutarli gelen token bacagi, AYNI islemdeki gercek tutarli native bacagi GIZLEMEZ', () => {
        const mixedTx = {
            signature: 'SIG_MIXED',
            timestamp: 1_700_000_000,
            nativeTransfers: [{ fromUserAccount: SOL_PEER_CASE_VARIANT, toUserAccount: SOL_ME, amount: 5_000_000_000 }],
            tokenTransfers: [{
                fromUserAccount: SOL_PEER, toUserAccount: SOL_ME,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount: 0
            }],
            transactionError: null,
        }
        const list = extractSolanaHistoryCounterparties([mixedTx], SOL_ME)
        expect(list).toEqual([{ address: SOL_PEER_CASE_VARIANT, label: null, source: 'history' }])
    })

    // BASE58 BUYUK/KUCUK HARF DUYARLIDIR. Adres kucultulseydi (dedupeKey
    // kucultmuyor, bkz. addressForm.js), SOL_PEER_CASE_VARIANT hicbir zaman
    // SOL_PEER'den "farkli" sayilmazdi.
    it('SADECE harf kasasi farkli Solana adresi FARKLI bir karsi taraf sayilir (case-fold tuzagi kapali)', () => {
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_PEER_CASE_VARIANT)], SOL_ME))
            .toEqual([{ address: SOL_PEER_CASE_VARIANT, label: null, source: 'history' }])
    })

    it('yalnizca harf kasasi farkli iki Solana adresi dedupe tarafindan CONFLATE edilmez, ikisi de ayri kalir', () => {
        const list = extractSolanaHistoryCounterparties(
            [solNativeTx(SOL_ME, SOL_PEER), solNativeTx(SOL_ME, SOL_PEER_CASE_VARIANT)],
            SOL_ME
        )
        expect(list.map(e => e.address)).toEqual([SOL_PEER, SOL_PEER_CASE_VARIANT])
    })

    it('ayni adres birden fazla islemde varsa bir kez cikar', () => {
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_PEER), solNativeTx(SOL_ME, SOL_PEER)], SOL_ME))
            .toHaveLength(1)
    })

    it('bozuk girdilere toleranslidir', () => {
        expect(extractSolanaHistoryCounterparties(null, SOL_ME)).toEqual([])
        expect(extractSolanaHistoryCounterparties([], SOL_ME)).toEqual([])
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_PEER)], null)).toEqual([])
        expect(extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_PEER)], '')).toEqual([])
    })
})

describe('fetchHistoryCounterparties — EVM yolu (degismedi)', () => {
    beforeEach(() => { axios.post.mockReset(); fetchSolanaHistory.mockReset() })

    it('gecmisi cekip karsi taraflari cikarir', async () => {
        axios.post.mockResolvedValue({ data: { success: true, history: [sendTx(PEER)] } })

        const r = await fetchHistoryCounterparties('https://api.test', ME, 1)

        expect(r).toEqual([{ address: PEER, label: null, source: 'history' }])
        expect(axios.post).toHaveBeenCalledWith(
            'https://api.test/wallet/history',
            { address: ME, chainId: 1 },
            expect.anything()
        )
        expect(fetchSolanaHistory).not.toHaveBeenCalled()
    })

    // Fail-open: gecmis alinamadiginda tespit ESKI kaynaklarla calismaya devam eder.
    // Bu cagri gonderim akisinda; patlamasi kullaniciyi durdurmamali.
    it('sunucu hatasinda bos liste doner', async () => {
        axios.post.mockRejectedValue(new Error('502'))
        expect(await fetchHistoryCounterparties('https://api.test', ME, 1)).toEqual([])
    })

    it('govde beklenmedikse bos liste doner', async () => {
        axios.post.mockResolvedValue({ data: { success: true } })
        expect(await fetchHistoryCounterparties('https://api.test', ME, 1)).toEqual([])
    })

    it('success:false ise bos liste doner', async () => {
        axios.post.mockResolvedValue({ data: { success: false, history: [sendTx(PEER)] } })
        expect(await fetchHistoryCounterparties('https://api.test', ME, 1)).toEqual([])
    })

    it('eksik parametrelerde AG CAGRISI YAPMAZ', async () => {
        expect(await fetchHistoryCounterparties('', ME, 1)).toEqual([])
        expect(await fetchHistoryCounterparties('https://api.test', '0x123', 1)).toEqual([])
        expect(await fetchHistoryCounterparties('https://api.test', ME, null)).toEqual([])
        expect(axios.post).not.toHaveBeenCalled()
    })
})

describe('fetchHistoryCounterparties — Solana yolu (/solana/history, Helius)', () => {
    beforeEach(() => { axios.post.mockReset(); fetchSolanaHistory.mockReset() })

    // Solana AYRI bir uctan (Helius) besleniyor: /wallet/history (Moralis) onun
    // seklini hic anlamaz. Yonlendirme chainId'ye gore yapilir.
    it('Solana chainId sinde /solana/history a gider, /wallet/history e DEGIL', async () => {
        fetchSolanaHistory.mockResolvedValue([solNativeTx(SOL_ME, SOL_PEER)])

        const r = await fetchHistoryCounterparties('https://api.test', SOL_ME, 'solana-mainnet')

        expect(r).toEqual([{ address: SOL_PEER, label: null, source: 'history' }])
        expect(fetchSolanaHistory).toHaveBeenCalledWith(SOL_ME)
        expect(axios.post).not.toHaveBeenCalled()
    })

    it('saglayici hatasinda (fetchSolanaHistory firlatir) bos liste doner — fail-open', async () => {
        fetchSolanaHistory.mockRejectedValue(new Error('SOLANA_HISTORY_HTTP_502'))
        expect(await fetchHistoryCounterparties('https://api.test', SOL_ME, 'solana-mainnet')).toEqual([])
    })

    it('eksik parametrelerde AG CAGRISI YAPMAZ', async () => {
        expect(await fetchHistoryCounterparties('', SOL_ME, 'solana-mainnet')).toEqual([])
        expect(await fetchHistoryCounterparties('https://api.test', 'not-an-address', 'solana-mainnet')).toEqual([])
        expect(await fetchHistoryCounterparties('https://api.test', SOL_ME, null)).toEqual([])
        expect(fetchSolanaHistory).not.toHaveBeenCalled()
    })
})

describe('extractSolanaHistoryCounterparties + buildTrustedList — Solana gecmis adaylari AYNI valflerden gecer', () => {
    // Gercek Helius sekli -> gercek buildTrustedList: bir Solana gecmis adayi,
    // EVM'dekiyle AYNI iki emniyet valfinden (benzeyen aday elenir, iki benzer
    // aday birbirini goturur) geciyor mu? Gecmis DUSMANIN da yazabildigi bir
    // kaynak: bu yuzden sorgusuz "guvenilir" sayilmiyor (bkz. addressPoisoning.js).
    const SOL_TRUSTED = SOL_PEER
    // Bas 6 ('DRpbCB') + son 4 ('21hy') SOL_TRUSTED ile BIREBIR ayni, orta farkli:
    // shortenAddress esigiyle ORTUSEN gercekci bir zehirli adres (bkz.
    // addressPoisoning.js SHOWN_HEAD_TOTAL / minor 6 duzeltmesi).
    const SOL_POISON = 'DRpbCB' + 'Q'.repeat(30) + '21hy'

    it('kendi Solana hesabima benzeyen bir gecmis karsi tarafi ELENIR, tipki EVM icin oldugu gibi', () => {
        const historyRecipients = extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_POISON)], SOL_ME)
        expect(historyRecipients).toEqual([{ address: SOL_POISON, label: null, source: 'history' }])

        const trusted = buildTrustedList({
            accounts: [{ name: 'Solana Cuzdanim', address: SOL_TRUSTED }],
            historyRecipients
        })

        // Gercek zehirleme senaryosu: SOL_POISON gecmiste (dusman koydu), SOL_TRUSTED
        // kendi hesabim. Valf calismasaydi SOL_POISON "tanidik" sayilirdi ve gercek
        // SOL_TRUSTED'a gonderim SAHTE bir uyari uretirdi.
        expect(trusted.map(e => e.address)).toEqual([SOL_TRUSTED])
    })

    it('benzemeyen bir Solana gecmis adayi normal sekilde guvenilir listeye eklenir', () => {
        const historyRecipients = extractSolanaHistoryCounterparties([solNativeTx(SOL_ME, SOL_PEER)], SOL_ME)

        const trusted = buildTrustedList({
            accounts: [{ name: 'Baska Cuzdan', address: SOL_ME }],
            historyRecipients
        })

        expect(trusted.map(e => e.address)).toEqual([SOL_ME, SOL_PEER])
    })
})
