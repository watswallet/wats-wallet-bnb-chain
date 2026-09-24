// Blockhash tazeligi -- YALNIZCA signAndSendTransaction'a uygulanir (§6.5).
//
// Iki kural bu dosyada kilitlenir ve ikisi de "sessizce yanlis" olmaya cok
// musait:
//   1) DURABLE NONCE: ilk talimat AdvanceNonceAccount ise blockhash alani bir
//      NONCE degeridir ve isBlockhashValid onu HER ZAMAN gecersiz raporlar --
//      kontrol yapilirsa her durable-nonce islemi reddedilir.
//   2) FAIL-OPEN (§11): sunucu (VPS) ile uzanti (magaza incelemesi) FARKLI
//      kadanslarda yayinlanir. isBlockhashValid henuz beyaz listede degilse
//      proxy 403 doner (solanaController.js:78-81; 404/405 yalnizca rota
//      TAMAMEN eksikse); o durumda kontrol ATLANIR ve ASLA
//      SOLANA_BLOCKHASH_EXPIRED uretilmez -- aksi halde sunucu deploy edilene
//      kadar HER dapp islemi reddedilirdi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const solanaRpc = vi.fn()
vi.mock('./client', () => ({ solanaRpc: (...a) => solanaRpc(...a), SOLANA_API_BASE: 'https://api.test' }))

import { checkBlockhashFresh, transactionBlockhash } from './blockhashFreshness'

const HASH = 'GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W'

// parseDappTransaction'in DIS yuzeyi taklit edilir: bu modul islemin ICINE
// bakmaz, yalnizca iki alanini okur. Gercek bir Transaction kurmak testi
// @solana/web3.js'in serilestirme davranisina bagimli kilardi.
const legacy = (extra = {}) => ({ version: 'legacy', tx: { recentBlockhash: HASH }, isDurableNonce: false, ...extra })
const v0 = (extra = {}) => ({ version: 0, tx: { message: { recentBlockhash: HASH } }, isDurableNonce: false, ...extra })

beforeEach(() => {
    // resetAllMocks (SADECE clearAllMocks DEGIL): clearAllMocks cagri
    // GECMISINI temizler ama mockResolvedValue/mockRejectedValue ile kurulmus
    // UYGULAMAYI KORUR. Durable-nonce testi bu yuzden bir onceki testin
    // birakip gittigi degeri sessizce devralabiliyordu -- her test kendi
    // RPC davranisini ACIKCA kurmali, bir oncekinden MIRAS almamali.
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('transactionBlockhash', () => {
    it('legacy islemde recentBlockhash dogrudan okunur', () => {
        expect(transactionBlockhash(legacy())).toBe(HASH)
    })

    it('v0 islemde blockhash message ICINDEDIR', () => {
        expect(transactionBlockhash(v0())).toBe(HASH)
    })

    it('alan yoksa null doner, patlamaz', () => {
        expect(transactionBlockhash(null)).toBeNull()
        expect(transactionBlockhash({ version: 'legacy', tx: {} })).toBeNull()
    })
})

describe('checkBlockhashFresh', () => {
    it('gecerli blockhash: taze doner ve RPC confirmed commitment ile sorgulanir', async () => {
        solanaRpc.mockResolvedValue({ value: true })

        const sonuc = await checkBlockhashFresh(legacy())

        expect(sonuc).toEqual({ fresh: true, skipped: null })
        expect(solanaRpc).toHaveBeenCalledWith('isBlockhashValid', [HASH, { commitment: 'confirmed' }])
    })

    it('gecersiz blockhash: SOLANA_BLOCKHASH_EXPIRED', async () => {
        solanaRpc.mockResolvedValue({ value: false })

        expect(await checkBlockhashFresh(v0())).toEqual({ fresh: false, code: 'SOLANA_BLOCKHASH_EXPIRED' })
    })

    // Durable nonce'ta blockhash alani bir NONCE'tir; isBlockhashValid onu HER
    // ZAMAN gecersiz raporlar. RPC'ye HIC gidilmemeli.
    it('durable nonce: RPC HIC cagrilmaz, kontrol atlanir', async () => {
        const sonuc = await checkBlockhashFresh(legacy({ isDurableNonce: true }))

        expect(sonuc).toEqual({ fresh: true, skipped: 'durable_nonce' })
        expect(solanaRpc).not.toHaveBeenCalled()
    })

    // §11 FAIL-OPEN: sunucu beyaz listesi henuz deploy edilmemis.
    // 403 ASIL goruleni: solanaController.js:78-81 beyaz liste reddini HER ZAMAN
    // 403 ile doner. 404/405 yalnizca /solana/rpc rotasinin TAMAMEN eksik oldugu
    // (ve zaten butun Solana cagrilarinin bozuk oldugu) senaryoda erisilir.
    it.each([['403', 'SOLANA_RPC_HTTP_403'], ['404', 'SOLANA_RPC_HTTP_404'], ['405', 'SOLANA_RPC_HTTP_405']])(
        'proxy %s: kontrol atlanir, ASLA SOLANA_BLOCKHASH_EXPIRED uretilmez',
        async (_ad, kod) => {
            solanaRpc.mockRejectedValue(new Error(kod))

            const sonuc = await checkBlockhashFresh(legacy())

            expect(sonuc).toEqual({ fresh: true, skipped: 'proxy_unsupported' })
            expect(sonuc.code).toBeUndefined()
        })

    // Zaman asimi/5xx de KONTROLU ATLATIR: "sorgulayamadim" ile "bayat" AYNI
    // sey degildir. Gercekten bayat bir blockhash'i yayin preflight'i zaten
    // reddeder (send.js skipPreflight:false); bir RPC hickirigi yuzunden mesru
    // bir dapp islemini reddetmek ise geri donusu olmayan bir kayiptir.
    it.each([['zaman asimi', 'SOLANA_RPC_TIMEOUT'], ['proxy 502', 'SOLANA_RPC_HTTP_502']])(
        '%s: kontrol atlanir, hata YUKARI FIRLATILMAZ',
        async (_ad, kod) => {
            solanaRpc.mockRejectedValue(new Error(kod))

            expect(await checkBlockhashFresh(v0())).toEqual({ fresh: true, skipped: 'rpc_unavailable' })
        })

    // Beyaz listede olmayan bir metot proxy'den 200 + null olarak da donebilir.
    // typeof kontrolu olmadan `value` undefined -> falsy -> BAYAT sanilirdi.
    it('boolean OLMAYAN yanit: kontrol atlanir, bayat SAYILMAZ', async () => {
        solanaRpc.mockResolvedValue({ value: null })

        expect(await checkBlockhashFresh(legacy())).toEqual({ fresh: true, skipped: 'unreadable_response' })
    })

    it('blockhash okunamiyorsa RPC cagrilmaz ve kontrol atlanir', async () => {
        const sonuc = await checkBlockhashFresh({ version: 'legacy', tx: {}, isDurableNonce: false })

        expect(sonuc).toEqual({ fresh: true, skipped: 'no_blockhash' })
        expect(solanaRpc).not.toHaveBeenCalled()
    })
})
