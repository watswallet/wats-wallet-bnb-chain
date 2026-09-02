import { describe, it, expect } from 'vitest'
import { isTon, isEvm, chainSupportsFlow, TON_MAINNET_ID, TON_TESTNET_ID } from './chainKind'
import { isSwapSupported } from './swapChains'
import supported_chains from '../data/supported_chains.json'

describe('chainKind', () => {
    it('TON kimlikleri sabittir', () => {
        expect(TON_MAINNET_ID).toBe(-239)
        expect(TON_TESTNET_ID).toBe(-3)
    })

    it('kind alani ton olan kayit TON dur', () => {
        expect(isTon({ chainId: -239, kind: 'ton' })).toBe(true)
        expect(isEvm({ chainId: -239, kind: 'ton' })).toBe(false)
    })

    it('kind degeri normalize edilir (case/whitespace)', () => {
        // Yanlis yazilmis kind (TON, Ton, ' ton ') TON kaydini EVM'e dusmemeli
        expect(isTon({ chainId: -239, kind: 'TON' })).toBe(true)
        expect(isEvm({ chainId: -239, kind: 'TON' })).toBe(false)

        expect(isTon({ chainId: -239, kind: 'Ton' })).toBe(true)
        expect(isEvm({ chainId: -239, kind: 'Ton' })).toBe(false)

        expect(isTon({ chainId: -239, kind: '  ton  ' })).toBe(true)
        expect(isEvm({ chainId: -239, kind: '  ton  ' })).toBe(false)

        // Buyuk harfli EVM yazimi da normalize edilir
        expect(isEvm({ chainId: 1, kind: 'EVM' })).toBe(true)
        expect(isTon({ chainId: 1, kind: 'EVM' })).toBe(false)
    })

    it('ciplak TON kimligi kayit olmadan da TON sayilir', () => {
        expect(isTon(-239)).toBe(true)
        expect(isTon(-3)).toBe(true)
        expect(isEvm(-239)).toBe(false)
    })

    it('kind alani olmayan kayit EVM dir', () => {
        expect(isEvm({ chainId: 1 })).toBe(true)
        expect(isEvm(56)).toBe(true)
        expect(isTon(1)).toBe(false)
    })

    it('cozulemeyen girdi hicbir tipe dusmez', () => {
        expect(isTon(null)).toBe(false)
        expect(isEvm(null)).toBe(false)
        expect(isTon(undefined)).toBe(false)
        expect(isEvm(undefined)).toBe(false)
        expect(isEvm('merhaba')).toBe(false)
        expect(isTon({})).toBe(false)
    })

    it('bilinmeyen sayisal zincir EVM e duser', () => {
        // Guvenli yon: bilinmeyen bir EVM zinciri TON sanilirsa gonderim yolu komple degisir.
        expect(isEvm(999999)).toBe(true)
        expect(isTon(999999)).toBe(false)
    })
})

// AKIS KAPISI. Bugune kadar swap/bridge'i TON'da gizleyen sey Home.vue'daki bir
// `v-if` idi - yani bir GORUNUM kosulu. Gorunum kosulu bir karar degildir: kopru
// zincir secicileri, takas ekranindaki ag degistirici ve token secicileri o kosulu
// atlayip TON'a gecebiliyordu. Karar artik burada, tek yerde.
//
// FAIL-OPEN bilincli: tanimsiz/bilinmeyen bir akis adi `true` doner. Yanlis yazilmis
// bir flow degeri calisan bir EVM ekranini OLDURMEMELI; korumayi asagidaki testler
// ve cagiran taraftaki wiring testleri kilitler.
describe('chainSupportsFlow', () => {
    const TON_IDS = [-239, -3]
    // TON'da TAKAS ARTIK ACIK (STON.fi entegrasyonu). Kopru ve dapp KAPALI kaliyor:
    // kopru icin native TON tasiyan bir saglayici yok (tasarim §7 karari), dapp yolu
    // ise EIP-1193 ve TON'un hex chainId karsiligi yok.
    const CLOSED_FLOWS = ['bridge', 'dapp']

    it('TON TAKASI gecer - mainnet ve testnet', () => {
        for (const id of TON_IDS) {
            expect(chainSupportsFlow(id, 'swap'), `chainId ${id}`).toBe(true)
        }
    })

    it('TON kopru ve dapp akislarini GECMEZ', () => {
        for (const id of TON_IDS) {
            for (const flow of CLOSED_FLOWS) {
                expect(chainSupportsFlow(id, flow), `${id}/${flow}`).toBe(false)
            }
        }
    })

    it('TON zincir KAYDI ile de ayni sonucu verir (yalniz id ile degil)', () => {
        const record = { chainId: -239, kind: 'ton' }
        expect(chainSupportsFlow(record, 'swap')).toBe(true)
        for (const flow of CLOSED_FLOWS) {
            expect(chainSupportsFlow(record, flow)).toBe(false)
        }
    })

    // TON takasi swapChains.js'teki EVM router tablosuna BAKMAZ - o tablo Uniswap
    // tarzi kontrat adresleri tutuyor ve TON'un orada kaydi yok. Kapinin TON dali
    // isSwapSupported'a dusuyorsa takas SESSIZCE kapali kalir.
    it('TON takasi EVM router tablosuna BAKMAZ', () => {
        expect(isSwapSupported(-239)).toBe(false)
        expect(chainSupportsFlow(-239, 'swap')).toBe(true)
    })

    // MUTASYON BOSLUGU (onceden vardi, TON isi sirasinda bulundu): asagidaki test
    // yalnizca "listelenen EVM zincirleri GECER" diyor, "router kaydi OLMAYAN bir EVM
    // zinciri GECMEZ" demiyordu. isSwapSupported kosulunu silmek hicbir testi
    // dusurmuyordu - yani sigorta diye yazilan sey aslinda takilmiyordu.
    it('router kaydi OLMAYAN bir EVM zinciri takasi GECMEZ', () => {
        const UNLISTED = 999999
        expect(isEvm(UNLISTED)).toBe(true)
        expect(isSwapSupported(UNLISTED)).toBe(false)
        expect(chainSupportsFlow(UNLISTED, 'swap')).toBe(false)
    })

    // Yanlis pozitif sigortasi: supported_chains.json'a yeni bir EVM zinciri eklenip
    // swapChains.js'e eklenmezse bu test CI'da kirilir - kullanicinin takasi degil.
    it('listelenen her EVM zinciri swap ve bridge akislarini gecer', () => {
        const evm = supported_chains.filter((c) => !c.testnet && isEvm(c))
        expect(evm.length).toBeGreaterThan(5)
        for (const chain of evm) {
            expect(chainSupportsFlow(chain, 'bridge')).toBe(true)
            expect(chainSupportsFlow(chain, 'swap')).toBe(true)
        }
    })

    it('akis verilmezse TON dahil her zincir gecer (fail-open)', () => {
        for (const flow of [undefined, null, '']) {
            expect(chainSupportsFlow(-239, flow)).toBe(true)
            expect(chainSupportsFlow(1, flow)).toBe(true)
        }
    })

    it('bilinmeyen akis adinda gecer — yazim hatasi calisan ekrani oldurmez', () => {
        expect(chainSupportsFlow(1, 'takas')).toBe(true)
        expect(chainSupportsFlow(-239, 'takas')).toBe(true)
    })
})
