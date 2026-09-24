import { describe, it, expect } from 'vitest'
import { swapGivenLeg, solanaFeeLabel, feeUnitFor } from './historyRowText'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const TON = supported_chains.find((c) => Number(c.chainId) === -239)
const SOLANA = supported_chains.find((c) => c.chainId === 'solana-mainnet')

// Testlerde gercek formatNumberShort yerine sade bir bicimleyici: bu modulun
// isi SECIM yapmak, sayiyi bicimlendirmek degil.
const bicim = (v) => String(Number(v))

describe('swapGivenLeg — takas satirinda VERILEN bacak', () => {
    const takas = (legs, extra = {}) => ({ category: 'token swap', erc20_transfers: legs, ...extra })

    it('gonderilen bacagi eksi isaretiyle dondurur', () => {
        const tx = takas([
            { direction: 'send', value_formatted: '0.05', token_symbol: 'BNB' },
            { direction: 'receive', value_formatted: '120.5', token_symbol: 'USDC' },
        ])
        expect(swapGivenLeg(tx, bicim)).toBe('-0.05 BNB')
    })

    it('jetton sembolu varsa bacaktaki sembolu EZER', () => {
        const tx = takas([{ direction: 'send', value_formatted: '3', token_symbol: 'GRAM' }], { jettonSymbol: 'NOT' })
        expect(swapGivenLeg(tx, bicim)).toBe('-3 NOT')
    })

    // Sembol cozulemediginde (bekleyen iskelet, zincir cagrisi dustu) bos dize
    // gelir; sayinin yanina bos bir bosluk birakmak yerine birimsiz yazilir.
    it('sembol bos ise tutar birimsiz yazilir, sonda bosluk kalmaz', () => {
        const tx = takas([{ direction: 'send', value_formatted: '0.05', token_symbol: '' }])
        expect(swapGivenLeg(tx, bicim)).toBe('-0.05')
    })

    it('takas OLMAYAN satirda bos dize doner', () => {
        expect(swapGivenLeg({ category: 'send', erc20_transfers: [{ direction: 'send', value_formatted: '1' }] }, bicim)).toBe('')
        expect(swapGivenLeg({ category: 'receive' }, bicim)).toBe('')
    })

    // Solana satirlari `category` TASIMAZ; bu dala hic girmemeli.
    it('Solana satirinda bos dize doner', () => {
        expect(swapGivenLeg({ direction: 'out', counterparty: 'X', amount: 1 }, bicim)).toBe('')
    })

    it('gonderilen bacak yoksa bos dize doner', () => {
        expect(swapGivenLeg(takas([{ direction: 'receive', value_formatted: '120.5', token_symbol: 'USDC' }]), bicim)).toBe('')
    })

    it('bos/eksik girdide FIRLATMAZ', () => {
        expect(swapGivenLeg(null, bicim)).toBe('')
        expect(swapGivenLeg({}, bicim)).toBe('')
        expect(swapGivenLeg(takas(undefined), bicim)).toBe('')
    })
})

describe('solanaFeeLabel — Solana islem ucreti etiketi', () => {
    it('ucret biliniyorsa SOL cinsinden alti ondalikla yazilir', () => {
        expect(solanaFeeLabel({ fee: 0.000005 }, '—')).toBe('0.000005 SOL')
    })

    // Ucret GERCEKTEN yoksa bilinmiyor isareti: uydurma bir 0 kullaniciya
    // islemin ucretsiz oldugunu soylerdi.
    it('ucret yoksa bilinmiyor isareti doner', () => {
        expect(solanaFeeLabel({ fee: null }, '—')).toBe('—')
        expect(solanaFeeLabel({}, '—')).toBe('—')
        expect(solanaFeeLabel(null, '—')).toBe('—')
    })

    it('sayi olmayan ya da sonsuz deger bilinmiyor sayilir', () => {
        expect(solanaFeeLabel({ fee: '0.000005' }, '—')).toBe('—')
        expect(solanaFeeLabel({ fee: NaN }, '—')).toBe('—')
        expect(solanaFeeLabel({ fee: Infinity }, '—')).toBe('—')
    })

    // Sifir ucret zincirde GERCEKLESMEZ; boyle bir deger geldiyse veri
    // guvenilmezdir ve "0.000000 SOL" yazmak kullaniciyi yanlis bilgilendirir.
    it('sifir ucret bilinmiyor sayilir (0.000000 SOL YAZMAZ)', () => {
        expect(solanaFeeLabel({ fee: 0 }, '—')).toBe('—')
    })
})

describe('feeUnitFor — detay modalindeki ucret birimi', () => {
    it('EVM aginda zincirin native sembolu doner', () => {
        expect(feeUnitFor({ chainId: 56 }, BSC)).toBe('BNB')
    })

    // TON satiri KENDI chainId'sini tasir (tonHistoryView.js). Aktif ag ne
    // olursa olsun satirin kendi zinciri kazanir.
    it('TON satirinda GRAM doner', () => {
        expect(feeUnitFor({ chainId: -239 }, TON)).toBe('GRAM')
        expect(feeUnitFor({ chainId: -3 }, BSC)).toBe('GRAM')
    })

    // Burada sabit 'ETH' yaziliydi: BNB Chain'de ucret "0,000123 ETH" gorunuyordu.
    it('aktif ag BNB Chain iken ETH e DUSMEZ', () => {
        expect(feeUnitFor({}, BSC)).not.toBe('ETH')
        expect(feeUnitFor({}, BSC)).toBe('BNB')
    })

    it('zincir bilinmiyorsa bos dize doner', () => {
        expect(feeUnitFor({}, null)).toBe('')
    })

    it('Solana aginda SOL doner', () => {
        expect(feeUnitFor({}, SOLANA)).toBe('SOL')
    })
})
