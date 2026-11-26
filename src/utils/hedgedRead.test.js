import { describe, it, expect, vi, afterEach } from 'vitest'
import { hedgedRead, HEDGE_DELAY_MS } from './hedgedRead'

afterEach(() => { vi.useRealTimers() })

const never = () => new Promise(() => {})

describe('hedgedRead', () => {
  it('tek adreste okumayi aynen yapar, yedek yok', async () => {
    const read = vi.fn(async (u) => `v:${u}`)
    expect(await hedgedRead(['a'], read)).toBe('v:a')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('ilk hizli yanit verirse yedek HIC baslamaz', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async (u) => `v:${u}`)
    const p = hedgedRead(['a', 'b'], read)
    expect(await p).toBe('v:a')
    await vi.advanceTimersByTimeAsync(HEDGE_DELAY_MS * 3)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('ilk takilirsa gecikme sonra yedek baslar ve ilk basarili yanit kazanir', async () => {
    vi.useFakeTimers()
    const read = vi.fn((u) => (u === 'a' ? never() : Promise.resolve('v:b')))
    const p = hedgedRead(['a', 'b'], read)
    await vi.advanceTimersByTimeAsync(HEDGE_DELAY_MS - 10)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20)
    expect(await p).toBe('v:b')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('ilk gec de olsa once basarili olan kazanir, deger karistirilmaz', async () => {
    vi.useFakeTimers()
    let resolveA
    const read = vi.fn((u) => (u === 'a' ? new Promise((r) => { resolveA = r }) : new Promise((r) => setTimeout(() => r('v:b'), 5000))))
    const p = hedgedRead(['a', 'b'], read)
    await vi.advanceTimersByTimeAsync(HEDGE_DELAY_MS + 10)
    resolveA('v:a')
    expect(await p).toBe('v:a')
  })

  it('ilk hata verirse yedege hemen gecer', async () => {
    const read = vi.fn(async (u) => { if (u === 'a') throw new Error('a-hata'); return 'v:b' })
    expect(await hedgedRead(['a', 'b'], read)).toBe('v:b')
  })

  it('tum adresler basarisizsa ILK adresin hatasi atilir (bugunku davranis)', async () => {
    const read = vi.fn(async (u) => { throw new Error(`${u}-hata`) })
    await expect(hedgedRead(['a', 'b', 'c'], read)).rejects.toThrow('a-hata')
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('bos liste atar', async () => {
    await expect(hedgedRead([], async () => 1)).rejects.toThrow()
  })
})
