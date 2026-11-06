import { describe, it, expect } from 'vitest'
import { isTxVisible } from './txVisibility'

const G = 'g-1'

describe('isTxVisible (spec 7.3)', () => {
    it('Gizli Hesap kaydi yalniz gizli modda', () => {
        expect(isTxVisible({ accountKey: G }, { privateActive: true, privateAccountKey: G })).toBe(true)
        expect(isTxVisible({ accountKey: G }, { privateActive: false, privateAccountKey: G })).toBe(false)
    })

    it('normal hesap kaydi yalniz normal modda', () => {
        expect(isTxVisible({ accountKey: 'a-1' }, { privateActive: false, privateAccountKey: G })).toBe(true)
        expect(isTxVisible({ accountKey: 'a-1' }, { privateActive: true, privateAccountKey: G })).toBe(false)
    })

    it('accountKey\'siz eski kayit yalniz normal modda', () => {
        expect(isTxVisible({}, { privateActive: false, privateAccountKey: G })).toBe(true)
        expect(isTxVisible({}, { privateActive: true, privateAccountKey: G })).toBe(false)
    })
})
