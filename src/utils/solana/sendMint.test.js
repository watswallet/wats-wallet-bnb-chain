import { describe, it, expect } from 'vitest'
import { solanaMintOf } from './sendMint'
import { SOL_NATIVE_MARKER } from './constants'

describe('solanaMintOf', () => {
    it('address varsa oldugu gibi doner', () => {
        expect(solanaMintOf({ address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }))
            .toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    })

    it('address yoksa/bossa native SOL varsayilir', () => {
        expect(solanaMintOf({})).toBe(SOL_NATIVE_MARKER)
        expect(solanaMintOf({ address: '' })).toBe(SOL_NATIVE_MARKER)
        expect(solanaMintOf({ address: null })).toBe(SOL_NATIVE_MARKER)
        expect(solanaMintOf(null)).toBe(SOL_NATIVE_MARKER)
        expect(solanaMintOf(undefined)).toBe(SOL_NATIVE_MARKER)
    })
})
