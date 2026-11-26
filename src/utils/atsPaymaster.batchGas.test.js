// Cok cagrili op'un callGasLimit'i (estimateBatchCallGas / buildAtsGasParams).
//
// CANLI BULGU 2026-11-20 (BSC, tx 0x8ea6c275...): token girdili LCX takasi [approve, swapSplit] op'u
// zincirde success=false indi ve ATS ucreti yandi. Cagrilar TEK TEK tahmin ediliyordu: izin henuz
// verilmemisken swapSplit tahmini revert etti (TransferFromFailed 0x90b8ec18) ve 200.000'lik sabit yedege
// dusuldu. callGasLimit 319.224 oldu; batch'in gercek ihtiyaci ~395.000 (EntryPoint'ten hesabin
// executeBatch'i olculdu). Kural:
//   - Hesap BIZIM delegemize 7702 ile bagliysa ve op birden cok cagriysa: batch, zincirde kosacagi
//     gibi (EntryPoint -> hesap.executeBatch) TEK tahminle olculur; icsel 21.000 dusulur.
//   - Bagli degilse (o agdaki ilk op) ya da bu olcum basarisizsa: eski cagri-cagri toplam. Durum
//     gecersiz kilma (state override) KULLANILMAZ: olculen RPC'lerin cogu onu sessizce yok sayiyor ve
//     tahmin gercegin cok altinda cikiyor (2026-11-20, 8 LCX aginin 6'sinda).
//   - Tahmin edilemeyen bir LCX router cagrisi 200.000 yerine LCX_SWAP_GAS_FALLBACK (1.000.000) alir.
import { describe, it, expect, vi } from 'vitest'
import { ethers } from 'ethers'
import {
  estimateBatchCallGas, buildAtsGasParams, EXECUTE_OVERHEAD_GAS, LCX_SWAP_GAS_FALLBACK,
  DEPENDENT_CALL_GAS_FALLBACK,
} from './atsPaymaster'
import { buildBatchCallData } from './sdk/gasless'
import { LCX_ROUTERS } from './lcx/routers'

const EP = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const DELEGATE = '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A'
const FROM = '0x80B0fa700545984aF65df8116ad329af7952E739'
const DELEGATED_CODE = '0xef0100' + DELEGATE.slice(2).toLowerCase()
const USD1 = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'
const ROUTER = LCX_ROUTERS[56]
const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const APPROVE = { to: USD1, value: 0n, data: ERC20.encodeFunctionData('approve', [ROUTER, 57556843655699489n]) }
const SWAP = { to: ROUTER, value: 0n, data: '0xfc54261d' + '00'.repeat(32) }
const OTHER = { to: '0x' + '9'.repeat(40), value: 0n, data: '0xabcdef' }

// estimateGas(tx): `byTarget` hedefe gore yanit (bigint ya da Error), batch (EntryPoint'ten) ayri.
function fakeProvider({ code = DELEGATED_CODE, codeThrows = false, batch = 395583n, byTarget = {} } = {}) {
  const calls = []
  return {
    calls,
    getCode: vi.fn(async () => { if (codeThrows) throw new Error('rpc'); return code }),
    estimateGas: vi.fn(async (tx) => {
      calls.push(tx)
      const r = tx.from && tx.from.toLowerCase() === EP.toLowerCase() ? batch : byTarget[String(tx.to).toLowerCase()]
      if (r instanceof Error) throw r
      if (r === undefined) throw new Error('beklenmeyen tahmin hedefi ' + tx.to)
      return r
    }),
    getBalance: async () => 1n,
    getTransactionCount: async () => 1,
    getFeeData: async () => ({ maxPriorityFeePerGas: 1n, gasPrice: 1n }),
    getBlock: async () => ({ baseFeePerGas: 1n }),
  }
}
const reverted = () => Object.assign(new Error('execution reverted'), { data: '0x90b8ec18' })
const perCall = (e) => e - 21000n + EXECUTE_OVERHEAD_GAS

describe('estimateBatchCallGas: bagli hesapta batch tek tahminle olculur', () => {
  it('canli vaka: [approve, LCX swap] -> EntryPoint ten executeBatch tahmini - 21.000', async () => {
    const p = fakeProvider({ byTarget: { [USD1.toLowerCase()]: 46000n, [ROUTER.toLowerCase()]: reverted() } })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: [APPROVE, SWAP], entryPoint: EP, delegate: DELEGATE })
    expect(g).toBe(395583n - 21000n)
    // TEK tahmin: EntryPoint -> hesap, veri = gonderilecek executeBatch'in AYNISI
    expect(p.calls).toEqual([{ from: EP, to: FROM, data: buildBatchCallData([APPROVE, SWAP]) }])
  })

  it('buildAtsGasParams uzerinden: callGasLimit gercek ihtiyacin (395.583) ustunde; eski yol 319.224 veriyordu', async () => {
    const p = fakeProvider({ byTarget: { [USD1.toLowerCase()]: 46000n, [ROUTER.toLowerCase()]: reverted() } })
    const { gas } = await buildAtsGasParams({
      provider: p, from: FROM, calls: [APPROVE, SWAP], crosschain: false, entryPoint: EP, delegate: DELEGATE,
    })
    expect(gas.callGasLimit).toBeGreaterThan(395583n)
    // %25 marj yukari yuvarlanir (withMargin)
    expect(gas.callGasLimit).toBe(((395583n - 21000n) * 125n + 99n) / 100n)
  })

  it('delege adresi harf duyarsiz karsilastirilir', async () => {
    const p = fakeProvider({ code: DELEGATED_CODE.toUpperCase().replace('0XEF', '0xef') })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: [APPROVE, OTHER], entryPoint: EP, delegate: DELEGATE.toLowerCase() })
    expect(g).toBe(395583n - 21000n)
  })
})

describe('estimateBatchCallGas: eski cagri-cagri yola dusulen durumlar', () => {
  const targets = { [USD1.toLowerCase()]: 46000n, [OTHER.to.toLowerCase()]: 60000n }
  const oldSum = perCall(46000n) + perCall(60000n)

  for (const [name, opts] of [
    ['hesap bagli degil (kod yok: o agdaki ilk op)', { code: '0x' }],
    ['baska bir delegeye bagli', { code: '0xef0100' + '12'.repeat(20) }],
    ['kod okunamadi', { codeThrows: true }],
    ['batch tahmini revert etti', { batch: reverted() }],
  ]) {
    it(name, async () => {
      const p = fakeProvider({ ...opts, byTarget: targets })
      const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: [APPROVE, OTHER], entryPoint: EP, delegate: DELEGATE })
      expect(g).toBe(oldSum)
    })
  }

  it('hesap bagli degilse EntryPoint ten tahmin HIC istenmez (kodsuz EOA ya cagri ucuz gorunur, yaniltir)', async () => {
    const p = fakeProvider({ code: '0x', byTarget: targets })
    await estimateBatchCallGas({ provider: p, from: FROM, calls: [APPROVE, OTHER], entryPoint: EP, delegate: DELEGATE })
    expect(p.calls.some((tx) => tx.from && tx.from.toLowerCase() === EP.toLowerCase())).toBe(false)
  })

  it('tek cagrili op batch yoluna girmez (execute ile sarilir, bagimlilik yok)', async () => {
    const p = fakeProvider({ byTarget: targets })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: [OTHER], entryPoint: EP, delegate: DELEGATE })
    expect(g).toBe(perCall(60000n))
    expect(p.getCode).not.toHaveBeenCalled()
  })

  it('entryPoint / delegate verilmezse bugunku davranis birebir (kod okunmaz)', async () => {
    const p = fakeProvider({ byTarget: targets })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: [APPROVE, OTHER] })
    expect(g).toBe(oldSum)
    expect(p.getCode).not.toHaveBeenCalled()
  })
})

describe('tahmin edilemeyen LCX router cagrisi', () => {
  it('LCX_SWAP_GAS_FALLBACK 1.000.000', () => {
    expect(LCX_SWAP_GAS_FALLBACK).toBe(1000000n)
  })

  it('bagli olmayan hesapta [approve, LCX swap]: swap 200.000 degil 1.000.000 yedek alir', async () => {
    const p = fakeProvider({ code: '0x', byTarget: { [USD1.toLowerCase()]: 46000n, [ROUTER.toLowerCase()]: reverted() } })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: [APPROVE, SWAP], entryPoint: EP, delegate: DELEGATE })
    expect(g).toBe(perCall(46000n) + LCX_SWAP_GAS_FALLBACK)
  })

  it('her iki LCX router adresi (harf duyarsiz) taninir', async () => {
    for (const router of new Set(Object.values(LCX_ROUTERS))) {
      const call = { to: router.toLowerCase(), value: 0n, data: '0xfc54261d' }
      const p = fakeProvider({ code: '0x', byTarget: { [router.toLowerCase()]: reverted() } })
      expect(await estimateBatchCallGas({ provider: p, from: FROM, calls: [call] }), router).toBe(LCX_SWAP_GAS_FALLBACK)
    }
  })

  it('LCX disi tahmin edilemeyen cagri bugunku 200.000 yedegi korur', async () => {
    const p = fakeProvider({ code: '0x', byTarget: { [OTHER.to.toLowerCase()]: reverted() } })
    expect(await estimateBatchCallGas({ provider: p, from: FROM, calls: [OTHER] })).toBe(200000n)
  })

  it('tahmin edilebilen LCX cagrisi yedege dusmez (native girdili takas)', async () => {
    const p = fakeProvider({ code: '0x', byTarget: { [ROUTER.toLowerCase()]: 600000n } })
    const call = { ...SWAP, value: 1000n }
    expect(await estimateBatchCallGas({ provider: p, from: FROM, calls: [call] })).toBe(perCall(600000n))
  })
})

// Inceleme bulgusu (2026-11-20): getCode ile estimateGas AYRI isteklerdir; yuk dengeleyicili bir RPC'de ilk op
// delegasyonu yazdiktan hemen sonra getCode guncel dugume, estimateGas geride kalan dugume gidebilir. Orada hesap
// kodsuzdur: calldata'li cagri hicbir sey calistirmadan basarili olur ve tahmin 21.000 + calldata maliyeti kadar
// cikar. Bu yuzden batch tahmini, kodsuz bir EOA'nin verebilecegi en yuksek degerin (21.000 + EIP-7623 tabani
// 10/jeton) ustunde ve cagri basina en az 2.600 (soguk hesap erisimi) fazla olmali; degilse reddedilir.
describe('batch tahmini makul alt sinir (gecikmeli dugum)', () => {
  const calls = [APPROVE, OTHER]
  const bytes = ethers.getBytes(buildBatchCallData(calls))
  const tokens = BigInt(bytes.filter((b) => b === 0).length + 4 * bytes.filter((b) => b !== 0).length)
  const ceilingNoCode = 21000n + 10n * tokens
  const threshold = ceilingNoCode + 2n * 2600n
  const targets = { [USD1.toLowerCase()]: 46000n, [OTHER.to.toLowerCase()]: 60000n }
  const oldSum = perCall(46000n) + perCall(60000n)

  for (const [name, batch] of [
    ['kodsuz EOA, EIP-7623 tabani (21.000 + 10/jeton)', ceilingNoCode],
    ['kodsuz EOA, standart calldata (21.000 + 4/jeton)', 21000n + 4n * tokens],
    ['esigin hemen alti', threshold - 1n],
  ]) {
    it(`${name}: reddedilir, eski cagri-cagri toplam`, async () => {
      const p = fakeProvider({ batch, byTarget: targets })
      const g = await estimateBatchCallGas({ provider: p, from: FROM, calls, entryPoint: EP, delegate: DELEGATE })
      expect(g).toBe(oldSum)
    })
  }

  // Ikinci inceleme: dugumlerin ikili aramasi tahmini ~%1-1,5 yukari tasir; 12 KB calldata'da kodsuz tahmin
  // 512.554, sabit payli esik 512.560 idi. Pay en az tavanin %2'si.
  it('buyuk calldata: kodsuz tahmin tavanin %1,5 ustunde olsa da reddedilir', async () => {
    const big = [APPROVE, { ...SWAP, data: '0xfc54261d' + '11'.repeat(12000) }]
    const b = ethers.getBytes(buildBatchCallData(big))
    const t = BigInt(b.filter((x) => x === 0).length + 4 * b.filter((x) => x !== 0).length)
    const ceiling = 21000n + 10n * t
    const p = fakeProvider({ batch: (ceiling * 1015n) / 1000n, byTarget: { [USD1.toLowerCase()]: 46000n, [ROUTER.toLowerCase()]: reverted() } })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: big, entryPoint: EP, delegate: DELEGATE })
    expect(g).toBe(perCall(46000n) + LCX_SWAP_GAS_FALLBACK)
  })

  it('esigin ustundeki kucuk ama gercek batch kabul edilir', async () => {
    const p = fakeProvider({ batch: threshold, byTarget: targets })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls, entryPoint: EP, delegate: DELEGATE })
    expect(g).toBe(threshold - 21000n)
  })
})

// Inceleme bulgusu: ayni hata sinifi LCX disinda da var. Cok cagrili op'ta ilk cagridan SONRA gelen bir cagri
// tahmin edilemiyorsa sebep buyuk olasilikla onceki cagriya (approve) bagimliliktir; 200.000 yedek kopru / baska
// takas yolu icin de yetmeyebilir. Gonderim ve teklif yollari DEPENDENT_CALL_GAS_FALLBACK verir; vermeyen cagiran
// (ATS satisi: sponsorun gaz tavani var) bugunku 200.000'de kalir.
describe('bagimli cagri yedegi (dependentFallback)', () => {
  it('DEPENDENT_CALL_GAS_FALLBACK 1.000.000', () => {
    expect(DEPENDENT_CALL_GAS_FALLBACK).toBe(1000000n)
  })

  it('bagli olmayan hesap, [approve, X] ve X tahmin edilemiyor: X 1.000.000 alir', async () => {
    const p = fakeProvider({ code: '0x', byTarget: { [USD1.toLowerCase()]: 46000n, [OTHER.to.toLowerCase()]: reverted() } })
    const g = await estimateBatchCallGas({
      provider: p, from: FROM, calls: [APPROVE, OTHER], entryPoint: EP, delegate: DELEGATE,
      dependentFallback: DEPENDENT_CALL_GAS_FALLBACK,
    })
    expect(g).toBe(perCall(46000n) + DEPENDENT_CALL_GAS_FALLBACK)
  })

  it('verilmezse bugunku 200.000 (ATS satisi degismez)', async () => {
    const p = fakeProvider({ code: '0x', byTarget: { [USD1.toLowerCase()]: 46000n, [OTHER.to.toLowerCase()]: reverted() } })
    const g = await estimateBatchCallGas({ provider: p, from: FROM, calls: [APPROVE, OTHER] })
    expect(g).toBe(perCall(46000n) + 200000n)
  })

  it('ilk cagri bagimli degildir: tahmin edilemezse 200.000 kalir', async () => {
    const p = fakeProvider({ code: '0x', byTarget: { [OTHER.to.toLowerCase()]: reverted(), [USD1.toLowerCase()]: 46000n } })
    const g = await estimateBatchCallGas({
      provider: p, from: FROM, calls: [OTHER, APPROVE], dependentFallback: DEPENDENT_CALL_GAS_FALLBACK,
    })
    expect(g).toBe(200000n + perCall(46000n))
  })

  it('buildAtsGasParams dependentFallback i gecirir', async () => {
    const p = fakeProvider({ code: '0x', byTarget: { [USD1.toLowerCase()]: 46000n, [OTHER.to.toLowerCase()]: reverted() } })
    const { gas } = await buildAtsGasParams({
      provider: p, from: FROM, calls: [APPROVE, OTHER], crosschain: true,
      entryPoint: EP, delegate: DELEGATE, dependentFallback: DEPENDENT_CALL_GAS_FALLBACK,
    })
    expect(gas.callGasLimit).toBe(((perCall(46000n) + DEPENDENT_CALL_GAS_FALLBACK) * 125n + 99n) / 100n)
  })
})
