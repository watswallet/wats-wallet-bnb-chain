// nextSteps -> callData cevirisi. Adimlarin NE oldugu backend'in karari; bu modul yalniz
// cevirir. Karar mantigini buraya tasimak "ikinci uygulama" sorununu geri getirir.
import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { stepsToOps } from './onboarding'

const COLLECTOR = '0xE39E4D2EAb51b7a77D2d6bf35b1C0501B7cB75cF'
const BSC_ATS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
// 2026-08-12 filo yenilemesi: yeni nesil BSC paymaster'i (eski 0x6C0d9865... olu, deposit 0).
const BSC_PM = '0x004e1f5aB1B7bf85412B11628Ca7A8C73Cd8ad53'
const EXECUTE = new ethers.Interface(['function execute(address dest, uint256 value, bytes func)'])
const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount)'])

const decode = (callData) => {
  const [dest, value, inner] = EXECUTE.decodeFunctionData('execute', callData)
  const [spender, amount] = ERC20.decodeFunctionData('approve', inner)
  return { dest, value, spender, amount }
}

describe('stepsToOps', () => {
  it('approve-paymaster SINIRSIZ izin verir (bootstrap byte duzeyinde kisitli)', () => {
    const [op] = stepsToOps([{ chainId: 56, action: 'approve-paymaster' }], COLLECTOR)
    const d = decode(op.callData)
    expect(op.chainId).toBe(56)
    expect(d.dest.toLowerCase()).toBe(BSC_ATS.toLowerCase())
    expect(d.spender.toLowerCase()).toBe(BSC_PM.toLowerCase())
    expect(d.amount).toBe(ethers.MaxUint256)
    expect(d.value).toBe(0n)
  })

  it('approve-collector SINIRLI izin verir (hot-key ile tetiklenir)', () => {
    const [op] = stepsToOps(
      [{ chainId: 56, action: 'approve-collector', suggestedAmount: '50000000000000000000' }], COLLECTOR)
    const d = decode(op.callData)
    expect(d.spender.toLowerCase()).toBe(COLLECTOR.toLowerCase())
    expect(d.amount).toBe(50000000000000000000n)
  })

  it('suggestedAmount yoksa FIRLATIR — sessizce sinirsiz izne dusulmez', () => {
    expect(() => stepsToOps([{ chainId: 56, action: 'approve-collector' }], COLLECTOR)).toThrow(/suggestedAmount/)
  })

  // EKLENTI FARKI: op kendi `action`'ini TASIR. Cuzdan her op'un beklenen sponsor modunu
  // buradan turetir (approve-paymaster -> bootstrap, approve-collector -> normal); nextSteps
  // dizisiyle indeks esleştirmek, stepsToOps'un sonsuza kadar 1:1 map kalacagi varsayimina
  // dayanirdi ve sessizce kayabilirdi.
  it('op kendi action alanini tasir', () => {
    const ops = stepsToOps([
      { chainId: 56, action: 'approve-paymaster' },
      { chainId: 56, action: 'approve-collector', suggestedAmount: '1' },
    ], COLLECTOR)
    expect(ops.map((o) => o.action)).toEqual(['approve-paymaster', 'approve-collector'])
  })

  it('adim sirasi korunur', () => {
    const ops = stepsToOps([
      { chainId: 56, action: 'approve-paymaster' },
      { chainId: 56, action: 'approve-collector', suggestedAmount: '1' },
    ], COLLECTOR)
    expect(ops.map((o) => o.label)).toEqual(['paymaster izni', 'toplayıcı izni'])
  })
})
