import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { normalizePersonalSignMessage, decodePersonalSignMessage } from './signMessage'

const WALLET = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')

describe('normalizePersonalSignMessage', () => {
    it('hex yuku BAYTA cevirir; hex metnini imzalatmaz', () => {
        const hex = ethers.hexlify(ethers.toUtf8Bytes('Hello'))
        const normalized = normalizePersonalSignMessage(hex)

        expect(normalized).toBeInstanceOf(Uint8Array)
        expect(ethers.toUtf8String(normalized)).toBe('Hello')
    })

    it('hex olmayan metni oldugu gibi birakir (cuzdan ici imzalar bozulmasin)', () => {
        const message = 'change 0xabc name as numan'
        expect(normalizePersonalSignMessage(message)).toBe(message)
    })

    it('tek sayida hex hanesi hex sayilmaz, metin olarak imzalanir', () => {
        expect(normalizePersonalSignMessage('0x123')).toBe('0x123')
    })

    it('bos hex yuku ("0x") bos bayt dizisine cevrilir', () => {
        expect(normalizePersonalSignMessage('0x')).toEqual(new Uint8Array())
    })

    it('string olmayan girdiye dokunmaz', () => {
        const bytes = new Uint8Array([1, 2, 3])
        expect(normalizePersonalSignMessage(bytes)).toBe(bytes)
    })
})

describe('personal_sign imzasi dapp tarafinda dogrulanir', () => {
    it('dapp"in ecrecover"i imzalayan adresi bulur', async () => {
        const original = 'Sign in to Example: nonce 42'
        const hexPayload = ethers.hexlify(ethers.toUtf8Bytes(original))

        const signature = await WALLET.signMessage(normalizePersonalSignMessage(hexPayload))

        // Dapp orijinal metni dogrular; hex metnini degil.
        expect(ethers.verifyMessage(original, signature)).toBe(WALLET.address)
    })

    it('REGRESYON: hex metni dogrudan imzalanirsa dogrulama BASKA adres verir', async () => {
        const original = 'Sign in to Example: nonce 42'
        const hexPayload = ethers.hexlify(ethers.toUtf8Bytes(original))

        // Duzeltmeden onceki davranis: hex string"i UTF-8 metin olarak imzala.
        const brokenSignature = await WALLET.signMessage(hexPayload)

        expect(ethers.verifyMessage(original, brokenSignature)).not.toBe(WALLET.address)
    })

    it('cuzdan ici duz metin imzasi (EditUsername) bozulmadan calisir', async () => {
        const message = `change ${WALLET.address} name as numan`
        const signature = await WALLET.signMessage(normalizePersonalSignMessage(message))

        expect(ethers.verifyMessage(message, signature)).toBe(WALLET.address)
    })
})

describe('decodePersonalSignMessage', () => {
    it('hex yuku okunabilir metne cevirir', () => {
        const hex = ethers.hexlify(ethers.toUtf8Bytes('Merhaba dünya'))
        expect(decodePersonalSignMessage(hex)).toBe('Merhaba dünya')
    })

    it('UTF-8 olarak cozulemeyen ikili veride ham hex gosterir', () => {
        const binary = ethers.hexlify(new Uint8Array([0xff, 0xfe, 0xfd]))
        expect(decodePersonalSignMessage(binary)).toBe(binary)
    })

    it('duz metni oldugu gibi birakir', () => {
        expect(decodePersonalSignMessage('merhaba')).toBe('merhaba')
    })
})
