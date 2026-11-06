// privateBridgedSources.js -- Relay Depository (zincir, varlik) tablosu: koprulu kaynaklarin TEK izin listesi.
import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import { bridgedDepositoryFor } from './privateBridgedSources'

const DEPOSITORY = getAddress('0x4cd00e387622c35bddb9b4c962c136462338bc31')
const DEPOSITORY_ALT = getAddress('0x59916da825d2d2ec1bf878d71c88826f6633ecca')

describe('bridgedDepositoryFor', () => {
    it('olculen ikililer o zincirin Depository adresini (checksum) dondurur; Mantle ve Cronos farkli adres', () => {
        expect(bridgedDepositoryFor(1, 'USDC')).toBe(DEPOSITORY)
        expect(bridgedDepositoryFor(42161, 'ETH')).toBe(DEPOSITORY)
        expect(bridgedDepositoryFor(5000, 'USDC')).toBe(DEPOSITORY_ALT)
        expect(bridgedDepositoryFor(25, 'USDC')).toBe(DEPOSITORY_ALT)
        expect(bridgedDepositoryFor('8453', 'USDC')).toBe(DEPOSITORY)
    })

    it('yonlendirici rotasi olan ikililer tabloda yok: BSC (her varlik), Base/Polygon DAI, Polygon POL', () => {
        for (const asset of ['USDC', 'USDT', 'DAI', 'BNB']) expect(bridgedDepositoryFor(56, asset), asset).toBeNull()
        expect(bridgedDepositoryFor(8453, 'DAI')).toBeNull()
        expect(bridgedDepositoryFor(137, 'DAI')).toBeNull()
        expect(bridgedDepositoryFor(137, 'POL')).toBeNull()
    })

    it('bilinmeyen zincir, bicim disi kimlik ve varlik null; varlik buyuk/kucuk harf duyarli', () => {
        for (const id of [999999, 0, -239, NaN, undefined, null, 'abc', 1.5, '__proto__', 'constructor']) {
            expect(bridgedDepositoryFor(id, 'USDC'), String(id)).toBeNull()
        }
        for (const asset of ['usdc', '', undefined, null, 42, 'constructor', '__proto__']) {
            expect(bridgedDepositoryFor(1, asset), String(asset)).toBeNull()
        }
    })
})
