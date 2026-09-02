// AddAddress.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (Task 16b): ekran `ethers.isAddress` ile kapida duruyordu, yani bir
// Solana adresi ADRES DEFTERINE HICBIR ZAMAN kaydedilemiyordu. Bu, poisoned-address
// tespitinin dort kaynagindan biri olan `saved_addresses`i Solana'da KALICI
// olarak bos birakiyordu (bkz. utils/addressPoisoning.js:150-158).
//
// Bu dosyada onMounted YOK, yani 'vue' mock'una (onMounted->onServerPrefetch)
// gerek YOK -- ssrRender.js'in captureInstance/render'i tek basina yeterli.
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../../test-utils/ssrRender.js'
import { networkStore } from '../../../store/network'
import AddAddress from './AddAddress.vue'
import supported_chains from '../../../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

// Gercek, egri ustunde bir cuzdan adresi (address.test.js ile AYNI sabit).
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
// Gercek, egri DISINDA bir PDA -- gecerli base58/32 bayt ama cuzdan DEGIL.
const PDA = '8nqnRHi4kQS7YjFmov2Khht6GQ8Fh58dDqQWe7dBE1gg'

afterEach(() => {
    delete globalThis.chrome
})

function setup(chainRecord) {
    const chromeStub = installChromeStub({})
    const app = createApp(AddAddress)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    const captured = captureInstance(app, 'AddAddress')
    return { app, captured, chromeStub }
}

describe('AddAddress.vue (SSR) -- EVM REGRESYONU: davranis degismedi', () => {
    it('gecersiz EVM adresinde ESKI mesaj gorunur, isValid false kalir', async () => {
        const { app, captured } = setup(ETH_CHAIN)
        await render(app)

        captured.instance.setupState.address = 'not-an-address'

        expect(captured.instance.setupState.isValid).toBe(false)
        expect(captured.instance.setupState.reason).toBe('INVALID_EVM_ADDRESS')
    })

    it('gecerli EVM adresi kabul edilir ve OLDUGU GIBI (kucultulmeden) kaydedilir', async () => {
        const { app, captured, chromeStub } = setup(ETH_CHAIN)
        await render(app)

        // Tumu kucuk harf: ethers.isAddress checksum'suz ADRESLERI de kabul eder
        // (checksum kontrolu YALNIZCA karisik harf kasasinda devreye girer).
        const EVM_ADDR = '0xabcdef0000000000000000000000000000000001'
        captured.instance.setupState.address = EVM_ADDR
        captured.instance.setupState.label = 'Test'

        expect(captured.instance.setupState.isValid).toBe(true)
        await captured.instance.setupState.add()

        expect(chromeStub.localStore.saved_addresses).toEqual([
            { address: EVM_ADDR, label: 'Test', chainId: 1 },
        ])
    })
})

describe('AddAddress.vue (SSR) -- Solana adresi ARTIK kabul edilir (Task 16b)', () => {
    it('gecerli bir Solana cuzdan adresi kabul edilir', async () => {
        const { app, captured } = setup(SOLANA_CHAIN)
        await render(app)

        captured.instance.setupState.address = WALLET

        expect(captured.instance.setupState.isValid).toBe(true)
        expect(captured.instance.setupState.reason).toBe(null)
    })

    it('egri DISINDAKI (cuzdan olmayan) bir adres RECIPIENT_NOT_WALLET ile reddedilir', async () => {
        const { app, captured } = setup(SOLANA_CHAIN)
        await render(app)

        captured.instance.setupState.address = PDA

        expect(captured.instance.setupState.isValid).toBe(false)
        expect(captured.instance.setupState.reason).toBe('RECIPIENT_NOT_WALLET')
    })

    it('bicimsiz bir Solana adresi INVALID_SOLANA_ADDRESS ile reddedilir', async () => {
        const { app, captured } = setup(SOLANA_CHAIN)
        await render(app)

        captured.instance.setupState.address = 'not-base58!!'

        expect(captured.instance.setupState.isValid).toBe(false)
        expect(captured.instance.setupState.reason).toBe('INVALID_SOLANA_ADDRESS')
    })

    it('kaydedilen Solana adresi harf kasasi BIREBIR korunarak yazilir, chainId metin kalir', async () => {
        const { app, captured, chromeStub } = setup(SOLANA_CHAIN)
        await render(app)

        captured.instance.setupState.address = `  ${WALLET}  ` // bastaki/sondaki bosluk
        captured.instance.setupState.label = 'Solana Cuzdanim'

        await captured.instance.setupState.add()

        expect(chromeStub.localStore.saved_addresses).toEqual([
            { address: WALLET, label: 'Solana Cuzdanim', chainId: 'solana-mainnet' },
        ])
        // NaN'a DUSMEDI (Number('solana-mainnet') NaN'dir): chainId AYNEN metin.
        expect(chromeStub.localStore.saved_addresses[0].chainId).not.toBeNaN()
    })
})
