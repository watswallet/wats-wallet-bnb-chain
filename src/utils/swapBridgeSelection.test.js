import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { cryptoStore } from '../store/crypto'
import { clearSwapBridgeSelection } from './swapBridgeSelection'
import { yorumsuz } from '../test-utils/kaynakTarama'

// Takas / Kopru ekranlarinin token-zincir-tutar secimi, aktif ag degisince (applyNetworkChange) ve
// gizli moddan cikista ag geri yuklenince (PrivacyToggle, P5) AYNI govdeyle sifirlanir: onceki
// agdaki secim yeni agda yoktur, birakilirsa kullanici farkinda olmadan yanlis zincirin
// adresine islem kurar.

beforeEach(() => setActivePinia(createPinia()))

const kaynak = (yol) => yorumsuz(readFileSync(new URL(yol, import.meta.url), 'utf8'))

describe('clearSwapBridgeSelection', () => {
    it('Takas ve Kopru secimlerini ilk haline getirir', () => {
        const crypto = cryptoStore()
        crypto.swap.inToken = { symbol: 'USDC' }
        crypto.swap.outToken = { symbol: 'USDT' }
        crypto.bridge.inToken = { symbol: 'ETH' }
        crypto.bridge.outToken = { symbol: 'SOL' }
        crypto.bridge.toChain = 137
        crypto.bridge.amount = 5

        clearSwapBridgeSelection(crypto)

        expect(crypto.swap).toEqual({ inToken: null, outToken: null })
        expect(crypto.bridge).toEqual({ inToken: null, outToken: null, toChain: null, amount: 0 })
    })

    it('baska secimlere (gonderim varligi, secili token, taslak) dokunmaz', () => {
        const crypto = cryptoStore()
        crypto.sendAsset = { symbol: 'ETH' }
        crypto.selected_token_id = 'ethereum'
        crypto.sendDraft = { to: '0xabc' }
        crypto.swap.inToken = { symbol: 'USDC' }

        clearSwapBridgeSelection(crypto)

        expect(crypto.sendAsset).toEqual({ symbol: 'ETH' })
        expect(crypto.selected_token_id).toBe('ethereum')
        expect(crypto.sendDraft).toEqual({ to: '0xabc' })
    })
})

describe('tek govde: iki cagiran ayni yardimciyi kullanir', () => {
    it('applyNetworkChange.js yardimciyi cagirir ve secimleri elle sifirlamaz', () => {
        const src = kaynak('./applyNetworkChange.js')
        expect(src).toContain('clearSwapBridgeSelection(crypto)')
        expect(src).not.toMatch(/crypto\.(bridge|swap)\.\w+\s*=/)
    })

    it('PrivacyToggle.vue yardimciyi cagirir', () => {
        const src = kaynak('../components/privacy/PrivacyToggle.vue')
        expect(src).toContain("from '../../utils/swapBridgeSelection'")
        expect(src).toContain('clearSwapBridgeSelection(cryptoStore())')
    })
})
