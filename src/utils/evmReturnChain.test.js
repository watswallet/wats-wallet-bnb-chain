import { describe, it, expect } from 'vitest'
import { evmReturnChain } from './evmReturnChain'

/**
 * "EVM'e DONUS" zinciri: kullanici EVM disi bir agda dururken bir EVM dapp'ine
 * baglanmak istediginde onay ekranindaki tek tusun hangi zincire goturecegi.
 *
 * NEDEN SAF BIR KATMAN: cevap UC farkli kaynaktan gelebiliyor (hatirlanan son
 * EVM zinciri, Ethereum varsayilani, listedeki ilk EVM kaydi) ve bunlarin
 * SIRASI bir karardir. Karari ekranin icine gomsek, ikinci bir cagiran
 * (or. Header) ayni sirayi tahmin etmek zorunda kalir.
 */

const ETH = { chainId: 1, name: 'Ethereum' }
const BSC = { chainId: 56, name: 'BNB Smart Chain' }
const POLYGON = { chainId: 137, name: 'Polygon' }
const TON = { chainId: -239, name: 'TON', kind: 'ton' }
const SOLANA = { chainId: 'solana-mainnet', name: 'Solana', vm: 'solana' }

const LISTE = [ETH, BSC, POLYGON, TON, SOLANA]

describe('evmReturnChain -- hatirlanan son EVM zinciri', () => {
    it('hatirlanan zincir listede ve EVM ise ONU secer', () => {
        expect(evmReturnChain(56, LISTE)).toEqual(BSC)
    })

    // chainId'ler bu kod tabaninda hem sayi hem METIN dolasiyor (bkz.
    // isSameChainId, store/network.js:235). Kati `===` ile karsilastiran bir
    // surum kullaniciyi her seferinde Ethereum'a dusururdu.
    it('METIN olarak hatirlanan kimlik de cozulur', () => {
        expect(evmReturnChain('137', LISTE)).toEqual(POLYGON)
    })

    it('0x onekli hex olarak hatirlanan kimlik de cozulur', () => {
        expect(evmReturnChain('0x38', LISTE)).toEqual(BSC)
    })
})

describe('evmReturnChain -- EVM OLMAYAN ya da cozulemeyen kimlik', () => {
    // ASIL TUZAK: bu fonksiyonun VAR OLMA SEBEBI kullanicinin EVM DISI bir agda
    // olmasi. Hatirlanan degere korumasiz guvenen bir surum, TON'da takilmis
    // kullaniciyi "TON'a gec" dugmesiyle karsilardi.
    it('hatirlanan zincir TON ise Ethereum a duser', () => {
        expect(evmReturnChain(-239, LISTE)).toEqual(ETH)
    })

    it('hatirlanan zincir Solana ise Ethereum a duser', () => {
        expect(evmReturnChain('solana-mainnet', LISTE)).toEqual(ETH)
    })

    it('hic hatirlanan zincir YOKSA (taze kurulum) Ethereum a duser', () => {
        expect(evmReturnChain(undefined, LISTE)).toEqual(ETH)
        expect(evmReturnChain(null, LISTE)).toEqual(ETH)
    })

    it('listede OLMAYAN bir kimlik Ethereum a duser', () => {
        expect(evmReturnChain(424242, LISTE)).toEqual(ETH)
    })
})

describe('evmReturnChain -- Ethereum un kendisi listede yoksa', () => {
    // Ethereum bir VARSAYILANDIR, GARANTI degil: `LISTED_CHAINS` testnet
    // filtresinden geciyor ve zincir kayitlari veri dosyasindan geliyor.
    // Sabit 1'e guvenen bir surum, o kayit dusurulunce `undefined` dondurup
    // dugmeyi sessizce olduruderdi.
    it('listedeki ILK EVM kaydina duser', () => {
        expect(evmReturnChain(undefined, [TON, POLYGON, BSC])).toEqual(POLYGON)
    })

    it('listede hic EVM kaydi yoksa null doner (dugme gosterilmez)', () => {
        expect(evmReturnChain(undefined, [TON, SOLANA])).toBeNull()
    })

    it('liste bos ya da gecersizse null doner', () => {
        expect(evmReturnChain(1, [])).toBeNull()
        expect(evmReturnChain(1, undefined)).toBeNull()
    })
})

// DAPP'IN KENDI ZINCIRI -- siranin BASI (2026-09-18).
//
// NEDEN EKLENDI: TON'dan baglanan kullanici dapp'in istedigi zincire degil,
// cuzdanin hatirladigi GLOBAL son EVM zincirine dusuyordu. Dapp hemen ardindan
// `wallet_switchEthereumChain` gonderiyor ve kullanici ARKA ARKAYA IKI onay
// ekrani goruyordu. Oysa cevap zaten diskte duruyordu: `dapps[hostname].chainId`
// her baglantida ve her ag degisiminde yaziliyor (ConnectDapp.vue,
// background.js). Bu katman onu yalnizca OKUMUYORDU.
//
// PARAMETRE SIRASI ONCELIK SIRASI DEGILDIR: `dappChainId` en SONDA durur (mevcut
// cagiranlar bozulmasin diye) ama ONCELIGI en YUKSEKTIR. Bu ayrim testte de
// yazili ki ileride "son parametre son care olsun" diye ters cevrilmesin.
describe('evmReturnChain -- dapp in KENDI zinciri', () => {
    it('dapp in zinciri hatirlanan son EVM zincirini YENER', () => {
        // Kullanici TON'da, cuzdanin son EVM'i BSC, dapp en son Polygon'da bagliydi.
        expect(evmReturnChain(56, LISTE, 137)).toEqual(POLYGON)
    })

    it('HEX kimlik cozulur (`dapps[hostname].chainId` diskte hex tutuluyor)', () => {
        expect(evmReturnChain(1, LISTE, '0x38')).toEqual(BSC)
    })

    it('dapp in zinciri YOKSA (ilk baglanti) eski sira aynen isler', () => {
        expect(evmReturnChain(56, LISTE, null)).toEqual(BSC)
        expect(evmReturnChain(56, LISTE, undefined)).toEqual(BSC)
        expect(evmReturnChain(undefined, LISTE, null)).toEqual(ETH)
    })

    it('dapp in zinciri listede YOKSA sessizce eski siraya duser', () => {
        expect(evmReturnChain(56, LISTE, 424242)).toEqual(BSC)
    })

    it('dapp in zinciri EVM DEGILSE reddedilir -- TON da takilmis kullaniciya "TON a gec" denmez', () => {
        // Bayat/bozuk bir kayit EVM disi bir kimlik tasiyabilir; yazici tarafi
        // bugun yalniz EVM yaziyor ama bu ikinci katman.
        expect(evmReturnChain(56, LISTE, -239)).toEqual(BSC)
        expect(evmReturnChain(56, LISTE, 'solana-mainnet')).toEqual(BSC)
    })
})
