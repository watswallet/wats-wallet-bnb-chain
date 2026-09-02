// Zincirin native varligi AGA CIKMADAN kurulmali. Bildirilen hata: Polygon aktifken
// Takas ekraninin "Odeyeceksin" butonu BOS geliyordu — uzak `POST /getTokenByName`
// ad anahtarli ve ad ucuncu tarafin (CoinGecko) mulkiyetinde: `nativeCurrency.name`
// "POL" iken DB kaydi "POL (ex-MATIC)" -> 404 -> token `undefined`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildNativeToken, NATIVE_TOKEN_ADDRESS } from './nativeToken'
import { isNativeAsset } from './nativeAsset'
import { ALL_CHAINS, LISTED_CHAINS } from '../data/chains'
import native_tokens from '../data/native_tokens.json'
import { chainVm, isSameChainId } from './vm'
import { isEvm, isTon, isSolana } from './chainKind'
import { SOLANA_CHAIN_ID } from './solana/constants'

// KAPSAM (birlesme sonrasi inceleme, ORTA-2): T1/T3/T7 bir donem
// `LISTED_CHAINS.filter(chainVm === 'evm')` geziyordu. O filtre Solana dalinda,
// TON istemcide HENUZ YOKKEN yazilmisti; birlesmeden sonra TON zincirlerini de
// sessizce disari atiyordu — oysa TON native satiri buildNativeToken(-239) ile
// URETILIYOR (ton/tonTokenSeed.js) ve ana ekranda TON bakiyesi ona bagli.
//
// Filtrenin GERCEK gerekcesi tek bir zincirdi: Solana. Onun native SOL'u bu
// modulden URETILMEZ ('0x0' ile degil kendi isaretcisiyle temsil ediliyor —
// solana/constants.js SOL_NATIVE_MARKER — ve zincirden okunuyor). Bu yuzden
// donguler TAM listeyi gezer ve Solana icin BEKLENTI degisir (null); KAPSAM
// daralmaz.
const isSolanaChain = (chain) => chainVm(chain) === 'solana'

// chainId'nin, deponun TEK tip kapisindan aldigi cevap.
const vmOfId = (id) => (isSolana(id) ? 'solana' : isTon(id) ? 'ton' : isEvm(id) ? 'evm' : 'bilinmiyor')

describe('buildNativeToken', () => {
    // Solana icin `null` donusunun BILEREK oldugunu (unutma degil) kilitler.
    // Cuzdanin Solana kimligi METINDIR: Number('solana-mainnet') NaN'dir ve
    // NaN === NaN false oldugu icin hicbir kayda baglanmaz.
    it('Solana icin null doner (native SOL zincirden okunuyor), THROW ETMEZ', () => {
        expect(buildNativeToken(SOLANA_CHAIN_ID)).toBeNull()
    })

    // T1
    it('listelenen HER zincir icin native token kurulur (aga cikilmadan)', () => {
        for (const chain of LISTED_CHAINS) {
            const token = buildNativeToken(chain.chainId)
            if (isSolanaChain(chain)) {
                expect(token, `zincir ${chain.chainId} (Solana) satir URETMEZ`).toBeNull()
                continue
            }
            expect(token, `zincir ${chain.chainId}`).not.toBeNull()

            const meta = native_tokens[chain.nativeCoingeckoId]
            if (meta) {
                expect(token.symbol).toBe(meta.symbol)
                expect(token.name).toBe(meta.name)
            }

            expect(token.decimals).toBe(Number(chain.nativeCurrency.decimals))
            expect(token.chainId).toBe(Number(chain.chainId))
            expect(typeof token.chainId).toBe('number')
        }
    })

    // T2 — bildirilen hatanin kilidi.
    it('Polygon (137) POL dondurur — uzak liste bu ismi tanimasa da', () => {
        const token = buildNativeToken(137)
        expect(token.symbol).toBe('POL')
        expect(token.name).toBe('POL')
        expect(token.coingecko_id).toBe('polygon-ecosystem-token')
        expect(token.chain).toBe('polygon-pos')
        expect(token.decimals).toBe(18)
    })

    // T3 — motor sozlesmesi. swap.js:507 isNativeToken TAM ESITLIK yapar
    // (`=== ZeroAddress || === '0x0'`), toLowerCase YOK. '0xEeee…' verilirse teklif
    // calisir ama gonderim ERC-20 sanip revert eder.
    it('adres KATI olarak "0x0" ve isNativeAsset onu native sayar', () => {
        expect(NATIVE_TOKEN_ADDRESS).toBe('0x0')
        for (const chain of LISTED_CHAINS) {
            const token = buildNativeToken(chain.chainId)
            if (isSolanaChain(chain)) {
                expect(token, `zincir ${chain.chainId} (Solana) satir URETMEZ`).toBeNull()
                continue
            }
            expect(token.address).toBe('0x0')
            expect(isNativeAsset(token.address)).toBe(true)
        }
    })

    // T4 — bu bir UI VARSAYILANIDIR: cozulemeyen zincir ekrani cokertemez.
    // (nativeChainInfo.js:11 bilerek throw ediyor; bu dosya ondan AYRISIR.)
    it('bilinmeyen/bozuk chainId null doner, THROW ETMEZ', () => {
        expect(buildNativeToken(999999)).toBeNull()
        expect(buildNativeToken(undefined)).toBeNull()
        expect(buildNativeToken(null)).toBeNull()
        expect(buildNativeToken('abc')).toBeNull()
    })

    // ORTA-1 — VM KAPISI KILIDI. Bir donem burada `SERVER_CHAIN_ID_ALIASES`
    // (-101 -> 'solana') vardi: sunucunun Solana kimligiyle cagrildiginda TAM bir
    // SOL satiri uretiliyor ve satir SUNUCUNUN kimligiyle (-101) damgalaniyordu.
    // OLCUM: isEvm(-101) === true, isSolana(-101) === false — yani uretilen SOL
    // satiri deponun tip kapisindan EVM olarak geciyordu. Birlesmede kapatilan
    // hata sinifi tam olarak buydu: bir VM'in satiri otekinin kapisindan geciyor.
    //
    // Satiri 'solana-mainnet' ile damgalamak da COZUM DEGIL: adres '0x0' kalirdi
    // ve Solana tarafinda '0x0' bir SPL MINT'i sayilir (Token.ssr.test.js:224:
    // "'0x0'i bir SPL MINT'i saniyordu"). Satir bu kez Solana kapisindan gecip
    // YANLIS VARLIK olurdu.
    //
    // Karar: FAIL-CLOSED. Bu kimlikle satir URETILMEZ. (Ileride chainKind -101'i
    // gercekten Solana olarak tanirsa bu beklenti guncellenebilir; o durumda da
    // asagidaki VM invariyanti gecerli kalmak zorunda.)
    it('sunucunun -101 Solana kimligiyle satir URETILMEZ (fail-closed)', () => {
        expect(buildNativeToken(-101)).toBeNull()
    })

    // ORTA-1'in ASIL iddiasi: uretilen HER satirin chainId'si, satirin ait oldugu
    // zincirin VM'iyle AYNI siniflanmali. Bir takma kimlik (sunucu kimligi, eski
    // bir alias, yeni bir zincir) satiri baska bir VM'in kapisina sokamaz.
    it('uretilen satirin chainId i zincirin VM kapisindan AYNI cevabi alir', () => {
        const ids = [
            ...ALL_CHAINS.map((c) => c.chainId),
            SOLANA_CHAIN_ID,
            -101,   // sunucunun Solana kimligi (server/utils/chainTokens.js CHAINS)
        ]

        for (const id of ids) {
            const token = buildNativeToken(id)
            if (!token) continue

            const entry = ALL_CHAINS.find((c) => c.chainSlug === token.chain)
            expect(entry, `slug ${token.chain} kayitli degil`).toBeTruthy()
            expect(
                vmOfId(token.chainId),
                `buildNativeToken(${id}) -> chainId ${token.chainId}`,
            ).toBe(chainVm(entry))
        }
    })

    // T5 — SURUKLEME KILIDI. Sunucu `/getChainTokens` listesinin basina kendi native
    // satirini koyuyor; iki taraf ayrisirsa ayni varlik listede ve butonda FARKLI
    // gorunur (secilince "degisti" sanilir).
    it('sunucudaki nativeTokenFor ile BIREBIR ayni sekli uretir', () => {
        const require = createRequire(import.meta.url)
        // Bulunamazsa test KIRMIZI yanar — skip ETMEK sessiz basarisizliktir.
        const { CHAINS, nativeTokenFor } = require('../../../server/utils/chainTokens.js')

        for (const chain of CHAINS) {
            const server = nativeTokenFor(chain)
            if (!server) continue

            // Sunucu kaydinin istemcideki karsiligi (slug uzerinden; sunucu ayni
            // zincirin birden cok yazimini tasiyor).
            const entry = ALL_CHAINS.find((c) => chain.slugs.includes(String(c.chainSlug)))
            expect(entry, `sunucu zinciri ${chain.chainId} istemcide yok`).toBeTruthy()

            // KIMLIK UZAYLARI AYRISAN ZINCIR (bugun yalnizca Solana: sunucu -101,
            // cuzdan 'solana-mainnet'). Satir URETILMEZ — uretilseydi sunucunun
            // kimligiyle damgalanip yanlis VM kapisindan gecerdi (ORTA-1).
            // Surukleme kilidi KAYBOLMAZ, tabloya tasinir: kullanicinin GORDUGU
            // alanlar (sembol/ad/gorsel) ve fiyat kimligi iki tarafta ayni olmak
            // zorunda — T5'in kapattigi ariza zaten buydu.
            if (!isSameChainId(entry.chainId, chain.chainId)) {
                expect(buildNativeToken(chain.chainId), `zincir ${chain.chainId}`).toBeNull()

                const meta = native_tokens[server.coingecko_id]
                expect(meta, `istemci native_tokens.json: ${server.coingecko_id}`).toBeTruthy()
                expect(meta.symbol).toBe(server.symbol)
                expect(meta.name).toBe(server.name)
                expect(meta.image_large).toBe(server.image.large)
                expect(entry.nativeCoingeckoId).toBe(server.coingecko_id)
                continue
            }

            const client = buildNativeToken(chain.chainId)
            expect(client, `zincir ${chain.chainId}`).not.toBeNull()

            expect(client.address).toBe(server.address)
            expect(client.chain).toBe(server.chain)
            expect(client.chainId).toBe(server.chainId)
            expect(client.coingecko_id).toBe(server.coingecko_id)
            expect(client.symbol).toBe(server.symbol)
            expect(client.name).toBe(server.name)
            expect(client.image.large).toBe(server.image.large)
            expect(client.image.small).toBe(server.image.small)
            expect(client.image.thumb).toBe(server.image.thumb)
        }
    })

    // T6 — modulun AGDAN bagimsiz olmasi ozelligin TEK gerekcesi: hata tam olarak
    // "token uzak uctan geliyordu ve gelmiyordu" idi. Kontrol IMPORT LISTESI uzerinden
    // yapilir (yorumda gecen kelime bagimlilik degildir) ve sadece axios'u degil
    // her agli/ortama bagli yolu kapatir.
    it('yalnizca pakete gomulu JSON okur — agli/ortama bagli hicbir bagimliligi yok', () => {
        const source = readFileSync(new URL('./nativeToken.js', import.meta.url), 'utf8')

        const imports = [...source.matchAll(/(?:^|\n)\s*import[^\n]*?from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
        expect(imports.sort()).toEqual(['../data/native_tokens.json', '../data/supported_chains.json'])

        // Kod govdesinde de kacak yol olmamali.
        for (const forbidden of ['config.api', 'require(', 'fetch(', 'chrome.', 'XMLHttpRequest']) {
            expect(source, forbidden).not.toContain(forbidden)
        }
    })

    // T7 — gorsel ASLA null olmaz; `image.large` guard'siz okunan yerler var.
    it('her zincirde image dolu ve small/thumb turetilmis', () => {
        for (const chain of LISTED_CHAINS) {
            const token = buildNativeToken(chain.chainId)
            if (isSolanaChain(chain)) {
                expect(token, `zincir ${chain.chainId} (Solana) satir URETMEZ`).toBeNull()
                continue
            }
            const { image } = token
            expect(image).toBeTruthy()
            expect(typeof image.large).toBe('string')
            expect(image.large.length).toBeGreaterThan(0)

            if (image.large.includes('/large/')) {
                expect(image.small).not.toBe(image.large)
                expect(image.thumb).not.toBe(image.large)
            }
        }
    })

    // KAPSAM KANITI (ORTA-2): TON gercekten olculuyor. buildNativeToken(-239)
    // ton/tonTokenSeed.js'te CANLI cagriliyor; donguler bir daha sessizce
    // daralirsa bu test kirilir.
    it('TON mainnet listede ve native satiri uretiliyor (dongulerin kapsaminda)', () => {
        expect(LISTED_CHAINS.some((c) => chainVm(c) === 'ton')).toBe(true)

        const token = buildNativeToken(-239)
        expect(token).not.toBeNull()
        expect(token.symbol).toBe('TON')
        expect(token.decimals).toBe(9)
        expect(token.chainId).toBe(-239)
        expect(vmOfId(token.chainId)).toBe('ton')
    })

    // YASAK'in kilidi: 10/8453/42161'de logoURI zincir logosudur (Optimism/Base/
    // Arbitrum), varlik ise ETH. logoURI birincil gorsel yapilirsa bugun CALISAN
    // uc zincirde gorunur regresyon olur.
    it('ETH zincirlerinde ZINCIR logosu degil ETH coin gorseli kullanilir', () => {
        for (const chainId of [1, 10, 8453, 42161]) {
            const token = buildNativeToken(chainId)
            expect(token.symbol).toBe('ETH')
            expect(token.image.large).toContain('ethereum.png')
        }
    })
})
