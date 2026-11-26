// SOLANA AG CIKIS SAVUNMASI (birlesme hazirligi B4). Istemcide Solana'ya giden her ag cikis noktasi SOLANA_ENABLED
// kapaliyken fetch ATMAZ: kapali derlemede ileride korumasiz yeni bir cagiran yazilsa bile istek cikmaz (magaza sizintisi
// sinifini kokten kapatir; patron karari 2026-11-17). Bayrak acik derlemenin davranisi DEGISMEZ (KONTROL vakalari).
//
// Cikis noktalari ve kapali davranis secimi:
//   - solanaRpc (client.js)          -> tipli hata SOLANA_DISABLED (RPC icin uydurulabilecek "bos" bir sonuc yok; cagiranlarin
//                                       hepsi zaten ag hatasini isliyor; belirsiz yayin SAYILMAZ).
//   - fetchSolanaHistory (history.js) -> [] (cagiranlarin "gecmis yok" sonucu; hata bandi uretmez).
//   - fetchTokenMetadata (tokenMetadata.js) -> bos harita, complete:true (bos girdi ile ayni sozlesme).
//   - useSolanaAssets (Home/SelectAssets'in tek Solana kaynagi) -> [] ve okuma bayragi YOK: alt katmandaki SOLANA_DISABLED
//     hatasi solFailed/splFailed'a donusup ekranda hata bandi uretmesin.
// Envanter kilidi: istemci kaynaginda /solana/* adresine giden fetch yalniz bu uc dosyadadir; yeni bir cikis noktasi
// eklenirse kirmizi olur ve bu dosyaya bayrak savunmasiyla birlikte eklenmesi gerekir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, saltKod } from '../../test-utils/kaynakTarama'

// SOLANA_ENABLED moduller ISLEM ANINDA okur; bayrak-kapali vaka bu sahte ile uretilir (varsayilan ACIK).
const flags = vi.hoisted(() => ({ solana: true }))
vi.mock('../featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get SOLANA_ENABLED() { return flags.solana } }
})

import { solanaRpc, SOLANA_API_BASE, SOLANA_DISABLED } from './client'
import { fetchSolanaHistory } from './history'
import { fetchTokenMetadata } from './tokenMetadata'
import { useSolanaAssets } from '../../composables/useSolanaAssets'

const ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

let fetchMock
beforeEach(() => {
    flags.solana = true
    fetchMock = vi.fn(async (url) => {
        if (String(url).endsWith('/solana/rpc')) return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { value: 0 } }) }
        if (String(url).endsWith('/solana/history')) return { ok: true, status: 200, json: async () => ({ success: true, history: [{ signature: 's1' }] }) }
        return { ok: true, status: 200, json: async () => ({ success: true, tokens: [{ mint: MINT, symbol: 'USDC' }] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('solanaRpc (client.js)', () => {
    it('bayrak KAPALI: fetch ATILMAZ, tipli SOLANA_DISABLED hatasi firlatir', async () => {
        flags.solana = false
        const hata = await solanaRpc('getBalance', [ADDR]).then(() => null, (e) => e)
        expect(hata).toBeInstanceOf(Error)
        expect(hata.message).toBe(SOLANA_DISABLED)
        expect(hata.code).toBe(SOLANA_DISABLED)
        expect(SOLANA_DISABLED).toBe('SOLANA_DISABLED')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('KONTROL: bayrak ACIK: /solana/rpc istegi atilir, sonuc doner', async () => {
        await expect(solanaRpc('getBalance', [ADDR])).resolves.toEqual({ value: 0 })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0]).toBe(`${SOLANA_API_BASE}/solana/rpc`)
    })
})

describe('fetchSolanaHistory (history.js)', () => {
    it('bayrak KAPALI: fetch ATILMAZ, bos liste doner (hata yok)', async () => {
        flags.solana = false
        await expect(fetchSolanaHistory(ADDR)).resolves.toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('KONTROL: bayrak ACIK: /solana/history istegi atilir', async () => {
        await expect(fetchSolanaHistory(ADDR)).resolves.toEqual([{ signature: 's1' }])
        expect(fetchMock.mock.calls[0][0]).toBe(`${SOLANA_API_BASE}/solana/history`)
    })
})

describe('fetchTokenMetadata (tokenMetadata.js)', () => {
    it('bayrak KAPALI: fetch ATILMAZ, bos harita (complete:true) doner', async () => {
        flags.solana = false
        const map = await fetchTokenMetadata([MINT])
        expect(map).toEqual(new Map())
        expect(map.complete).toBe(true)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('KONTROL: bayrak ACIK: /solana/tokens istegi atilir', async () => {
        const map = await fetchTokenMetadata([MINT])
        expect(map.get(MINT)).toMatchObject({ symbol: 'USDC' })
        expect(fetchMock.mock.calls[0][0]).toBe(`${SOLANA_API_BASE}/solana/tokens`)
    })
})

describe('useSolanaAssets (Home / SelectAssets Solana kaynagi)', () => {
    it('bayrak KAPALI: hicbir Solana istegi atilmaz, bos liste doner ve hata bandi bayragi YOK', async () => {
        flags.solana = false
        const rows = await useSolanaAssets(ADDR)
        expect(rows).toEqual([])
        expect(rows.splFailed).not.toBe(true)
        expect(rows.solFailed).not.toBe(true)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(console.error).not.toHaveBeenCalled()
    })

    it('KONTROL: bayrak ACIK: bakiye icin /solana/rpc istekleri atilir ve SOL satiri doner', async () => {
        const rows = await useSolanaAssets(ADDR)
        expect(fetchMock.mock.calls.map(([u]) => u)).toContain(`${SOLANA_API_BASE}/solana/rpc`)
        expect(rows.some((r) => r.symbol === 'SOL')).toBe(true)
    })
})

// ---------------------------------------------------------------------------------------------------------------------
// ENVANTER KILIDI
// ---------------------------------------------------------------------------------------------------------------------
const SRC = fileURLToPath(new URL('../../', import.meta.url))
function kaynakDosyalari(dizin) {
    const out = []
    for (const ad of readdirSync(dizin)) {
        const yol = join(dizin, ad)
        if (statSync(yol).isDirectory()) {
            if (ad === 'test-utils' || ad === 'node_modules') continue
            out.push(...kaynakDosyalari(yol))
        } else if (/\.(js|vue)$/.test(ad) && !/\.test\.js$/.test(ad)) {
            out.push(yol)
        }
    }
    return out
}
const goreli = (yol) => relative(SRC, yol).split(sep).join('/')

describe('envanter: istemcide Solana ag cikis noktalari', () => {
    const dosyalar = kaynakDosyalari(SRC).map((yol) => {
        const ham = readFileSync(yol, 'utf8')
        return { yol: goreli(yol), kod: yorumsuz(ham), salt: saltKod(ham) }
    })
    const BEKLENEN = ['utils/solana/client.js', 'utils/solana/history.js', 'utils/solana/tokenMetadata.js']

    it('SOLANA_API_BASE ile adres kuran (fetch eden) dosyalar yalniz uc bilinen cikis noktasidir', () => {
        const kuranlar = dosyalar.filter((d) => /\$\{SOLANA_API_BASE\}/.test(d.kod)).map((d) => d.yol).sort()
        expect(kuranlar).toEqual(BEKLENEN)
    })

    it("'/solana/' yoluna giden baska bir istek yok (fetch / axios / dogrudan adres)", () => {
        const diger = dosyalar
            .filter((d) => !BEKLENEN.includes(d.yol))
            // import satirlari ('./solana/history' modul yolu) sayilmaz: yalniz kod icindeki adres metinleri.
            .filter((d) => /['"`][^'"`\n]*\/solana\/(rpc|history|tokens)\b/.test(d.salt))
            .map((d) => d.yol)
        expect(diger).toEqual([])
    })

    it('utils/solana altinda fetch yalniz bilinen cikis noktalarinda cagrilir', () => {
        const fetchEdenler = dosyalar
            .filter((d) => d.yol.startsWith('utils/solana/') && /\bfetch\s*\(/.test(d.kod))
            .map((d) => d.yol).sort()
        expect(fetchEdenler).toEqual(BEKLENEN)
    })

    it('her cikis noktasi SOLANA_ENABLED kapisini featureFlags tek kaynagindan import eder', () => {
        for (const yol of BEKLENEN) {
            const kod = dosyalar.find((d) => d.yol === yol).kod
            expect(kod, yol).toMatch(/import\s*\{[^}]*\bSOLANA_ENABLED\b[^}]*\}\s*from\s*['"]\.\.\/featureFlags['"]/)
        }
    })
})
