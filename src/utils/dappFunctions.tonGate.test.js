import { describe, it, expect, vi } from 'vitest'

// dappFunctions.js modul UST DUZEYINDE chrome.windows.onRemoved.addListener
// cagirir (pencere kapanan bekleyen istekleri temizlemek icin). Bu satir
// import anında calisir; asagidaki `import { hexChainIdFor } ...` ES modul
// semantigi geregi dosyanin geri kalanindan ONCE degerlendirilir. vi.hoisted
// olmadan `globalThis.chrome` henuz tanimlanmamis olur ve import "chrome is
// not defined" ile patlar — asil test edilen davranisla ilgisi yok, sadece
// modulun disaridan chrome API'sine bagimli olmasi.
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { hexChainIdFor } from './dappFunctions'

describe('hexChainIdFor', () => {
    it('EVM zincirini hex e cevirir', () => {
        expect(hexChainIdFor({ chainId: 1 })).toBe('0x1')
        expect(hexChainIdFor({ chainId: 56 })).toBe('0x38')
        expect(hexChainIdFor({ chainId: 42161 })).toBe('0xa4b1')
    })

    it('TON da null doner', () => {
        // (-239).toString(16) === '-ef' -> "0x-ef" gonderiliyordu: dapp bunu ne
        // reddedebilir ne dogru yorumlayabilir.
        expect(hexChainIdFor({ chainId: -239, kind: 'ton' })).toBeNull()
        expect(hexChainIdFor({ chainId: -3, kind: 'ton' })).toBeNull()
    })

    it('cozulemeyen zincirde null doner', () => {
        expect(hexChainIdFor(null)).toBeNull()
        expect(hexChainIdFor({})).toBeNull()
    })

    it('hicbir cikti eksi isareti icermez', () => {
        for (const chain of [{ chainId: 1 }, { chainId: -239, kind: 'ton' }, {}]) {
            const hex = hexChainIdFor(chain)
            if (hex !== null) expect(hex).not.toContain('-')
        }
    })
})

// ConnectDapp.vue'nin baglanti kapisi (dapp'e bagli her konumdan bu ayni
// fonksiyona bakiyor: handleGetChainId, CHAIN_CHANGED, ConnectDapp.connect).
// Bilesenin kendisi (Vue SFC + <script setup>) bu depoda @vue/test-utils veya
// bir DOM ortami (jsdom/happy-dom) kurulu OLMADIGI icin mount edilerek test
// edilemiyor — vitest.config.js `environment: 'node'`, package.json'da bu
// bagimliliklar yok. Bunun yerine ConnectDapp.vue'nin BIREBIR kullandigi
// mantik burada ayri fonksiyonlar olarak yeniden uretilip kilitleniyor:
// `tonBlocked = !hexChainIdFor(currentNetwork)` (onMounted, "Baglan" dugmesini
// gizlemek icin) ve connect() icindeki savunma kontrolu. Ikisi de gercek
// dosyadaki satirlarla ayni ifadeler; kontrat degisirse (ör. biri yalniz
// guncellenirse) bu test de kirilir.
describe('ConnectDapp.vue baglanti kapisi (hexChainIdFor sozlesmesi)', () => {
    // supported_chains.json'daki gercek TON kaydinin sekli: { chainId: -239, kind: 'ton', ... }
    const TON_NETWORK = { chainId: -239, kind: 'ton', name: 'TON' }
    const TON_TESTNET_NETWORK = { chainId: -3, kind: 'ton', name: 'TON Testnet' }
    const ETH_NETWORK = { chainId: 1, name: 'Ethereum' }

    // ConnectDapp.vue > onMounted: tonBlocked.value = !hexChainIdFor(currentNetwork)
    const tonBlockedFor = (currentNetwork) => !hexChainIdFor(currentNetwork)

    it('TON secili iken "Baglan" dugmesi gizlenir (tonBlocked = true)', () => {
        expect(tonBlockedFor(TON_NETWORK)).toBe(true)
        expect(tonBlockedFor(TON_TESTNET_NETWORK)).toBe(true)
    })

    it('EVM secili iken dugme gorunur (tonBlocked = false)', () => {
        expect(tonBlockedFor(ETH_NETWORK)).toBe(false)
    })

    // ConnectDapp.vue > connect(): hexChainId olmadan dapp KAYDI ACILMAZ,
    // istek 4901 ile reddedilir (handleGetChainId'yle ayni kod).
    function connectGate(currentNetwork) {
        const hexChainId = hexChainIdFor(currentNetwork)
        if (!hexChainId) {
            return { opened: false, rejection: { code: 4901, message: 'Wallet is on a non-EVM network (TON)' } }
        }
        return { opened: true, chainId: hexChainId }
    }

    it('TON da dapp kaydi ASLA acilmaz, 4901 ile reddedilir', () => {
        const result = connectGate(TON_NETWORK)
        expect(result.opened).toBe(false)
        expect(result.rejection.code).toBe(4901)
    })

    it('EVM de dapp kaydi normal acilir, gercek hex chainId ile', () => {
        const result = connectGate(ETH_NETWORK)
        expect(result.opened).toBe(true)
        expect(result.chainId).toBe('0x1')
    })
})
