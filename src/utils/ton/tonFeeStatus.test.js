import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Adres artik atsConfig'ten geliyor (bkz. tonFeeConfig.tonFeePaymasterBase).
// Buradaki sahte deger URL'in SEKLINI (yol + sorgu) olcmek icin; gercek
// host tonFeeConfig.test.js'te olculen degere kilitli.
vi.mock('./tonFeeConfig', async (importActual) => ({
    ...(await importActual()),
    tonFeePaymasterBase: () => 'http://bundler.test',
}))

import { readTonFeeStatus, tonFeeRelayActive, _setTonFeeStatusCache } from './tonFeeStatus'
import { TonFeeError } from './tonFeeClient'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8')

// Olculen /status govdesinin TON parcasi (design 2026-08-29, bolum 2.1).
// solana/budget bu gorevin ilgilenmedigi alanlar - govde OLDUGU GIBI tasinir.
const TON_STATUS = {
    ton: {
        enabled: true, chainId: 607, wallet: 'W5',
        relayer: 'EQD4joKxbphnt0bFfsaCb-KyJaydnMiLTTltGfrQB0mjzgJ2',
        tankNanoton: '18956940084', rateFresh: true, rateFeed: '0xfaAB000000000000000000000000000000000000',
    },
    solana: { enabled: false },
    budget: { minChargeAts: '0', commissionAts: '0', commissionTreasury: '0x0' },
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

beforeEach(() => {
    _setTonFeeStatusCache()
    globalThis.fetch = vi.fn()
})

describe('readTonFeeStatus', () => {
    it('.ton blogunu doner', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, TON_STATUS))
        const status = await readTonFeeStatus({ sender: '0xA1' })
        expect(status.ton).toEqual(TON_STATUS.ton)
    })

    it('30sn icinde IKINCI cagri fetch ETMEZ', async () => {
        fetch.mockResolvedValue(jsonResponse(200, TON_STATUS))
        await readTonFeeStatus({ sender: '0xA1' })
        await readTonFeeStatus({ sender: '0xA1' })
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('force cache i atlar', async () => {
        fetch.mockResolvedValue(jsonResponse(200, TON_STATUS))
        await readTonFeeStatus({ sender: '0xA1' })
        await readTonFeeStatus({ sender: '0xA1', force: true })
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('farkli sender AYRI cache', async () => {
        fetch.mockResolvedValue(jsonResponse(200, TON_STATUS))
        await readTonFeeStatus({ sender: '0xA1' })
        await readTonFeeStatus({ sender: '0xB2' })
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('sender yoksa FIRLATIR, istek gondermez', async () => {
        await expect(readTonFeeStatus({})).rejects.toThrow()
        expect(fetch).not.toHaveBeenCalled()
    })

    it('ag hatasinda cache i BOZMAZ', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, TON_STATUS))
        const first = await readTonFeeStatus({ sender: '0xA1' })

        fetch.mockRejectedValueOnce(new TypeError('failed to fetch'))
        await expect(readTonFeeStatus({ sender: '0xA1', force: true })).rejects.toBeInstanceOf(TonFeeError)

        // TTL hala gecerli (force verilmedi) -> onceki deger DEGISMEDEN doner,
        // ucuncu bir fetch cagrisi olmaz.
        const again = await readTonFeeStatus({ sender: '0xA1' })
        expect(again).toEqual(first)
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    // ESKI HALI BUNU KACIRIYORDU: `.rejects.toThrow()` sarmalayici olsa da
    // olmasa da GECER (TonFeeError da bir Error'dur). tonFeeClient.js'in
    // POST'lari ile AYNI tipi/alanlari olcmek gerekiyor - cagiran taraf
    // (Task 6'nin relayer'i, Task 8'in composable'i) `phase`/`code` alanlarina
    // gore karar veriyor; ham bir TypeError bu alanlari tasimaz ve
    // resolveTonFeeBlocker'a hic ulasamaz.
    it('ag hatasi (fetch reddi) TonFeeError a sarilir, phase "status", ham TypeError sizmaz', async () => {
        fetch.mockRejectedValueOnce(new TypeError('failed to fetch'))
        await expect(readTonFeeStatus({ sender: '0xC3' })).rejects.toBeInstanceOf(TonFeeError)

        fetch.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const err = await readTonFeeStatus({ sender: '0xC3' }).catch((e) => e)
        expect(err.phase).toBe('status')
        expect(err).not.toBeInstanceOf(TypeError)
    })

    // tonFeeClient.js'teki POST'larla SIMETRIK: 2xx disi bir HTTP yaniti da
    // (ornegin backend'in onundeki CDN'den 500) siniflandirilabilir olmali -
    // bare Error'da httpStatus/phase olmadigi icin resolveTonFeeBlocker
    // yalniz kodsuz-varsayilan dala bile dusemez.
    it('2xx disi HTTP yaniti da TonFeeError a sarilir', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(500, { error: 'sunucu hatasi' }))
        const err = await readTonFeeStatus({ sender: '0xD4' }).catch((e) => e)
        expect(err).toBeInstanceOf(TonFeeError)
        expect(err.phase).toBe('status')
        expect(err.httpStatus).toBe(500)
    })
})

describe('tonFeeRelayActive', () => {
    it.each([
        [{ enabled: true, rateFresh: true, wallet: 'W5' }, true],
        [{ enabled: false, rateFresh: true, wallet: 'W5' }, false],
        [{ enabled: true, rateFresh: false, wallet: 'W5' }, false],
        [{ enabled: true, rateFresh: true, wallet: 'W6' }, false],
    ])('%o -> %s', (ton, expected) => {
        expect(tonFeeRelayActive({ ton })).toBe(expected)
    })

    // Blok hic yoksa KAPALI kabul edilir - eksik veriyi "acik" saymak, sunucu
    // TON'u kaldirdiginda cuzdanin calismayan bir secenek gostermesi demektir.
    it.each([[undefined], [null], [{}]])('ton blogu %o ise false', (ton) => {
        expect(tonFeeRelayActive({ ton })).toBe(false)
    })
})

describe('607 istemcide SABIT YAZILMAZ', () => {
    // Sunucunun TON chainId'si 607, istemcininki -239. Ikisini istemcide
    // eslestirmek, sunucu numarayi degistirdiginde sessizce yanlis bolgeyi acar.
    it('kaynak metinde 607 gecmez', () => {
        expect(read('./tonFeeStatus.js')).not.toMatch(/\b607\b/)
    })
})
