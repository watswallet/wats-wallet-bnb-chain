import { describe, it, expect, vi } from 'vitest'
import {
    createQuoteScheduler,
    AMOUNT_DEBOUNCE_MS,
    DISCRETE_DEBOUNCE_MS,
    QUOTE_COOLDOWN_MS,
    LOCAL_BUDGET_MAX,
    LOCAL_BUDGET_WINDOW_MS,
    REFRESH_LEAD_MS,
    AUTO_REFRESH_MAX,
    RATE_RETRY_FIRST_MS,
    RATE_RETRY_MAX
} from './quoteScheduler'

const T0 = 1_000_000

async function flush() {
    for (let i = 0; i < 12; i++) await Promise.resolve()
}

// Elle ilerletilen saat + sahte zamanlayici + kontrol edilebilir run
function harness({ visible = true, runImpl = null } = {}) {
    let t = T0
    let nextId = 1
    let timers = []
    const state = { visible }
    const calls = []
    const changes = []
    const now = () => t
    const setTimer = (fn, ms) => {
        const id = nextId++
        timers.push({ id, at: t + ms, fn })
        return id
    }
    const clearTimer = (id) => {
        timers = timers.filter((x) => x.id !== id)
    }
    const run = (args) => {
        const call = { args, startedAt: t }
        calls.push(call)
        if (runImpl) return Promise.resolve(runImpl(args, call))
        return new Promise((resolve) => {
            call.resolve = resolve
        })
    }
    const sch = createQuoteScheduler({
        run,
        onChange: (snap) => changes.push(snap),
        now,
        setTimer,
        clearTimer,
        isVisible: () => state.visible
    })
    async function advance(ms) {
        const end = t + ms
        for (;;) {
            const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0]
            if (!due) break
            timers = timers.filter((x) => x !== due)
            t = Math.max(t, due.at)
            due.fn()
            await flush()
        }
        t = end
        await flush()
    }
    return {
        sch,
        calls,
        changes,
        state,
        advance,
        now,
        timerCount: () => timers.length,
        elapsed: () => t - T0
    }
}

describe('sabitler', () => {
    it('spec degerleri birebir', () => {
        expect(AMOUNT_DEBOUNCE_MS).toBe(800)
        expect(DISCRETE_DEBOUNCE_MS).toBe(300)
        expect(QUOTE_COOLDOWN_MS).toBe(2000)
        expect(LOCAL_BUDGET_MAX).toBe(12)
        expect(LOCAL_BUDGET_WINDOW_MS).toBe(60000)
        expect(REFRESH_LEAD_MS).toBe(8000)
        expect(AUTO_REFRESH_MAX).toBe(5)
        expect(RATE_RETRY_FIRST_MS).toBe(5000)
        expect(RATE_RETRY_MAX).toBe(3)
    })
})

describe('debounce', () => {
    it('tutar girdisi 800 ms, ayrik girdi 300 ms sonra run cagirir', async () => {
        const a = harness()
        a.sch.input('amount', true)
        expect(a.sch.snapshot().phase).toBe('waiting')
        await a.advance(799)
        expect(a.calls).toHaveLength(0)
        await a.advance(1)
        expect(a.calls).toHaveLength(1)
        expect(a.calls[0].args.refresh).toBe(false)
        expect(a.sch.snapshot().phase).toBe('quoting')

        const b = harness()
        b.sch.input('discrete', true)
        await b.advance(299)
        expect(b.calls).toHaveLength(0)
        await b.advance(1)
        expect(b.calls).toHaveLength(1)
    })

    it('iki hizli tutar girdisi tek run; son girdiden 800 ms sonra', async () => {
        const h = harness()
        h.sch.input('amount', true)
        await h.advance(500)
        h.sch.input('amount', true)
        await h.advance(799)
        expect(h.calls).toHaveLength(0)
        await h.advance(1)
        expect(h.calls).toHaveLength(1)
        expect(h.elapsed()).toBe(1300)
        await h.advance(5000)
        expect(h.calls).toHaveLength(1)
    })

    it('eligible:false bekleyeni iptal eder ve faz idle olur', async () => {
        const h = harness()
        h.sch.input('amount', true)
        await h.advance(400)
        h.sch.input('amount', false)
        expect(h.sch.snapshot().phase).toBe('idle')
        expect(h.timerCount()).toBe(0)
        await h.advance(5000)
        expect(h.calls).toHaveLength(0)
    })

    it('input seq artirir ve run seq/isCurrent alir', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        const s1 = h.sch.snapshot().seq
        await h.advance(300)
        expect(h.calls[0].args.seq).toBe(s1)
        expect(h.calls[0].args.isCurrent()).toBe(true)
        h.sch.input('discrete', true)
        expect(h.sch.snapshot().seq).toBe(s1 + 1)
        expect(h.calls[0].args.isCurrent()).toBe(false)
    })
})

describe('soguma ve butce', () => {
    it('run bittikten hemen sonra gelen girdi en erken bitis + 2000 ms de run cagirir', async () => {
        const h = harness({ runImpl: () => ({ status: 'error', code: 'PRIVATE_MIN_AMOUNT' }) })
        h.sch.input('discrete', true)
        await h.advance(300)
        expect(h.calls).toHaveLength(1)
        h.sch.input('discrete', true)
        await h.advance(1999)
        expect(h.calls).toHaveLength(1)
        expect(h.sch.snapshot().phase).toBe('waiting')
        await h.advance(1)
        expect(h.calls).toHaveLength(2)
        expect(h.calls[1].startedAt - h.calls[0].startedAt).toBe(2000)
    })

    it('soguma sabiti bitis anindan sayilir (yavas run)', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        await h.advance(5000)
        h.calls[0].resolve({ status: 'error', code: 'PRIVATE_MIN_AMOUNT' })
        await flush()
        h.sch.input('discrete', true)
        await h.advance(1999)
        expect(h.calls).toHaveLength(1)
        await h.advance(1)
        expect(h.calls).toHaveLength(2)
        expect(h.calls[1].startedAt - h.calls[0].startedAt).toBe(7000)
    })

    it('12 run 60 sn icinde baslamisken 13. girdi en eski damga + 60000 e kadar cagrilmaz', async () => {
        const h = harness({ runImpl: () => ({ status: 'error', code: 'PRIVATE_MIN_AMOUNT' }) })
        for (let i = 0; i < 12; i++) {
            h.sch.input('discrete', true)
            await h.advance(3000)
        }
        expect(h.calls).toHaveLength(12)
        const oldest = h.calls[0].startedAt
        h.sch.input('discrete', true)
        await h.advance(oldest + 60000 - h.now() - 1)
        expect(h.calls).toHaveLength(12)
        expect(h.sch.snapshot().phase).toBe('waiting')
        await h.advance(1)
        expect(h.calls).toHaveLength(13)
        expect(h.calls[12].startedAt).toBe(oldest + 60000)
    })
})

describe('uctaki eski yanit', () => {
    it('girdi tekrar gelirse eski run sonucu fazi ready YAPMAZ; yeni run surer', async () => {
        const h = harness()
        h.sch.input('amount', true)
        await h.advance(800)
        expect(h.calls).toHaveLength(1)
        const first = h.calls[0]
        h.sch.input('amount', true)
        expect(first.args.isCurrent()).toBe(false)
        first.resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().phase).toBe('waiting')
        await h.advance(10000)
        expect(h.calls).toHaveLength(2)
        expect(h.calls[1].args.isCurrent()).toBe(true)
        h.calls[1].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().phase).toBe('ready')
    })

    it('yeni run ucustaki run ile cakismaz (arkasina siralanir)', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        expect(h.calls).toHaveLength(1)
        h.sch.input('discrete', true)
        await h.advance(20000)
        expect(h.calls).toHaveLength(1)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.calls).toHaveLength(1)
        await h.advance(1999)
        expect(h.calls).toHaveLength(1)
        await h.advance(1)
        expect(h.calls).toHaveLength(2)
        expect(h.sch.snapshot().phase).toBe('quoting')
    })

    it("status 'stale' yok sayilir; guncel seq ile gelirse quoting da takilmaz, waiting e doner ve yeniden dener", async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'stale' })
        await flush()
        expect(h.sch.snapshot().phase).toBe('waiting')
        await h.advance(2000)
        expect(h.calls).toHaveLength(2)
        h.calls[1].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().phase).toBe('ready')
    })

    it('art arda stale sonuclar sonsuz dongu kurmaz (en cok 3 yeniden deneme sonra error)', async () => {
        const h = harness({ runImpl: () => ({ status: 'stale' }) })
        h.sch.input('discrete', true)
        await h.advance(60000)
        expect(h.calls.length).toBeLessThanOrEqual(RATE_RETRY_MAX + 1)
        expect(h.sch.snapshot().phase).toBe('error')
        expect(h.sch.snapshot().errorCode).toBe(null)
    })
})

describe('on yenileme', () => {
    it('ok(endMs = t0 + 40000): t0 + 32000 de run({ refresh:true })', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        const t0 = h.now()
        h.calls[0].resolve({ status: 'ok', endMs: t0 + 40000 })
        await flush()
        expect(h.sch.snapshot().phase).toBe('ready')
        expect(h.sch.snapshot().endMs).toBe(t0 + 40000)
        await h.advance(31999)
        expect(h.calls).toHaveLength(1)
        await h.advance(1)
        expect(h.calls).toHaveLength(2)
        expect(h.calls[1].args.refresh).toBe(true)
        expect(h.calls[1].startedAt).toBe(t0 + 32000)
    })

    it('5 yenilemeden sonra yenileme denenmez ve endMs te expired', async () => {
        const h = harness({ runImpl: () => ({ status: 'ok', endMs: h.now() + 40000 }) })
        h.sch.input('discrete', true)
        await h.advance(300)
        expect(h.sch.snapshot().phase).toBe('ready')
        await h.advance(32000 * 5 + 1000)
        const refreshes = h.calls.filter((c) => c.args.refresh)
        expect(refreshes).toHaveLength(5)
        expect(h.sch.snapshot().autoRefreshes).toBe(5)
        expect(h.sch.snapshot().phase).toBe('ready')
        const end = h.sch.snapshot().endMs
        await h.advance(end - h.now() - 1)
        expect(h.sch.snapshot().phase).toBe('ready')
        await h.advance(1)
        expect(h.sch.snapshot().phase).toBe('expired')
        await h.advance(100000)
        expect(h.calls.filter((c) => c.args.refresh)).toHaveLength(5)
    })

    it('touch() sayaci sifirlar', async () => {
        const h = harness({ runImpl: () => ({ status: 'ok', endMs: h.now() + 40000 }) })
        h.sch.input('discrete', true)
        await h.advance(300)
        await h.advance(32000)
        expect(h.sch.snapshot().autoRefreshes).toBeGreaterThan(0)
        h.sch.touch()
        expect(h.sch.snapshot().autoRefreshes).toBe(0)
    })

    it('touch() yenilemeler tukenmisse yenilemeyi yeniden planlar', async () => {
        const h = harness({ runImpl: () => ({ status: 'ok', endMs: h.now() + 40000 }) })
        h.sch.input('discrete', true)
        await h.advance(300)
        await h.advance(32000 * 5 + 1000)
        expect(h.calls.filter((c) => c.args.refresh)).toHaveLength(5)
        h.sch.touch()
        await h.advance(31000)
        expect(h.calls.filter((c) => c.args.refresh)).toHaveLength(6)
        expect(h.sch.snapshot().phase).toBe('ready')
    })

    it('yenileme error ise faz ready kalir, endMs te expired; yeniden denenmez', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        const t0 = h.now()
        h.calls[0].resolve({ status: 'ok', endMs: t0 + 40000 })
        await flush()
        await h.advance(32000)
        expect(h.calls).toHaveLength(2)
        h.calls[1].resolve({ status: 'error', code: 'PRIVATE_NETWORK' })
        await flush()
        expect(h.sch.snapshot().phase).toBe('ready')
        expect(h.sch.snapshot().refreshing).toBe(false)
        expect(h.sch.snapshot().endMs).toBe(t0 + 40000)
        await h.advance(7000)
        expect(h.calls).toHaveLength(2)
        expect(h.sch.snapshot().phase).toBe('ready')
        await h.advance(1000)
        expect(h.sch.snapshot().phase).toBe('expired')
    })

    it('yenileme ok ise yeni endMs ve yeni plan', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        const t0 = h.now()
        h.calls[0].resolve({ status: 'ok', endMs: t0 + 40000 })
        await flush()
        await h.advance(32000)
        h.calls[1].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().endMs).toBe(t0 + 32000 + 40000)
        await h.advance(31999)
        expect(h.calls).toHaveLength(2)
        await h.advance(1)
        expect(h.calls).toHaveLength(3)
    })

    it('ok(endMs <= now) hemen expired, ek run yok', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() })
        await flush()
        expect(h.sch.snapshot().phase).toBe('expired')
        await h.advance(120000)
        expect(h.calls).toHaveLength(1)
        expect(h.timerCount()).toBe(0)
    })

    it('ok(endMs gecmiste) ve NaN/undefined endMs de hemen expired (NaN-safe)', async () => {
        for (const endMs of [T0 - 5000, NaN, undefined]) {
            const h = harness()
            h.sch.input('discrete', true)
            await h.advance(300)
            h.calls[0].resolve({ status: 'ok', endMs })
            await flush()
            expect(h.sch.snapshot().phase).toBe('expired')
            await h.advance(120000)
            expect(h.calls).toHaveLength(1)
        }
    })

    it('kisa omurlu teklif: planlanan an endMs den kucuk degilse yenileme yok, endMs te expired', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        const t0 = h.now()
        h.calls[0].resolve({ status: 'ok', endMs: t0 + 1500 })
        await flush()
        expect(h.sch.snapshot().phase).toBe('ready')
        await h.advance(1499)
        expect(h.calls).toHaveLength(1)
        await h.advance(1)
        expect(h.sch.snapshot().phase).toBe('expired')
        expect(h.calls).toHaveLength(1)
        expect(h.sch.snapshot().autoRefreshes).toBe(0)
    })

    it('on yenileme run i ucustayken refreshing true, bitince false; normal run da hep false', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        expect(h.sch.snapshot().refreshing).toBe(false)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().refreshing).toBe(false)
        await h.advance(32000)
        expect(h.sch.snapshot().refreshing).toBe(true)
        expect(h.sch.snapshot().phase).toBe('ready')
        const before = h.changes.length
        h.calls[1].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().refreshing).toBe(false)
        expect(h.changes.length).toBeGreaterThan(before)
    })

    it('onChange refreshing true -> false gecisinde faz ready kalirken de cagrilir', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        await h.advance(32000)
        const idx = h.changes.findIndex((s) => s.refreshing === true)
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(h.changes[idx].phase).toBe('ready')
        h.calls[1].resolve({ status: 'error', code: null })
        await flush()
        const off = h.changes.slice(idx + 1).find((s) => s.refreshing === false)
        expect(off).toBeTruthy()
        expect(off.phase).toBe('ready')
    })
})

describe('gorunurluk', () => {
    it('isVisible false iken yenileme planlanmaz, endMs te expired; gorunur olup visibilityChanged cagrilinca planlanir', async () => {
        const g = harness({ visible: false })
        g.sch.input('discrete', true)
        await g.advance(300)
        const u0 = g.now()
        g.calls[0].resolve({ status: 'ok', endMs: u0 + 40000 })
        await flush()
        await g.advance(10000)
        g.state.visible = true
        g.sch.visibilityChanged()
        await g.advance(21999)
        expect(g.calls).toHaveLength(1)
        await g.advance(1)
        expect(g.calls).toHaveLength(2)
        expect(g.calls[1].args.refresh).toBe(true)
        expect(g.calls[1].startedAt).toBe(u0 + 32000)
    })

    it('hic gorunur olmazsa endMs te expired', async () => {
        const h = harness({ visible: false })
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        await h.advance(40000)
        expect(h.sch.snapshot().phase).toBe('expired')
        expect(h.calls).toHaveLength(1)
    })

    it('planli yenileme tetiklenirken sayfa gizliyse yenileme dusurulur', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        await h.advance(10000)
        h.state.visible = false
        await h.advance(22000)
        expect(h.calls).toHaveLength(1)
        expect(h.sch.snapshot().autoRefreshes).toBe(0)
    })
})

describe('hatalar', () => {
    it('error (PRIVATE_MIN_AMOUNT) faz error, retry() e kadar yeni run yok', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'error', code: 'PRIVATE_MIN_AMOUNT' })
        await flush()
        const snap = h.sch.snapshot()
        expect(snap.phase).toBe('error')
        expect(snap.errorCode).toBe('PRIVATE_MIN_AMOUNT')
        await h.advance(120000)
        expect(h.calls).toHaveLength(1)
        h.sch.retry()
        expect(h.sch.snapshot().phase).toBe('waiting')
        await h.advance(2000)
        expect(h.calls).toHaveLength(2)
        expect(h.calls[1].args.refresh).toBe(false)
    })

    it('retry() autoRefreshes u sifirlar ve seq artirir', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'error', code: 'X' })
        await flush()
        const seq = h.sch.snapshot().seq
        h.sch.retry()
        expect(h.sch.snapshot().seq).toBe(seq + 1)
        expect(h.sch.snapshot().autoRefreshes).toBe(0)
        expect(h.sch.snapshot().errorCode).toBe(null)
    })

    it('PRIVATE_RATE_LIMITED rateWait, 5000 ms sonra run; art arda 4. sonucta error', async () => {
        const h = harness({ runImpl: () => ({ status: 'error', code: 'PRIVATE_RATE_LIMITED' }) })
        h.sch.input('discrete', true)
        await h.advance(300)
        expect(h.calls).toHaveLength(1)
        expect(h.sch.snapshot().phase).toBe('rateWait')
        await h.advance(4999)
        expect(h.calls).toHaveLength(1)
        await h.advance(1)
        expect(h.calls).toHaveLength(2)
        expect(h.calls[1].startedAt - h.calls[0].startedAt).toBe(5000)
        expect(h.sch.snapshot().phase).toBe('rateWait')
        await h.advance(5000)
        expect(h.calls).toHaveLength(3)
        expect(h.sch.snapshot().phase).toBe('rateWait')
        await h.advance(5000)
        expect(h.calls).toHaveLength(4)
        expect(h.sch.snapshot().phase).toBe('error')
        expect(h.sch.snapshot().errorCode).toBe('PRIVATE_RATE_LIMITED')
        await h.advance(120000)
        expect(h.calls).toHaveLength(4)
    })

    it('hiz siniri sonrasi ok sayaci sifirlar', async () => {
        let n = 0
        const h = harness({
            runImpl: () => {
                n++
                if (n === 1) return { status: 'error', code: 'PRIVATE_RATE_LIMITED' }
                return { status: 'ok', endMs: h.now() + 40000 }
            }
        })
        h.sch.input('discrete', true)
        await h.advance(300 + 5000)
        expect(h.sch.snapshot().phase).toBe('ready')
        expect(h.calls).toHaveLength(2)
    })

    it('hiz siniri gecikmesi butce serbest anina uzar (<= 60000)', async () => {
        let n = 0
        const h = harness({
            runImpl: () => {
                n++
                return n === 12 ? { status: 'error', code: 'PRIVATE_RATE_LIMITED' } : { status: 'error', code: 'PRIVATE_MIN_AMOUNT' }
            }
        })
        for (let i = 0; i < 12; i++) {
            h.sch.input('discrete', true)
            await h.advance(3000)
        }
        expect(h.calls).toHaveLength(12)
        expect(h.sch.snapshot().phase).toBe('rateWait')
        const oldest = h.calls[0].startedAt
        await h.advance(oldest + 60000 - h.now() - 1)
        expect(h.calls).toHaveLength(12)
        await h.advance(1)
        expect(h.calls).toHaveLength(13)
        expect(h.calls[12].startedAt).toBe(oldest + 60000)
    })

    it('fail(code) faz error, zamanlayici yok', async () => {
        const h = harness()
        h.sch.input('amount', true)
        h.sch.fail('PRIVATE_DEPOSIT_UNTRACKED')
        expect(h.sch.snapshot().phase).toBe('error')
        expect(h.sch.snapshot().errorCode).toBe('PRIVATE_DEPOSIT_UNTRACKED')
        expect(h.timerCount()).toBe(0)
        await h.advance(10000)
        expect(h.calls).toHaveLength(0)
    })

    it('run reddederse error (kod null) olur', async () => {
        const h = harness({
            runImpl: () => {
                throw new Error('x')
            }
        })
        h.sch.input('discrete', true)
        await h.advance(300)
        expect(h.sch.snapshot().phase).toBe('error')
        expect(h.sch.snapshot().errorCode).toBe(null)
    })
})

describe('kilit, durdurma, yok etme', () => {
    it('lock() zamanlayicilari durdurur; input() kilidi acar', async () => {
        const h = harness()
        h.sch.input('amount', true)
        h.sch.lock()
        expect(h.sch.snapshot().phase).toBe('locked')
        expect(h.timerCount()).toBe(0)
        await h.advance(10000)
        expect(h.calls).toHaveLength(0)
        h.sch.input('amount', true)
        expect(h.sch.snapshot().phase).toBe('waiting')
        await h.advance(800)
        expect(h.calls).toHaveLength(1)
    })

    it('retry() kilitliyken etkisizdir', async () => {
        const h = harness()
        h.sch.input('amount', true)
        h.sch.lock()
        const before = h.sch.snapshot()
        h.sch.retry()
        expect(h.sch.snapshot()).toEqual(before)
        await h.advance(10000)
        expect(h.calls).toHaveLength(0)
    })

    it('lock() sirasinda ucuktaki ok yok sayilir', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.sch.lock()
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().phase).toBe('locked')
        await h.advance(60000)
        expect(h.calls).toHaveLength(1)
    })

    it('stop() sonrasi ucuktaki ok yok sayilir ve zamanlayici kalmaz', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        const seq = h.sch.snapshot().seq
        h.sch.stop()
        expect(h.sch.snapshot().phase).toBe('stopped')
        expect(h.sch.snapshot().seq).toBe(seq + 1)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.sch.snapshot().phase).toBe('stopped')
        expect(h.timerCount()).toBe(0)
        await h.advance(60000)
        expect(h.calls).toHaveLength(1)
    })

    it('stop() hazir teklifin yenileme ve bitis zamanlayicilarini iptal eder', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        h.sch.stop()
        expect(h.timerCount()).toBe(0)
        await h.advance(60000)
        expect(h.sch.snapshot().phase).toBe('stopped')
        expect(h.calls).toHaveLength(1)
    })

    it('dispose() sonrasi zamanlayici kalmaz', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        expect(h.timerCount()).toBeGreaterThan(0)
        h.sch.dispose()
        expect(h.timerCount()).toBe(0)
        await h.advance(120000)
        expect(h.calls).toHaveLength(1)
        h.sch.input('amount', true)
        expect(h.timerCount()).toBe(0)
    })

    it('onChange faz gecislerinde cagrilir (yinelenen anlik goruntu yok)', async () => {
        const h = harness()
        h.sch.input('discrete', true)
        await h.advance(300)
        h.calls[0].resolve({ status: 'ok', endMs: h.now() + 40000 })
        await flush()
        const phases = h.changes.map((s) => s.phase)
        expect(phases).toEqual(['waiting', 'quoting', 'ready'])
        for (let i = 1; i < h.changes.length; i++) {
            expect(h.changes[i]).not.toEqual(h.changes[i - 1])
        }
        await h.advance(40000)
        expect(h.changes[h.changes.length - 1].phase).toBe('expired')
    })

    it('snapshot alanlari', () => {
        const h = harness()
        expect(h.sch.snapshot()).toEqual({
            phase: 'idle',
            seq: 0,
            errorCode: null,
            autoRefreshes: 0,
            endMs: null,
            refreshing: false
        })
    })
})

describe('input sonrasi sifirlama', () => {
    it('input autoRefreshes u sifirlar, kilidi ve bekleyeni temizler', async () => {
        const h = harness({ runImpl: () => ({ status: 'ok', endMs: h.now() + 40000 }) })
        h.sch.input('discrete', true)
        await h.advance(300 + 32000)
        expect(h.sch.snapshot().autoRefreshes).toBeGreaterThan(0)
        h.sch.input('discrete', true)
        expect(h.sch.snapshot().autoRefreshes).toBe(0)
        expect(h.sch.snapshot().endMs).toBe(null)
        expect(h.sch.snapshot().phase).toBe('waiting')
    })
})
