import { describe, it, expect } from 'vitest'
import {
    balanceKey,
    flattenImportedTokens,
    importedForScope,
    scopeChainIds,
    scopeServerChainIds,
    rpcUrlFor,
} from './tokenScope'
import { ALL_NETWORKS } from './networkFilter'

const CHAINS = [
    { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://eth-1' }, { url: 'https://eth-2' }] },
    { chainId: 56, name: 'BNB Chain', rpc: [{ url: 'https://bsc-1' }] },
]

describe('balanceKey', () => {
    // Bakiyeler eskiden YALNIZ adrese gore anahtarliydi. "Tum Aglar" modunda iki
    // zincirin tokenleri AYNI ANDA listede oldugu icin native adres ('0x0') her
    // zincirde ayni anahtara duserdi: Ethereum'un ETH miktari BNB satirinda
    // gorunurdu. Anahtarin zinciri tasimasi bu yuzden zorunlu.
    it('ayni adres farkli zincirlerde FARKLI anahtar uretir', () => {
        expect(balanceKey(1, '0x0')).not.toBe(balanceKey(56, '0x0'))
    })

    it('adres buyuk/kucuk harften bagimsiz ayni anahtara duser', () => {
        expect(balanceKey(1, '0xAbCd')).toBe(balanceKey(1, '0xabcd'))
    })

    it('chainId metin olarak gelse de sayiya normalize edilir', () => {
        expect(balanceKey('56', '0xabc')).toBe(balanceKey(56, '0xabc'))
    })

    it('adres yoksa patlamaz', () => {
        expect(balanceKey(1, undefined)).toBe('1_')
    })

    // TASK 16a: anahtar bicimi ARTIK homeTokenBucket.js'ten geliyor. Bu blok
    // eski (`Number(chainId)` + kosulsuz `.toLowerCase()`) bicimin EVM ciktisini
    // BIREBIR kilitler: burasi Home ile PAYLASILMAYAN ayri bir bakiye haritasi,
    // yani sessiz bir bicim kaymasi butun EVM bakiyelerini "0" gosterirdi.
    it('EVM ADRESLI anahtarlar eski bicimle BIREBIR ayni kalir (regresyon)', () => {
        const eski = (chainId, address) => `${Number(chainId)}_${String(address ?? '').toLowerCase()}`
        const vakalar = [
            [1, '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
            ['137', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'],
            [56, '0x0'],
            [8453, ''],
            [10, null],
        ]
        for (const [chainId, address] of vakalar) {
            expect(balanceKey(chainId, address), `${chainId}/${address}`).toBe(eski(chainId, address))
        }
    })

    // KOD INCELEMESI (Bulgu 3): yukaridaki kilit YALNIZCA '0x'/bos bicimleri
    // gezdigi icin DEGISEN dali (0x OLMAYAN deger) hic calistirmiyordu.
    // SearchTokens.vue:43/86 `balanceKey(chainId, address || symbol)` yaziyor --
    // yani buraya bir TICKER gercekten ulasiyor ve davranis eskisinden FARKLI.
    // Fark KASITLI: 'USDT' bicimce gecerli bir base58 dizesidir, sembolu katlayan
    // her kural bir mint'i de katlar (bkz. homeTokenBucket.js). Deger yalnizca bir
    // Vue `:key`i olarak kullaniliyor; hicbir tekillestirme yolu sembol yedegini
    // kullanmiyor.
    it('SEMBOL yedegi katlanmaz -- eski bicimden BILEREK ayrilan TEK dal', () => {
        const eski = (chainId, address) => `${Number(chainId)}_${String(address ?? '').toLowerCase()}`

        expect(balanceKey(1, 'USDT')).toBe('1_USDT')
        expect(balanceKey(1, 'USDT')).not.toBe(eski(1, 'USDT'))
        expect(balanceKey(137, 'ETH')).toBe('137_ETH')

        // Ayni sembolun iki yazimi AYRI anahtar uretir; bu bir CAKISMA DEGIL,
        // iki ayri satirdir.
        expect(balanceKey(1, 'USDT')).not.toBe(balanceKey(1, 'usdt'))
    })

    // KOK NEDEN: `Number('solana-mainnet')` NaN'dir. Eski bicimde METIN kimlikli
    // HER zincir tek bir 'NaN_...' kovasinda toplanirdi.
    it('Solana kimligi METIN kalir, NaN a dusmez', () => {
        expect(balanceKey('solana-mainnet', 'native')).toBe('solana-mainnet_native')
        expect(balanceKey('solana-mainnet', 'native')).not.toContain('NaN')
    })

    // Base58 buyuk/kucuk harf DUYARLIDIR: kucultulen bir mint artik o mint degildir.
    it('base58 mint in harf kasasi KORUNUR (EVM kucultmesi onu etkilemez)', () => {
        const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        expect(balanceKey('solana-mainnet', MINT)).toBe(`solana-mainnet_${MINT}`)
        expect(balanceKey('solana-mainnet', MINT)).not.toBe(balanceKey('solana-mainnet', MINT.toLowerCase()))
    })

    it('Solana ile EVM ayni adres metniyle bile ayri kovalarda kalir', () => {
        expect(balanceKey('solana-mainnet', 'native')).not.toBe(balanceKey(1, 'native'))
    })

    // KOK NEDEN (BNB "zaten ekli ama hala Ekle diyor"): native varlik kod
    // tabaninda DORT bicimde yaziliyor (bkz. utils/nativeAsset.js) ve iki AYRI
    // sunucu yolu FARKLI bicim donuyor:
    //   /getImportedTokens -> DB'deki eski `binancecoin` kaydi: ZeroAddress,
    //   /getChainTokens    -> istek basina sentezlenen native: '0x0'.
    // Anahtar yalnizca kucultuldugu icin bu ikisi AYRI anahtara dusuyordu ve
    // SearchTokens'in "zaten ekli olani cikar" suzgeci native satiri hic
    // yakalamiyordu: BNB hem EKLENEN hem POPULER listesinde gorunuyordu.
    it('native adresin TUM bicimleri ayni anahtara katlanir', () => {
        const zero = '0x0000000000000000000000000000000000000000'
        const eeee = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

        expect(balanceKey(56, zero)).toBe(balanceKey(56, '0x0'))
        expect(balanceKey(56, eeee)).toBe(balanceKey(56, '0x0'))
    })

    // Katlama ZINCIRI asmaz: native her zincirde ayri bir bakiyedir.
    it('katlanan native anahtari zincir basina AYRI kalir', () => {
        const zero = '0x0000000000000000000000000000000000000000'
        expect(balanceKey(1, zero)).not.toBe(balanceKey(56, '0x0'))
    })

    // Sifir adresi ERC-20 sanilan bir token DEGILDIR ama '0x000...001' gercek bir
    // adrestir: katlama YALNIZCA yer tutuculara uygulanmali.
    it('yer tutucu OLMAYAN adres katlanmaz', () => {
        expect(balanceKey(56, '0x0000000000000000000000000000000000000001'))
            .not.toBe(balanceKey(56, '0x0'))
    })
})

describe('flattenImportedTokens', () => {
    it('her token bulundugu kovanin chainId sini SAYI olarak tasir', () => {
        const out = flattenImportedTokens({ '56': [{ address: '0xa' }], '1': [{ address: '0xb' }] })
        expect(out).toHaveLength(2)
        expect(out.map((t) => t.chainId).sort()).toEqual([1, 56])
        expect(typeof out[0].chainId).toBe('number')
    })

    it('kovadaki chainId alani KOVA anahtarini ezmez (kova belirleyici)', () => {
        const out = flattenImportedTokens({ '56': [{ address: '0xa', chainId: 999 }] })
        expect(out[0].chainId).toBe(56)
    })

    it('bos kova ve bos nesne sessizce atlanir', () => {
        expect(flattenImportedTokens({})).toEqual([])
        expect(flattenImportedTokens({ '1': [], '56': null })).toEqual([])
    })

    it('nesne degil bir deger gelirse bos dizi doner', () => {
        expect(flattenImportedTokens(undefined)).toEqual([])
        expect(flattenImportedTokens(null)).toEqual([])
    })
})

describe('flattenImportedTokens - Solana kovasi ve gecersiz kovalar (O4)', () => {
    it("'solana-mainnet' kovasi METIN kimlikle okunur, NaN uretmez", () => {
        const out = flattenImportedTokens({
            'solana-mainnet': [{ address: 'X' }],
            '56': [{ address: '0xa' }],
        })
        expect(out.map((t) => t.chainId)).toEqual([56, 'solana-mainnet'])
        expect(out.some((t) => Number.isNaN(t.chainId))).toBe(false)
    })

    it("gecersiz kovalar ('NaN', '') ATLANIR, hayalet satir uretmez", () => {
        const out = flattenImportedTokens({
            NaN: [{ address: 'a' }],
            '': [{ address: 'b' }],
            '56': [{ address: '0xa' }],
        })
        expect(out).toHaveLength(1)
        expect(out[0].chainId).toBe(56)
    })

    it('excludeSolana:true YALNIZ Solana kovasini eler', () => {
        const out = flattenImportedTokens(
            { 'solana-mainnet': [{ address: 'X' }], '56': [{ address: '0xa' }] },
            { excludeSolana: true },
        )
        expect(out.map((t) => t.chainId)).toEqual([56])
    })

    it('excludeSolana:true TON kovasina (-239) DOKUNMAZ', () => {
        const out = flattenImportedTokens(
            { 'solana-mainnet': [{ address: 'X' }], '-239': [{ address: 'EQ' }] },
            { excludeSolana: true },
        )
        expect(out.map((t) => t.chainId)).toEqual([-239])
    })

    it('excludeSolana verilmezse Solana kovasi KALIR', () => {
        const out = flattenImportedTokens({ 'solana-mainnet': [{ address: 'X' }] })
        expect(out).toHaveLength(1)
    })
})

describe('importedForScope', () => {
    const BY_CHAIN = {
        'solana-mainnet': [{ address: 'MINT1' }],
        '56': [{ address: '0xa' }],
        '1': [{ address: '0xb' }],
    }

    it("scope 'all' + Solana kovasi -> Solana icin TEK satir, hayalet yok", () => {
        const out = importedForScope(BY_CHAIN, ALL_NETWORKS)
        expect(out.filter((t) => t.chainId === 'solana-mainnet')).toHaveLength(1)
        expect(out).toHaveLength(3)
        expect(out.some((t) => Number.isNaN(t.chainId))).toBe(false)
    })

    it("scope 'all' + excludeSolana -> Solana satiri yok", () => {
        const out = importedForScope(BY_CHAIN, ALL_NETWORKS, { excludeSolana: true })
        expect(out.map((t) => t.chainId).sort()).toEqual([1, 56])
    })

    it("scope 'solana-mainnet' -> yalniz Solana kovasi", () => {
        const out = importedForScope(BY_CHAIN, 'solana-mainnet')
        expect(out).toEqual([{ address: 'MINT1', chainId: 'solana-mainnet' }])
    })

    it('tek EVM kapsami yalniz o kovayi dondurur (metin ve sayi)', () => {
        expect(importedForScope(BY_CHAIN, 56).map((t) => t.address)).toEqual(['0xa'])
        expect(importedForScope(BY_CHAIN, '56').map((t) => t.address)).toEqual(['0xa'])
    })

    it('kovasi olmayan kapsam bos dizi doner', () => {
        expect(importedForScope(BY_CHAIN, 137)).toEqual([])
    })

    it('cozulemeyen kapsam (null, "", "abc") bos dizi doner', () => {
        expect(importedForScope(BY_CHAIN, null)).toEqual([])
        expect(importedForScope(BY_CHAIN, '')).toEqual([])
        expect(importedForScope(BY_CHAIN, 'abc')).toEqual([])
    })

    it('byChain yoksa bos dizi doner', () => {
        expect(importedForScope(undefined, ALL_NETWORKS)).toEqual([])
    })
})

describe('scopeServerChainIds', () => {
    const SOL = { chainId: 'solana-mainnet', vm: 'solana' }

    it("'all' Solana'yi -101 e cevirir", () => {
        expect(scopeServerChainIds(ALL_NETWORKS, [CHAINS[0], SOL])).toEqual([1, -101])
    })

    it("'solana-mainnet' kapsami [-101] verir", () => {
        expect(scopeServerChainIds('solana-mainnet', [CHAINS[0], SOL])).toEqual([-101])
    })

    it('scopeChainIds DEGISMEDI: Solana kapsami hala bos', () => {
        expect(scopeChainIds('solana-mainnet')).toEqual([])
        expect(scopeChainIds('solana-mainnet', [SOL])).toEqual([])
    })

    it('bayrak kapali (chains Solana icermez) -> -101 yok', () => {
        expect(scopeServerChainIds(ALL_NETWORKS, CHAINS)).toEqual([1, 56])
    })

    it('tek EVM kapsami ve cozulemeyen kapsam scopeChainIds ile ayni', () => {
        expect(scopeServerChainIds(56, CHAINS)).toEqual([56])
        expect(scopeServerChainIds(null, CHAINS)).toEqual([])
        expect(scopeServerChainIds('abc', CHAINS)).toEqual([])
    })

    it('chains dizi degilse bos dizi doner', () => {
        expect(scopeServerChainIds(ALL_NETWORKS, undefined)).toEqual([])
    })
})

describe('scopeChainIds', () => {
    it('"all" verilen zincir listesinin TAMAMINI dondurur', () => {
        expect(scopeChainIds(ALL_NETWORKS, CHAINS)).toEqual([1, 56])
    })

    it('tek zincir tek elemanli dizi olur (metin de kabul edilir)', () => {
        expect(scopeChainIds(56, CHAINS)).toEqual([56])
        expect(scopeChainIds('56', CHAINS)).toEqual([56])
    })

    it('cozulemeyen kapsam BOS dizi doner (istek atilmasin)', () => {
        expect(scopeChainIds(null, CHAINS)).toEqual([])
        expect(scopeChainIds('abc', CHAINS)).toEqual([])
    })
})

describe('rpcUrlFor', () => {
    // Aktif zincirin RPC si findFastestRPC ile yukseltilmis olabilir; onu atlayip
    // pakete gomulu ilk RPC ye donmek kullaniciyi daha yavas dugume dusururdu.
    it('aktif zincir icin CANLI rpc kullanilir', () => {
        const url = rpcUrlFor(1, { activeChainId: 1, activeRpc: 'https://hizli', chains: CHAINS })
        expect(url).toBe('https://hizli')
    })

    it('baska zincir icin pakete gomulu ILK rpc kullanilir', () => {
        const url = rpcUrlFor(56, { activeChainId: 1, activeRpc: 'https://hizli', chains: CHAINS })
        expect(url).toBe('https://bsc-1')
    })

    it('canli rpc yoksa aktif zincir de pakete duser', () => {
        expect(rpcUrlFor(1, { activeChainId: 1, activeRpc: '', chains: CHAINS })).toBe('https://eth-1')
    })

    it('bilinmeyen zincir null doner (bakiye okunmaya calisilmaz)', () => {
        expect(rpcUrlFor(999, { activeChainId: 1, activeRpc: 'https://hizli', chains: CHAINS })).toBeNull()
        expect(rpcUrlFor('abc', { activeChainId: 1, activeRpc: 'x', chains: CHAINS })).toBeNull()
    })
})
