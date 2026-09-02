import { describe, it, expect } from 'vitest'
import {
    SOLANA_MAINNET_CHAIN,
    MAX_BATCH_TRANSACTIONS,
    MAX_MESSAGE_BYTES,
    WALLET_STANDARD_VERSION,
    walletStandardMetadata,
} from './walletStandardFeatures'

const BEKLENEN_OZELLIKLER = [
    'standard:connect',
    'standard:disconnect',
    'standard:events',
    'solana:signTransaction',
    'solana:signAndSendTransaction',
    'solana:signMessage',
    'solana:signIn',
]

describe('walletStandardFeatures sabitleri', () => {
    it('zincir, surum ve politika sinirlari', () => {
        expect(SOLANA_MAINNET_CHAIN).toBe('solana:mainnet')
        expect(WALLET_STANDARD_VERSION).toBe('1.0.0')
        expect(MAX_BATCH_TRANSACTIONS).toBe(20)
        expect(MAX_MESSAGE_BYTES).toBe(8192)
    })
})

describe('walletStandardMetadata', () => {
    // tonConnectDevice.js'teki olum-sonrasi inceleme: paylasilan tek bir yetenek
    // nesnesini mutate eden bir cagiran otekileri de bozmustu. Burada her cagiran
    // (sayfa betigi codegen'i, testler) KENDI kopyasini alir.
    it('her cagrida TAZE nesne doner -- ic nesneler dahil', () => {
        const a = walletStandardMetadata()
        const b = walletStandardMetadata()
        expect(a).toEqual(b)
        expect(a).not.toBe(b)
        expect(a.chains).not.toBe(b.chains)
        expect(a.features).not.toBe(b.features)
        expect(a.features['standard:connect']).not.toBe(b.features['standard:connect'])
        expect(a.features['solana:signTransaction'].supportedTransactionVersions)
            .not.toBe(b.features['solana:signTransaction'].supportedTransactionVersions)
    })

    it('bir cagriyi mutate etmek sonraki cagriyi ETKILEMEZ', () => {
        const a = walletStandardMetadata()
        a.chains.push('solana:devnet')
        a.features['solana:signTransaction'].supportedTransactionVersions.length = 0
        delete a.features['solana:signIn']

        const b = walletStandardMetadata()
        expect(b.chains).toEqual(['solana:mainnet'])
        expect(b.features['solana:signTransaction'].supportedTransactionVersions)
            .toEqual(['legacy', 0])
        expect(b.features['solana:signIn']).toEqual({ version: '1.0.0' })
    })

    it('yalniz solana:mainnet bildirilir', () => {
        expect(walletStandardMetadata().chains).toEqual([SOLANA_MAINNET_CHAIN])
    })

    // `solana:signAllTransactions` diye bir ozellik YOKTUR: toplu imzalama,
    // solana:signTransaction'in degisken argumanli cagrilmasidir. Uydurma bir
    // anahtar bildirmek adaptorde sessizce yok sayilir, bizde ise kod uretir.
    it('ozellik kumesi TAM olarak yedi standart addir', () => {
        const keys = Object.keys(walletStandardMetadata().features)
        expect(keys.sort()).toEqual([...BEKLENEN_OZELLIKLER].sort())
        expect(keys).not.toContain('solana:signAllTransactions')
    })

    it('her ozellik version 1.0.0 tasir', () => {
        const features = walletStandardMetadata().features
        for (const key of BEKLENEN_OZELLIKLER) {
            expect(features[key].version, key).toBe('1.0.0')
        }
    })

    // ['legacy','0'] ya da ['legacy','v0'] yazmak adaptoru SESSIZCE legacy-only'ye
    // dusurur -- yani v0 destegi (Jupiter, Meteora) bildirilmemis olur ve hata da
    // gorunmez. Bu yuzden tip iddiasi ayrica yapilir.
    it('supportedTransactionVersions icindeki 0 SAYIDIR, dizge degil', () => {
        const features = walletStandardMetadata().features
        for (const key of ['solana:signTransaction', 'solana:signAndSendTransaction']) {
            const versions = features[key].supportedTransactionVersions
            expect(versions, key).toEqual(['legacy', 0])
            expect(typeof versions[1], key).toBe('number')
            expect(versions).not.toContain('0')
            expect(versions).not.toContain('v0')
        }
    })

    it('yalniz imzalayan iki ozellik supportedTransactionVersions tasir', () => {
        const features = walletStandardMetadata().features
        for (const key of ['standard:connect', 'solana:signMessage', 'solana:signIn']) {
            expect(features[key].supportedTransactionVersions, key).toBeUndefined()
        }
    })

    // METADATA'DIR: cagrilabilir metotlari sayfa betigi `{...metadata[key], metot}`
    // ile birlestirir. Buraya bir fonksiyon girerse codegen onu JSON'a yazamaz ve
    // uretilen blok sessizce eksik cikar.
    it('hicbir alan FONKSIYON degildir', () => {
        const meta = walletStandardMetadata()
        expect(typeof meta.icon).toBe('string')
        for (const [key, value] of Object.entries(meta.features)) {
            for (const [alan, deger] of Object.entries(value)) {
                expect(typeof deger, `${key}.${alan}`).not.toBe('function')
            }
        }
        expect(JSON.parse(JSON.stringify(meta))).toEqual(meta)
    })

    // Wallet Standard WalletIcon tipi: data:image/(svg+xml|webp|png|gif);base64,...
    // URL-kodlanmis SVG ve image/jpeg sozlesme disidir; uzak URL ise ziyaret edilen
    // sayfanin CSP'si tarafindan engellenir.
    it('ikon WalletIcon sablonuna uyar', () => {
        expect(walletStandardMetadata().icon)
            .toMatch(/^data:image\/(svg\+xml|webp|png|gif);base64,[A-Za-z0-9+/]+=*$/)
    })

    it('cuzdan adi sabittir -- dapp listeleri bu dizgeyle esler', () => {
        expect(walletStandardMetadata().name).toBe('WATS Wallet')
        expect(walletStandardMetadata().version).toBe(WALLET_STANDARD_VERSION)
    })
})
