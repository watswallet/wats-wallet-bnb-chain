// T12: bStocks BIRIM SINIRI (spec 8). Ekran/motor tutari UI birimi dizesi olarak tasir; ham birime cevrim
// YALNIZ mevcut swap.js / arka plan yolundadir. Bu test o siniri kilitler.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BSTOCKS } from '../../data/bStocks'
import { BSTOCK_MULTIPLIER_ERROR } from '../bstocksSpend'
import { ENGINE_ERROR } from './engines/errors'
import { createPancakeEngine } from './engines/pancakeEngine'

const STOCK = BSTOCKS[0].address
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const INDEX = "m/44'/60'/0'/0/0"
const ATS_QUOTED = { transferFee: 0.4, commissionFee: 0.1 }
const DATA = { expectedOutput: '0.500000000000000001', minimumReceived: '0.49', priceImpact: '0.30%', liquidityProviderFee: '0.25%' }

let sent
function install(replies) {
  sent = []
  globalThis.chrome = {
    runtime: {
      sendMessage: vi.fn(async (m) => {
        sent.push(m)
        const r = replies[m.type]
        return typeof r === 'function' ? r() : r
      }),
    },
    storage: { local: { get: vi.fn(async () => ({ active_account: { type: 'derived', derivationPath: INDEX }, swap_slippage: 1 })) } },
  }
}
afterEach(() => {
  delete globalThis.chrome
  vi.restoreAllMocks()
})

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const read = (f) => stripComments(readFileSync(new URL(f, import.meta.url), 'utf8'))

describe('tutar UI dizesi AYNEN mesaja gider (cevrim yok)', () => {
  it.each(['1', '100', '0.123456789012345678', '1000.5', '0.00000001'])('Al %s', async (amount) => {
    install({ SWAP_QUOTE: { success: true, data: DATA }, SWAP: { success: true, hash: '0xh' } })
    const eng = createPancakeEngine()
    const req = eng.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: STOCK, payToken: USDT, amount })
    expect(req.amount).toBe(amount)
    const q = await eng.quote(req)
    expect(q.success).toBe(true)
    await eng.place({ quote: q, request: q.request, atsQuoted: ATS_QUOTED, accountIndex: INDEX })
    const quoteMsg = sent.find((m) => m.type === 'SWAP_QUOTE').message
    const swapMsg = sent.find((m) => m.type === 'SWAP').message
    expect(quoteMsg.amount).toBe(amount)
    expect(swapMsg.amount).toBe(amount)
    expect(typeof quoteMsg.amount).toBe('string')
    expect(typeof swapMsg.amount).toBe('string')
  })
  it('Sat: adet (UI) AYNEN gider', async () => {
    install({ SWAP_QUOTE: { success: true, data: { expectedOutput: '123.4', minimumReceived: '122', priceImpact: '0.1%' } }, SWAP: { success: true, hash: '0xh' } })
    const eng = createPancakeEngine()
    const q = await eng.quote(eng.buildQuoteMessage({ side: 'sell', chainId: 56, stockAddress: STOCK, payToken: USDT, amount: '0.5' }))
    await eng.place({ quote: q, request: q.request, atsQuoted: ATS_QUOTED, accountIndex: INDEX })
    expect(sent.find((m) => m.type === 'SWAP_QUOTE').message.amount).toBe('0.5')
    expect(sent.find((m) => m.type === 'SWAP').message.amount).toBe('0.5')
  })
})

describe('display UI-atom degerleri hicbir mesaja geri gonderilmez', () => {
  it('SWAP_QUOTE ve SWAP mesajlarinda atom/ display YOK', async () => {
    install({ SWAP_QUOTE: { success: true, data: DATA }, SWAP: { success: true, hash: '0xh' } })
    const eng = createPancakeEngine()
    const q = await eng.quote(eng.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: STOCK, payToken: USDT, amount: '100' }))
    // ekranin display'ini mesaja koymaya calisan bir cagri: place yalniz kayitli istegi yollar
    await eng.place({ quote: { ...q, extra: q.display }, request: { ...q.request, display: q.display }, atsQuoted: ATS_QUOTED, accountIndex: INDEX })
    const wire = JSON.stringify(sent)
    for (const atom of [q.display.sellAmount, q.display.expectedBuy, q.display.minBuy]) expect(wire).not.toContain(atom)
    expect(wire).not.toContain('display')
    expect(wire).not.toContain('unitPrice')
  })
})

describe('carpan okunamazsa FAIL-CLOSED', () => {
  it('SWAP_QUOTE carpan hatasi -> MULTIPLIER_UNREADABLE, teklif yok, SWAP yok', async () => {
    install({ SWAP_QUOTE: { error: `getExpectedOutput error: ${BSTOCK_MULTIPLIER_ERROR}: ${STOCK} (rpc)` }, SWAP: { success: true, hash: '0xh' } })
    const eng = createPancakeEngine()
    const q = await eng.quote(eng.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: STOCK, payToken: USDT, amount: '100' }))
    expect(q).toEqual({ success: false, code: ENGINE_ERROR.MULTIPLIER_UNREADABLE })
    const r = await eng.place({ quote: { quoteId: 'ps_1' }, atsQuoted: ATS_QUOTED, accountIndex: INDEX })
    expect(r.ok).toBe(false)
    expect(sent.some((m) => m.type === 'SWAP')).toBe(false)
  })
  it('SWAP aninda carpan hatasi -> MULTIPLIER_UNREADABLE (ekran "carpan okunamadi" der; imza/tx yok)', async () => {
    install({ SWAP_QUOTE: { success: true, data: DATA }, SWAP: { error: `${BSTOCK_MULTIPLIER_ERROR}: ${STOCK} (uiMultiplier=0)` } })
    const eng = createPancakeEngine()
    const q = await eng.quote(eng.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: STOCK, payToken: USDT, amount: '100' }))
    const r = await eng.place({ quote: q, request: q.request, atsQuoted: ATS_QUOTED, accountIndex: INDEX })
    expect(r).toEqual({ ok: false, code: ENGINE_ERROR.MULTIPLIER_UNREADABLE })
  })
})

describe('kaynak taramasi (yorumsuz): ekran/motor ham birime cevirmez', () => {
  const FORBIDDEN = /toRawSpendAmount|uiMultiplier|readUiMultiplier|1e18|applyUiMultiplier|rawFromUiAmount/
  it.each(['./engines/pancakeEngine.js', './engines/pancakeQuote.js'])('%s yasak desen icermez', (file) => {
    expect(read(file)).not.toMatch(FORBIDDEN)
  })
  it('pancakeEngine bstocksSpend\'ten yalniz hata sabitini import eder; swap.js import etmez', () => {
    const src = read('./engines/pancakeEngine.js')
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']*)'/g)]
    const spend = imports.filter(([, , from]) => from.endsWith('bstocksSpend'))
    expect(spend).toHaveLength(1)
    expect(spend[0][1].trim()).toBe('BSTOCK_MULTIPLIER_ERROR')
    expect(imports.some(([, , from]) => /(^|\/)swap$/.test(from))).toBe(false)
    expect(src).not.toMatch(/ethers|formatUnits|parseUnits|BigInt\(/)
  })
  it('pancakeEngine yeni arka plan mesaji uydurmaz: yalniz SWAP_QUOTE ve SWAP', () => {
    const src = read('./engines/pancakeEngine.js')
    const types = [...src.matchAll(/type:\s*'([A-Z_]+)'/g)].map((m) => m[1])
    expect([...new Set(types)].sort()).toEqual(['SWAP', 'SWAP_QUOTE'])
  })
})
