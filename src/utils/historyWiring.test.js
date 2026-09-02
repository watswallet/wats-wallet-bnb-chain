// History.vue'nun Solana teline dair davranislarindan PURE MODULLERE
// cikarilamayanlari — kaynak uzerinden kilitlenir. Bu depoda component
// mount-test harness'i yok (bkz. sendConfirmWiring.test.js, homeSolanaWiring.test.js
// ustundeki ayni gerekce); asagidaki testler AYNI kaynak-tarama teknigini kullanir.
//
// Hesaplanabilir/saf olan mantik (adres cozumleme + hata siniflandirma, durum/
// sembol etiketleme) zaten PURE modullere cikarildi ve GERCEKTEN unit test
// edildi: bkz. utils/solana/loadHistory.js + loadHistory.test.js,
// utils/historyRowDisplay.js + historyRowDisplay.test.js. Bu dosya SADECE o
// modullerin History.vue'ye DOGRU sekilde BAGLANDIGINI kilitler.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const HISTORY = readFileSync(join(here, '..', 'components/History.vue'), 'utf8')
// Sadece <template> blogu: script tarafindaki KOD INCELEMESI yorumlari eski
// (buggy) cagriyi METIN olarak alintiliyor olabilir — negatif kontroller
// (`.not.toMatch`) TAM OLARAK bu yuzden yalniz sablon uzerinde calismali,
// aksi halde bir aciklama yorumu testi SAHTE kirmizi'ye dusurur.
const TEMPLATE = HISTORY.slice(0, HISTORY.indexOf('<script'))

/**
 * `anchor` iceren satirdan baslar, kapanisi SATIR BASINDA olan ilk `}` satirinda
 * biter. YORUMLAR ATILIR: aksi halde kilit SAHTE olur — bir aciklama yorumu eski
 * kod parcasini METIN olarak icerebilir.
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

// KOD INCELEMESI (review round 1, Bulgu 4): asagidaki iki `it` (chainVm gecidi
// + "erken doner") burada DAHA ONCE kaynak-tarama (fn.indexOf ile literal arama)
// olarak vardi. Reviewer'in bulgusu: `chainVm(network.currentNetwork) === 'solana'`
// kontrolu `=== 'solana' || chainVm(network.currentNetwork) === 'evm'`e (HER
// ZAMAN DOGRU, yani EVM'i de Solana yoluna sokan bir mutasyona) donusturulse
// bile aranan alt-dizgi METIN icinde hala VAR olur -- kilit yesil KALIRDI.
// "Bir yeniden adlandirmayla yenilen kilit, korumadan beter, cunku koruma gibi
// OKUNUR." Bu ikisi History.ssr.test.js'teki GERCEK render/davranis testleriyle
// DEGISTIRILDI (bkz. "EVM/Solana yol ayrimi GERCEK render ile" describe blogu):
// EVM secilince axios.post/wallet-history CAGRILIR, /solana/history HIC
// cagrilmaz; Solana secilince (GERCEK 'solana-mainnet' chainId'siyle) tam
// tersi. Ayni testler "Number(chainId)" kilidinin (asagida da kaldirilan)
// davranissal karsiligini da tasir: 'solana-mainnet' Number()'a CEVRILEMEYEN
// bir metindir, yol buna RAGMEN dogru calisir.
describe('History.vue — Solana dali dogru modullere baglanir', () => {
    it('loadSolanaHistory ve historyRowDisplay yardimcilari ice aktarilir', () => {
        expect(HISTORY).toMatch(/import\s*\{\s*loadSolanaHistory\s*\}\s*from\s*['"]\.\.\/utils\/solana\/loadHistory['"]/)
        expect(HISTORY).toMatch(/import\s*\{\s*isSolanaHistoryRow,\s*historyStatusKind,\s*solanaSymbolLabel\s*\}\s*from\s*['"]\.\.\/utils\/historyRowDisplay['"]/)
    })

    // Task 14 brief: bos liste ile "adresin cozulemedi" AYNI GORUNURSE kullanici
    // parasi kaybolmus sanabilir. loadSolanaHistory { error } ile doner; bu deger
    // SESSIZCE ATILMAMALI, historyError'a YAZILMALI.
    it('loadSolanaHistory sonucundaki error alani historyError a yazilir (yutulmaz)', () => {
        const fn = block(HISTORY, 'const fetchSolanaTxHistory = async')
        expect(fn).toMatch(/historyError\.value\s*=\s*result\.error/)
    })

    it('chrome.storage.local.get gibi beklenmeyen bir cokme de "yukleniyor"da asili BIRAKMAZ', () => {
        const fn = block(HISTORY, 'const fetchHistory = async')
        const solanaBranch = fn.slice(fn.indexOf("chainVm(network.currentNetwork) === 'solana'"))
        expect(solanaBranch).toMatch(/catch\s*\(e\)\s*\{[\s\S]*historyError\.value\s*=\s*'fetch'/)
        expect(solanaBranch).toMatch(/finally\s*\{[\s\S]*loading\.value\s*=\s*false/)
    })
})

describe('History.vue — render-guvenligi: modal getIcon coken cagriyi BIR DAHA yapmaz', () => {
    // KOK NEDEN: modal `getIcon(selectedTx.category)` cagiriyordu. Solana
    // satirlarinda `category` HIC YOK; `getIcon(undefined)` gecince fonksiyonun
    // ilk satiri (`tx.receipt_status`) RENDER ANINDA TypeError firlatiyordu —
    // ekran hic acilmadan cokuyordu. Bu blok, coken cagrinin GERI GELMEDIGINI kilitler.
    it('modal getIcon(selectedTx) ile cagirir, getIcon(selectedTx.category) ile DEGIL', () => {
        expect(TEMPLATE).toMatch(/:is="getIcon\(selectedTx\)"/)
        expect(TEMPLATE).not.toMatch(/getIcon\(selectedTx\.category\)/)
    })

    it('getIcon bos/tanimsiz girdide de firlatmaz (savunma satiri var)', () => {
        const fn = block(HISTORY, 'const getIcon = (tx) =>')
        expect(fn).toMatch(/if\s*\(!tx\)\s*return/)
    })
})

describe('History.vue — gorunum yardimcilari Solana satirini AYRISTIRIR (EVM sozlesmesini bozmadan)', () => {
    for (const fnName of ['getShortTitle', 'getStatusColor', 'getIcon', 'getListAmountColor', 'getListAmount', 'getMainAmount']) {
        it(`${fnName} isSolanaHistoryRow ile dallanir`, () => {
            const fn = block(HISTORY, `const ${fnName} = (tx`)
            expect(fn, fnName).toMatch(/isSolanaHistoryRow\(tx\)/)
        })
    }

    // KOK NEDEN: sablonun `receipt_status === '1'` kontrolu Solana satirinda
    // (bu alan hic yok) hep false doner, varsayilan dal HER basarili Solana
    // islemini "Basarisiz" (kirmizi) gosterirdi. historyStatusKind bunu TEK
    // yerden dogru siniflandirir.
    it('liste satirinin durum metni historyStatusKind uzerinden gelir, ciplak receipt_status DEGIL', () => {
        expect(HISTORY).toMatch(/historyStatusKind\(tx\)\s*===\s*'pending'/)
        expect(HISTORY).toMatch(/historyStatusKind\(tx\)\s*===\s*'confirmed'/)
    })
})

describe('History.vue — modal Solana da anlamsiz alanlari GOSTERMEZ', () => {
    // KOK NEDEN: Solana satirlarinda `nonce` hic yok; eski sablon kosulsuzca
    // `#{{ selectedTx.nonce }}` basiyordu ve Solana'da "#undefined" gorunuyordu.
    it('Nonce hucresi Solana satirinda GIZLENIR (v-if ile)', () => {
        expect(TEMPLATE).toMatch(/v-if="!isSolanaHistoryRow\(selectedTx\)"[\s\S]{0,400}Nonce/)
    })

    // KOK NEDEN: Solana satirlarinda islem ucreti yok; eski sablon "Hesaplaniyor..."
    // yazisini SONSUZA DEK gosterirdi (asla gelmeyecek bir deger bekleniyormus
    // izlenimi verir).
    it('Fee hucresi Solana da "Hesaplaniyor..." yerine ayri bir dal gosterir', () => {
        const idx = TEMPLATE.indexOf('history.details.txFee')
        const cellEnd = TEMPLATE.indexOf('</div>', idx)
        const cell = TEMPLATE.slice(idx, cellEnd)
        expect(cell).toMatch(/v-else-if="isSolanaHistoryRow\(selectedTx\)"/)
    })
})

// KOD INCELEMESI (review round 1, Bulgu 4): bu iki describe blogu (base58
// kucultme + Number(chainId)) BURADA DAHA ONCE `.not.toMatch(/xxx\.toLowerCase\(\)/)`
// / `.not.toMatch(/Number\(...\)/)` seklinde kaynak-tarama olarak vardi.
// Reviewer'in kanitladigi gibi ikisi de YENIDEN ADLANDIRMAYLA (rename) TRIVIAL
// olarak yenilirdi: `getExplorerUrl = (hash) => explorerTxUrl(chainId,
// hash?.toLowerCase())` dort `.toLowerCase()` kontrolunun TUMUNU gecerdi
// (aranan degiskenler `solanaAddress`/`counterparty`/`tx.hash` degil `hash`
// parametresiydi); `Number(chainId)` da baska bir degiskene atanip
// yeniden yazilarak gorunmez kilinabilirdi. "Bir yeniden adlandirmayla
// yenilen kilit, korumadan beter, cunku koruma gibi OKUNUR." Ikisi de
// History.ssr.test.js'teki GERCEK render testleriyle DEGISTIRILDI:
// "base58 imza/adres modalde KUCULTULMEDEN gorunur" (RENDER EDILMIS HTML'deki
// GERCEK href/metin, hangi degiskenin kucultuldugunden BAGIMSIZ olarak
// kontrol edilir) ve "EVM/Solana yol ayrimi GERCEK render ile" (GERCEK
// 'solana-mainnet' metin chainId'siyle calisir, Number() donusumune
// DAYANMADIGINI kanitlar).
