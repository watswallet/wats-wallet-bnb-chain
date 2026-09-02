import { describe, it, expect, beforeEach, vi } from 'vitest'
import axios from 'axios'
import { CLEAN_REPUTATION, normalizeReputation, fetchReputation } from './addressReputation'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))

const API = 'https://api.test'
const ADDR = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'

beforeEach(() => { axios.post.mockReset() })

describe('normalizeReputation', () => {
    it('gecerli engel cevabini oldugu gibi gecirir', () => {
        expect(normalizeReputation({
            severity: 'block', flags: ['stealing_attack'], sources: ['SlowMist']
        })).toEqual({ severity: 'block', flags: ['stealing_attack'], sources: ['SlowMist'] })
    })

    it('gecerli uyari cevabini gecirir', () => {
        expect(normalizeReputation({ severity: 'warn', flags: ['mixer'], sources: [] }).severity).toBe('warn')
    })

    it('TANIMADIGIMIZ severity degeri temiz sayilir', () => {
        // Fail-open: sunucu ileride 'critical' gibi bir deger dondurse bile istemci
        // bilmedigi bir degeri "engelle" diye yorumlamamali.
        expect(normalizeReputation({ severity: 'critical', flags: ['x'] })).toEqual(CLEAN_REPUTATION)
    })

    it('bos/bozuk govde temizdir', () => {
        expect(normalizeReputation(null)).toEqual(CLEAN_REPUTATION)
        expect(normalizeReputation(undefined)).toEqual(CLEAN_REPUTATION)
        expect(normalizeReputation('coplu')).toEqual(CLEAN_REPUTATION)
        expect(normalizeReputation({})).toEqual(CLEAN_REPUTATION)
    })

    it('flags/sources dizi degilse bos diziye duser', () => {
        const r = normalizeReputation({ severity: 'warn', flags: 'mixer', sources: 7 })
        expect(r.flags).toEqual([])
        expect(r.sources).toEqual([])
    })

    it('dizi icindeki string olmayan girdiler atilir', () => {
        const r = normalizeReputation({ severity: 'warn', flags: ['mixer', null, 3], sources: ['SlowMist', {}] })
        expect(r.flags).toEqual(['mixer'])
        expect(r.sources).toEqual(['SlowMist'])
    })
})

describe('fetchReputation', () => {
    it('sunucunun kararini doner', async () => {
        axios.post.mockResolvedValue({ data: { success: true, reputation: { severity: 'block', flags: ['sanctioned'], sources: [] } } })

        const r = await fetchReputation(API, ADDR)

        expect(r.severity).toBe('block')
        expect(axios.post).toHaveBeenCalledWith(`${API}/wallet/reputation`, { address: ADDR }, expect.anything())
    })

    // Asagidaki dort test ozelligin can damari: itibar servisi HER TURLU bozuldugunda
    // kullanici para gonderebilmeye devam etmeli. Ucuncu taraf bir servisin cuzdani
    // kilitlemesi, engellemeye calistigimiz zarardan daha buyuk bir zarardir.
    it('sunucu hata dondurse de temiz doner (fail-open)', async () => {
        axios.post.mockRejectedValue(new Error('Request failed with status code 502'))
        expect(await fetchReputation(API, ADDR)).toEqual(CLEAN_REPUTATION)
    })

    it('ag hatasinda temiz doner', async () => {
        axios.post.mockRejectedValue(new Error('Network Error'))
        expect(await fetchReputation(API, ADDR)).toEqual(CLEAN_REPUTATION)
    })

    it('govde beklenmedikse temiz doner', async () => {
        axios.post.mockResolvedValue({ data: { success: true } })
        expect(await fetchReputation(API, ADDR)).toEqual(CLEAN_REPUTATION)
    })

    it('success:false ise temiz doner', async () => {
        axios.post.mockResolvedValue({ data: { success: false, reputation: { severity: 'block' } } })
        expect(await fetchReputation(API, ADDR)).toEqual(CLEAN_REPUTATION)
    })

    it('gecersiz adres icin AG CAGRISI YAPMAZ', async () => {
        expect(await fetchReputation(API, '0x123')).toEqual(CLEAN_REPUTATION)
        expect(await fetchReputation(API, null)).toEqual(CLEAN_REPUTATION)
        expect(axios.post).not.toHaveBeenCalled()
    })

    it('api adresi yoksa cagri yapmaz', async () => {
        expect(await fetchReputation('', ADDR)).toEqual(CLEAN_REPUTATION)
        expect(axios.post).not.toHaveBeenCalled()
    })

    // Saglayici (GoPlus) Solana'yi desteklemiyor (server/controllers/reputationController.js
    // ADDRESS_RE'si de yalnizca 0x-hex kabul ediyor, base58 gonderilse 400 doner). Bunu
    // sessizce "temiz" saymak OLMAYAN bir guvence verirdi; bu yuzden agsa hic gidilmez ve
    // `unsupported: true` ile isaretlenir.
    describe('Solana (base58) adresi — saglayici desteklemiyor', () => {
        const SOLANA_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

        it('AG CAGRISI YAPMADAN unsupported:true doner', async () => {
            const r = await fetchReputation(API, SOLANA_ADDR)
            expect(r).toEqual({ ...CLEAN_REPUTATION, unsupported: true })
            expect(axios.post).not.toHaveBeenCalled()
        })

        it('severity hala null: unsupported gonderimi ENGELLEMEZ, yalnizca bilgilendirir', async () => {
            const r = await fetchReputation(API, SOLANA_ADDR)
            expect(r.severity).toBe(null)
        })
    })
})
