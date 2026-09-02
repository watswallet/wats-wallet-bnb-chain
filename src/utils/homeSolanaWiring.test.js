// Home.vue + NetworkScopePill.vue: Solana bakiyesinin GORUNUR OLMASINI kilitleyen
// tel testleri — kaynak uzerinden (bkz. assetRouteWiring.test.js / selectNetworkWiring.test.js
// ayni gerekce: bu depoda bilesen (mount) testi YOK).
//
// KOK NEDENLER (dordu, Task 9 brief'inde tanimli):
// 1) loadCurrentTokens `chainId: Number(chainId)` yaziyordu: Solana kovasi NaN
//    olur, SPL tokenlar listeden SESSIZCE duserdi.
// 2) updateBalance `if(!network.rpc) return` ile basliyordu: Solana kaydinda
//    rpc YOK, setRpc hic cagrilmaz, network.rpc ONCEKI zincirden BAYAT kalirdi.
// 3) watch(() => network.rpc, ...) TEK basina Solana'da hic tetiklenmezdi:
//    Solana'ya gecince network.rpc DEGISMEZ.
// 4) chainData.rpc[0].url Solana kaydinda TypeError atar, ic catch'e dusup
//    sessizce yutulur, bakiye 0 kalirdi.
// + Filtre karsilastirmalari (`t.chainId === filtre`) kati esitlik kullaniyordu;
//   nextNetworkFilter artik Solana'nin METIN kimligini dondurebildigi icin bu
//   karsilastirmalar isSameChainId'e gecmeli, aksi halde liste sessizce BOS kalir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const HOME = read('components/Home.vue')
const PILL = read('components/NetworkScopePill.vue')

/**
 * `anchor` iceren satirdan baslar, kapanisi SATIR BASINDA olan ilk `}` satirinda biter.
 * YORUMLAR ATILIR: aksi halde kilit SAHTE olur — bir duzeltme yorumu eski kod
 * parcasini METIN olarak icerebilir (bkz. asagidaki negatif kontroller) ve
 * yorumsuz strip olmadan bu testler hep yanlis yesil/kirmizi verirdi.
 */
const block = (source, anchor, closer = /^\}/) => {
    const lines = source.split(/\r?\n/)
    const start = lines.findIndex((l) => l.includes(anchor))
    if (start < 0) return ''
    const end = lines.findIndex((l, i) => i > start && closer.test(l))
    return lines.slice(start, end < 0 ? undefined : end)
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join(String.fromCharCode(10))
}

describe('(1) loadCurrentTokens: kova anahtari NaN uretmez', () => {
    it('normalizeBucketChainId kullanilir, ham Number(chainId) DEGIL', () => {
        // Import listesi Task 16b review (F1) ile dedupeTokenRows'u da kazandi --
        // regex ozel olarak iki adin VARLIGINI arar, ARADAKI/ETRAFTAKI diger
        // adlarla ilgilenmez (aksi halde bu tur her yeni import BURAYI kirar).
        expect(HOME).toMatch(/import\s*\{[^}]*normalizeBucketChainId[^}]*\}\s*from\s*['"]\.\.\/utils\/homeTokenBucket['"]/)
        expect(HOME).toMatch(/import\s*\{[^}]*tokenBucketKey[^}]*\}\s*from\s*['"]\.\.\/utils\/homeTokenBucket['"]/)

        const fn = block(HOME, 'const loadCurrentTokens =')
        expect(fn).toMatch(/chainId:\s*normalizeBucketChainId\(chainId\)/)
        expect(fn).not.toMatch(/chainId:\s*Number\(chainId\)/)
    })
})

describe('(2) updateBalance: Solana dali rpc kontrolunden ONCE gelir', () => {
    it('chainVm dali fonksiyonun BASINDA, network.rpc kontrolunden ONCE', () => {
        const fn = block(HOME, 'const updateBalance = async')
        const solanaIdx = fn.indexOf("chainVm(network.currentNetwork) === 'solana'")
        const rpcGuardIdx = fn.indexOf('if(!network.rpc) return')

        expect(solanaIdx).toBeGreaterThan(-1)
        expect(rpcGuardIdx).toBeGreaterThan(-1)
        expect(solanaIdx).toBeLessThan(rpcGuardIdx)
    })

    // Adres cozumu + satir cekme, nihai incelemede (Bulgu 3) `updateBalance`in
    // ICINDEN `loadSolanaRows` yardimcisina TASINDI: ayni is artik IKI daldan
    // (Solana aktif / EVM aktif + "Tum Aglar") cagriliyor. Kilit yardimciya
    // tasindi; DAVRANIS ayrica Home.allNetworks.ssr.test.js'te GERCEK render ile
    // dogrulaniyor (kaynak taramasi tek basina yeterli bir savunma degil).
    it('Solana satirlari SOLANA_GET_ADDRESS uzerinden cozulen adresle cekilir', () => {
        const fn = block(HOME, 'const loadSolanaRows = async')
        expect(fn).toMatch(/type:\s*'SOLANA_GET_ADDRESS'/)
        expect(fn).toMatch(/useSolanaAssets\(solanaAddress\)/)
    })

    it('Solana dalinda getTokensData applySolanaRows tan ONCE cagrilir', () => {
        const fn = block(HOME, 'const updateBalance = async')
        const solanaBranch = fn.slice(fn.indexOf("chainVm(network.currentNetwork) === 'solana'"))
        const getTokensIdx = solanaBranch.indexOf('await getTokensData()')
        const applyIdx = solanaBranch.indexOf('applySolanaRows(rows)')

        expect(getTokensIdx).toBeGreaterThan(-1)
        expect(applyIdx).toBeGreaterThan(-1)
        expect(getTokensIdx).toBeLessThan(applyIdx)
    })

    // Review Bulgu (minor): cozulemeyen adres BOS cuzdanla AYNI SEY DEGIL. Kasa
    // kilitliyken SOLANA_GET_ADDRESS hata doner; adres yoksa useSolanaAssets hic
    // cagrilmadan erken cikilmali, aksi halde bos liste "0 token" gibi gorunur.
    it('adres cozulemezse useSolanaAssets cagrilmadan erken cikilir', () => {
        const fn = block(HOME, 'const loadSolanaRows = async')
        const guardIdx = fn.indexOf('if (!solanaAddress)')
        const useAssetsIdx = fn.indexOf('useSolanaAssets(solanaAddress)')

        expect(guardIdx).toBeGreaterThan(-1)
        expect(useAssetsIdx).toBeGreaterThan(-1)
        expect(guardIdx).toBeLessThan(useAssetsIdx)
    })
})

describe('(3) balance izleyicisi zincirin KENDISINI de izler', () => {
    it('watch kaynagi network.rpc VE currentNetwork.chainId dizisi', () => {
        expect(HOME).toMatch(/watch\(\(\)\s*=>\s*\[network\.rpc,\s*network\.currentNetwork\?\.chainId\]/)
    })

    it('eski TEK kaynakli izleyici artik yok', () => {
        expect(HOME).not.toMatch(/watch\(\(\)\s*=>\s*network\.rpc,\s*async/)
    })
})

describe('(4) EVM RPC yolu rpcUrlsOf uzerinden okunur', () => {
    it('rpcUrlsOf(chainData)[0] kullanilir, ham chainData.rpc[0].url DEGIL', () => {
        expect(HOME).toMatch(/import\s*\{\s*chainVm,\s*isSameChainId,\s*rpcUrlsOf\s*\}\s*from\s*['"]\.\.\/utils\/vm['"]/)

        const fn = block(HOME, 'const updateBalance = async')
        expect(fn).toMatch(/rpcUrlsOf\(chainData\)\[0\]/)
        expect(fn).not.toMatch(/chainData\.rpc\[0\]\.url/)
    })
})

describe('(5) filtre/chainId karsilastirmalari isSameChainId tabanli', () => {
    it('getChainLogo isSameChainId kullanir', () => {
        const fn = block(HOME, 'const getChainLogo =')
        expect(fn).toMatch(/isSameChainId\(c\.chainId,\s*chainId\)/)
        expect(fn).not.toMatch(/Number\(c\.chainId\)\s*===\s*Number\(chainId\)/)
    })

    it('displayedTokens listesi filtreyi isSameChainId ile karsilastirir', () => {
        const fn = block(HOME, 'const displayedTokens = computed')
        expect(fn).toMatch(/isSameChainId\(t\.chainId,\s*selectedFilterNetwork\.value\)/)
        expect(fn).not.toMatch(/t\.chainId\s*===\s*selectedFilterNetwork\.value/)
    })

    it('bos-liste basligindaki zincir adi da isSameChainId ile cozulur', () => {
        expect(HOME).toMatch(/isSameChainId\(c\.chainId,\s*selectedFilterNetwork\)/)
        expect(HOME).not.toMatch(/c\.chainId\s*===\s*selectedFilterNetwork(?!\.)/)
    })

    it('EVM bakiye yolundaki chainData da isSameChainId ile bulunur', () => {
        const fn = block(HOME, 'const updateBalance = async')
        expect(fn).toMatch(/chains\.find\(c\s*=>\s*isSameChainId\(c\.chainId,\s*token\.chainId\)\)/)
    })
})

describe('(6) applySolanaRows EVM dali ile AYNI alanlari doldurur', () => {
    it('tokenBucketKey ile anahtarlanir, tokenBalances alanlari EVM ile ayni', () => {
        const fn = block(HOME, 'const applySolanaRows =')
        expect(fn).toMatch(/tokenBucketKey\(row\.chainId,\s*row\.address\)/)
        for (const field of ['amount', 'price', 'change', 'value', 'nowValue', 'oldValue']) {
            expect(fn, field).toMatch(new RegExp(`tokenBalances\\[key\\]\\.${field}\\s*=`))
        }
        expect(fn).toMatch(/user\.percentageUSD\s*=/)
        expect(fn).toMatch(/user\.percentage\s*=/)
        expect(fn).toMatch(/user\.usd\s*=/)
    })

    it('metadata/fiyati bilinmeyen satir ATLANMAZ (miktar toplamdan ONCE yazilir)', () => {
        const fn = block(HOME, 'const applySolanaRows =')
        const amountIdx = fn.indexOf('tokenBalances[key].amount = row.amount')
        const continueIdx = fn.indexOf('if (!data) continue')
        expect(amountIdx).toBeGreaterThan(-1)
        expect(continueIdx).toBeGreaterThan(-1)
        expect(amountIdx).toBeLessThan(continueIdx)
    })
})

describe('(7) NetworkScopePill: kimlik cozumlemesi Solana ile bos etiket birakmaz', () => {
    it('chainOf isSameChainId kullanir, kati Number() esitligi DEGIL', () => {
        expect(PILL).toMatch(/import\s*\{\s*isSameChainId\s*\}\s*from\s*['"]\.\.\/utils\/vm['"]/)

        // chainOf tek satirlik bir const: satirin KENDISI aliniyor (block()
        // birden fazla satirlik govdeler icin, burada gereksiz).
        const line = PILL.split(/\r?\n/).find((l) => l.includes('const chainOf ='))
        expect(line).toMatch(/isSameChainId\(c\.chainId,\s*chainId\)/)
        expect(line).not.toMatch(/Number\(c\.chainId\)\s*===\s*Number\(chainId\)/)
    })
})

describe('(8) selectToken: satirin chainId tipini bozmadan Token.vue ye tasir', () => {
    // Trap #1'in ikinci ucu: loadCurrentTokens'in kova okurken duzelttigi ayni
    // Number(chainId) hatasi, satira TIKLANINCA burada tekrar ediyordu. Home bir
    // Solana bakiyesini DOGRU gosterip, kullanici ona basinca NaN'li bir kayitla
    // Token.vue'ye gonderiyordu — gorunen ilk hatanin hemen ardindan gelen ikinci,
    // gizli hata.
    it('chainId normalizeBucketChainId ile gecirilir, ham Number(token.chainId) DEGIL', () => {
        const fn = block(HOME, 'const selectToken =')
        expect(fn).toMatch(/chainId:\s*normalizeBucketChainId\(token\.chainId\)/)
        expect(fn).not.toMatch(/chainId:\s*Number\(token\.chainId\)/)
    })

    it('adres KUCULTULMEZ, oldugu gibi tasinir (base58 buyuk/kucuk harf duyarli)', () => {
        const fn = block(HOME, 'const selectToken =')
        expect(fn).toMatch(/address:\s*token\.address/)
        expect(fn).not.toMatch(/address:\s*token\.address\.toLowerCase\(\)/)
    })

    it('satirin kimligi (id + chainId + address) hep birlikte yazilir', () => {
        const fn = block(HOME, 'const selectToken =')
        expect(fn).toMatch(/selected_token_ref\s*=/)
        expect(fn).toMatch(/id:\s*token\.coingecko_id/)
        expect(fn).toMatch(/chainId:/)
        expect(fn).toMatch(/address:/)
    })
})

// FINDING 2 (review): applySolanaRows `currentTokens.value = rows` yazip
// loadCurrentTokens'in okudugu EVM capraz-zincir listesini SILIYORDU. Solana
// aktifken "Tum Aglar" yalniz Solana satirlarini gosteriyor, bashlik dolar
// rakami EVM kismini kaybediyordu — bu findingin tam olarak duzelttigi kirilma.
describe('(9) Solana aktifken EVM portfoyu KAYBOLMAZ (birlesik liste + toplam)', () => {
    it('loadCurrentTokens EVM listesini AYRI bir refe (evmImportedTokens) de yazar', () => {
        const fn = block(HOME, 'const loadCurrentTokens =')
        expect(fn).toMatch(/evmImportedTokens\.value\s*=\s*allTokens/)
        expect(fn).toMatch(/currentTokens\.value\s*=\s*allTokens/)
    })

    it('bakiye sozlugu yalniz EVM aktifken silinir', () => {
        const fn = block(HOME, 'const loadCurrentTokens =')
        expect(fn).toMatch(/if\s*\(chainVm\(network\.currentNetwork\)\s*!==\s*'solana'\)\s*user\.tokenBalances\s*=\s*\{\}/)
    })

    it('Solana dali currentTokens.value i EVM + Solana BIRLESIMI olarak yazar', () => {
        const fn = block(HOME, 'const updateBalance = async')
        // Task 16b review (F1): duz birlesim `dedupeTokenRows`e tasindi (canli
        // bakiye satiri ile ayni mint'i tasiyan bir ice-aktarilmis yer tutucu
        // varsa CAKISMAYI eler) -- ama girdiler HALA AYNI iki kaynak
        // (evmImportedTokens.value, rows), yani "birlesim" iddiasi HALA gecerli.
        expect(fn).toMatch(/currentTokens\.value\s*=\s*dedupeTokenRows\(evmImportedTokens\.value,\s*rows\)/)
        // Eski kirici satir: yalniz Solana satirlarina esitleme.
        expect(fn).not.toMatch(/currentTokens\.value\s*=\s*rows(?!\.)/)
    })

    it('applySolanaRows currentTokens.value i ARTIK EZMEZ (cagiranin birlesimini korur)', () => {
        const fn = block(HOME, 'const applySolanaRows =')
        expect(fn).not.toMatch(/currentTokens\.value\s*=\s*rows/)
    })

    it('portfoy toplami currentTokens.value in TAMAMINDAN (EVM + Solana) hesaplanir, yalniz rows tan DEGIL', () => {
        const fn = block(HOME, 'const applySolanaRows =')
        // Toplam dongusu `rows` degil `currentTokens.value` uzerinde gezer.
        const totalsBlock = fn.slice(fn.indexOf('let usdBalance = 0'))
        expect(totalsBlock).toMatch(/for\s*\(const token of currentTokens\.value\)/)
        expect(totalsBlock).not.toMatch(/for\s*\(const row of rows\)/)
    })
})
