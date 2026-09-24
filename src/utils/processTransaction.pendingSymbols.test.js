// Bekleyen (yerel) islem iskeletlerinin TOKEN SEMBOLU sozlesmesi.
//
// KOK NEDEN: buildSwapPendingSkeleton token sembolu yerine sabit 'INPUT'/'OUTPUT',
// buildCrossChainPendingSkeleton ise 'TOKEN' yaziyordu (kaynakta "TODO: Gercek
// sembol" notlariyla). Takas onaylanip API'den gercek satir gelene kadar kullanici
// aktivite listesinde "+120,5 OUTPUT" goruyordu ve yanlis token takas ettigini
// sanabiliyordu. Bu dosya o yer tutucularin GERI GELMEDIGINI kilitler.
import { describe, it, expect } from 'vitest'
import { buildSwapPendingSkeleton, buildCrossChainPendingSkeleton } from './processTransaction'

const TX = {
    hash: '0xdead',
    nonce: 7,
    to: '0x9999999999999999999999999999999999999999',
    gasLimit: 21000n,
    gasPrice: 1000000000n,
}
const CUZDAN = { address: '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa' }
const GIRIS_TOKEN = '0x1111111111111111111111111111111111111111'
const CIKIS_TOKEN = '0x2222222222222222222222222222222222222222'

const legOf = (skeleton, direction) => skeleton.erc20_transfers.find((t) => t.direction === direction)

describe('buildSwapPendingSkeleton — gercek semboller', () => {
    const cagir = (extra = {}) => buildSwapPendingSkeleton({
        txResponse: TX, wallet: CUZDAN,
        inputToken: GIRIS_TOKEN, outputToken: CIKIS_TOKEN,
        amountHumanReadable: '0.05', outputAmountHuman: '120.5',
        ...extra,
    })

    it('verilen sembolleri transfer bacaklarina yazar', () => {
        const s = cagir({ inputSymbol: 'ETH', outputSymbol: 'USDC' })
        expect(legOf(s, 'send').token_symbol).toBe('ETH')
        expect(legOf(s, 'receive').token_symbol).toBe('USDC')
    })

    // Sembol cozulemediginde ESKI davranis 'INPUT'/'OUTPUT' yazmakti. Bos birakmak
    // durustur: kullanici birimsiz bir sayi gorur, YANLIS bir token adi degil.
    it('sembol verilmezse INPUT/OUTPUT yer tutucusu YAZMAZ', () => {
        const s = cagir()
        expect(legOf(s, 'send').token_symbol).toBe('')
        expect(legOf(s, 'receive').token_symbol).toBe('')
    })

    it('bos/gecersiz sembol de yer tutucuya DUSMEZ', () => {
        const s = cagir({ inputSymbol: '', outputSymbol: null })
        expect(legOf(s, 'send').token_symbol).toBe('')
        expect(legOf(s, 'receive').token_symbol).toBe('')
    })

    // KOK NEDEN (inceleme bulgusu): sembol ZINCIRDEN geliyor ve bir ERC20
    // kontrati `symbol()` alaninda BOSLUK dondurebiliyor ("US DT"). Ozet
    // bosluklarla kuruldugu ve History.vue onu bosluktan bolup p[2]/p[5]'i
    // token adi sandigi icin, bir tek ic bosluk satiri "Takas: US -> 2.0"
    // gibi tamamen yanlis bir basliga cevirir.
    it('sembolun ICINDEKI bosluklar temizlenir (ozet ayristiricisini kaydirmasin)', () => {
        const s = cagir({ inputSymbol: 'US DT', outputSymbol: 'US  DC' })
        expect(legOf(s, 'send').token_symbol).toBe('USDT')
        expect(legOf(s, 'receive').token_symbol).toBe('USDC')
        expect(s.summary).toBe('Swap 0.05 USDT to 120.5 USDC')
        expect(s.summary.split(' ')[2]).toBe('USDT')
        expect(s.summary.split(' ')[5]).toBe('USDC')
    })

    // Zincirden gelen sembol uzunluk sinirsizdir; 200 karakterlik bir "sembol"
    // hem satiri tasirir hem de ozeti kullanilamaz hale getirir.
    it('asiri uzun sembol makul bir uzunluga kirpilir', () => {
        const s = cagir({ inputSymbol: 'A'.repeat(200), outputSymbol: 'USDC' })
        expect(legOf(s, 'send').token_symbol.length).toBeLessThanOrEqual(16)
    })

    it('iskeletin hicbir yerinde INPUT/OUTPUT yer tutucusu gecmez', () => {
        const metin = JSON.stringify(cagir())
        expect(metin).not.toContain('"INPUT"')
        expect(metin).not.toContain('"OUTPUT"')
    })

    // Semboller ozeti de duzeltir: eski ozet "Swap 0.05 for ~120.5" idi, yani
    // hangi token'dan hangi token'a gidildigi HIC yazmiyordu. History.vue'nun
    // swap_detail ayristiricisi de tam bu bicimi bekliyor.
    it('ozet (summary) sembollerle kurulur', () => {
        const s = cagir({ inputSymbol: 'ETH', outputSymbol: 'USDC' })
        expect(s.summary).toBe('Swap 0.05 ETH to 120.5 USDC')
    })

    // Sembol eksikken AYNI bicimi kurmak History.vue'nun swap_detail
    // ayristiricisina BOS bir token adi verirdi ("Takas:  -> "). O durumda
    // ayristiricinin yedege dustugu daha kisa bicim yazilir.
    it('sembol eksikken ozet ayristiriciyi bos token adiyla beslemez', () => {
        expect(cagir().summary).toBe('Swap 0.05 to 120.5')
        expect(cagir().summary.split(' ').length).toBeLessThan(6)
    })

    it('kategori ve temel alanlar DEGISMEZ', () => {
        const s = cagir({ inputSymbol: 'ETH', outputSymbol: 'USDC' })
        expect(s.category).toBe('token swap')
        expect(s.receipt_status).toBe('pending')
        expect(s.hash).toBe('0xdead')
        expect(legOf(s, 'send').value_formatted).toBe('0.05')
        expect(legOf(s, 'receive').value_formatted).toBe('120.5')
    })
})

describe('buildCrossChainPendingSkeleton — gercek sembol', () => {
    it('verilen sembolu transfer bacagina yazar', () => {
        const s = buildCrossChainPendingSkeleton(TX, CUZDAN.address, '12', GIRIS_TOKEN, 'USDT')
        expect(s.erc20_transfers[0].token_symbol).toBe('USDT')
    })

    it('sembol verilmezse TOKEN yer tutucusu YAZMAZ', () => {
        const s = buildCrossChainPendingSkeleton(TX, CUZDAN.address, '12', GIRIS_TOKEN)
        expect(s.erc20_transfers[0].token_symbol).toBe('')
        expect(JSON.stringify(s)).not.toContain('"TOKEN"')
    })

    it('kategori ve temel alanlar DEGISMEZ', () => {
        const s = buildCrossChainPendingSkeleton(TX, CUZDAN.address, '12', GIRIS_TOKEN, 'USDT')
        expect(s.category).toBe('bridge')
        expect(s.receipt_status).toBe('pending')
        expect(s.erc20_transfers[0].value_formatted).toBe('12')
    })
})
