// Alim op'unun cagrilari -- spec §4.3 tablosu, KESIN sira. Sunucu baska bicimi sponsorlamaz.
import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { buildSaleCalls } from './atsSale'
import { getAtsSourceConfig } from './atsConfig'

const cfg = getAtsSourceConfig()
const DESK = '0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d'
// Karisik harfli ve checksum'i TUTMAYAN bir alici: cagri listesi adresleri normallestirmeli.
const BUYER = '0xAbCdEf0000000000000000000000000000000001'
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const QID = '0x' + 'ab'.repeat(32)
const SIG = '0x' + 'cd'.repeat(65)
const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const DESK_IFACE = new ethers.Interface([
  'function buy((address buyer,address payToken,uint256 payAmount,uint256 atsAmount,uint256 deadline,bytes32 quoteId) q, bytes signature) payable',
])
const quote = (over = {}) => ({
  buyer: BUYER, payToken: USDT, payAmount: '5000000000000000000', atsAmount: '96000000000000000000',
  deadline: 1790000000, quoteId: QID, ...over,
})
const kur = (q, izinler = {}) => buildSaleCalls({
  quote: q, signature: SIG, desk: DESK, ...izinler,
  ats: cfg.token.address, paymaster: cfg.paymaster, collector: cfg.collector,
})
// Izin KARARINI executeAtsSale zincirden verir (Task 5); burada yalniz sonucu: paymaster izni
// gerekli mi, toplayiciya ne kadar izin.
const IKI_IZIN = { needsPaymasterApprove: true, collectorApproveAmount: 123000000000000000000n }
const approve = (c) => {
  const [spender, amount] = ERC20.decodeFunctionData('approve', c.data)
  return { spender: spender.toLowerCase(), amount }
}
const low = (a) => a.toLowerCase()

describe('buildSaleCalls -- spec §4.3', () => {
  it('USDT + iki izin: approve(desk, tutar) -> buy -> ATS.approve(paymaster, Max) -> ATS.approve(collector, n)', () => {
    const calls = kur(quote(), IKI_IZIN)
    expect(calls).toHaveLength(4)

    expect(low(calls[0].to)).toBe(low(USDT))
    expect(calls[0].value).toBe(0n)
    // Izin ODEME TUTARI kadar, Max DEGIL: buy onu tuketir.
    expect(approve(calls[0])).toEqual({ spender: DESK, amount: 5000000000000000000n })

    expect(low(calls[1].to)).toBe(DESK)
    expect(calls[1].value).toBe(0n)
    const [q, sig] = DESK_IFACE.decodeFunctionData('buy', calls[1].data)
    expect(low(q.buyer)).toBe(low(BUYER))
    expect(low(q.payToken)).toBe(low(USDT))
    expect(q.payAmount).toBe(5000000000000000000n)
    expect(q.atsAmount).toBe(96000000000000000000n)
    expect(q.deadline).toBe(1790000000n)
    expect(q.quoteId).toBe(QID)
    expect(sig).toBe(SIG)

    expect(low(calls[2].to)).toBe(low(cfg.token.address))
    expect(approve(calls[2])).toEqual({ spender: low(cfg.paymaster), amount: ethers.MaxUint256 })

    expect(low(calls[3].to)).toBe(low(cfg.token.address))
    // Toplayici izni ASLA sinirsiz verilmez: teklifteki tutar.
    expect(approve(calls[3])).toEqual({ spender: low(cfg.collector), amount: 123000000000000000000n })
  })

  it('BNB: approve YOK, buy value = odeme tutari', () => {
    const calls = kur(quote({ payToken: ethers.ZeroAddress }))
    expect(calls).toHaveLength(1)
    expect(low(calls[0].to)).toBe(DESK)
    expect(calls[0].value).toBe(5000000000000000000n)
    expect(DESK_IFACE.decodeFunctionData('buy', calls[0].data)[0].payToken).toBe(ethers.ZeroAddress)
  })

  it('BNB + iki izin: buy -> paymaster izni -> toplayici izni', () => {
    const calls = kur(quote({ payToken: ethers.ZeroAddress }), IKI_IZIN)
    expect(calls.map((c) => low(c.to))).toEqual([DESK, low(cfg.token.address), low(cfg.token.address)])
  })

  it('izin bilgisi verilmezse yalniz approve + buy', () => {
    expect(kur(quote())).toHaveLength(2)
  })

  it('yalniz paymaster izni -> uc cagri, son satir paymaster a Max', () => {
    const calls = kur(quote(), { needsPaymasterApprove: true })
    expect(calls).toHaveLength(3)
    expect(approve(calls[2])).toEqual({ spender: low(cfg.paymaster), amount: ethers.MaxUint256 })
  })

  it('yalniz toplayici izni -> uc cagri, son satir toplayiciya TAM tutar', () => {
    const calls = kur(quote(), { collectorApproveAmount: 5n })
    expect(calls).toHaveLength(3)
    expect(approve(calls[2])).toEqual({ spender: low(cfg.collector), amount: 5n })
  })

  it('toplayici tutari 0 ya da MaxUint256 ise o izin EKLENMEZ (sinirsiz izin yok)', () => {
    expect(kur(quote(), { collectorApproveAmount: 0n })).toHaveLength(2)
    expect(kur(quote(), { collectorApproveAmount: ethers.MaxUint256 })).toHaveLength(2)
  })

  it('paymaster satiri yalniz `true` ile eklenir', () => {
    expect(kur(quote(), { needsPaymasterApprove: 'evet' })).toHaveLength(2)
  })
})
