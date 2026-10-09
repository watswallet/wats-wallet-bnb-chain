import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyRun, summarize, formatSummary, parseArgs, buildPageHtml, mergeTimeline, diagnoseTimeline } from './k2-lib.mjs'

const ok = { done: true, status: 'OK', result: [] }

test('classifyRun: tum cagrilar [] ile yanitlandi -> OK', () => {
  assert.equal(classifyRun([ok, ok], { timedOut: false }), 'OK')
})
test('classifyRun: yanitsiz cagri + sure doldu -> HANG', () => {
  assert.equal(classifyRun([ok, { done: false }], { timedOut: true }), 'HANG')
})
test('classifyRun: yanitsiz cagri ama sure dolmadi -> PENDING', () => {
  assert.equal(classifyRun([{ done: false }], { timedOut: false }), 'PENDING')
})
test('classifyRun: -32603 hatasi HANG degil ERROR sayilir', () => {
  assert.equal(classifyRun([{ done: true, status: 'ERROR', error: { code: -32603 } }], { timedOut: false }), 'ERROR')
})
test('classifyRun: bos olmayan sonuc ERROR (taze profilde hesap olmamali)', () => {
  assert.equal(classifyRun([{ done: true, status: 'OK', result: ['0x1'] }], { timedOut: false }), 'ERROR')
})
test('classifyRun: provider yok -> NOPROVIDER; cagri listesi bos -> NOPROVIDER', () => {
  assert.equal(classifyRun([{ done: true, status: 'NOPROVIDER' }], { timedOut: false }), 'NOPROVIDER')
  assert.equal(classifyRun([], { timedOut: true }), 'NOPROVIDER')
})
test('summarize: sayar ve 0 askida icin ust siniri yazar', () => {
  const s = summarize(Array.from({ length: 30 }, () => ({ status: 'OK' })))
  assert.equal(s.n, 30)
  assert.equal(s.OK, 30)
  assert.equal(s.HANG, 0)
  assert.ok(Math.abs(s.ruleOfThreeUpper95 - 0.1) < 1e-9)
  assert.ok(s.pNoHangIfRate40 < 1e-6)
  assert.match(formatSummary('x', s), /N=30 OK=30 HANG=0 SLOW=0 ERROR=0 NOPROVIDER=0 SCRIPT_ERROR=0/)
})
test('summarize: SLOW ve SCRIPT_ERROR ayri sayilir', () => {
  const s = summarize([{ status: 'SLOW' }, { status: 'SCRIPT_ERROR' }, { status: 'OK' }])
  assert.equal(s.SLOW, 1)
  assert.equal(s.SCRIPT_ERROR, 1)
  assert.equal(s.HANG, 0)
})
test('summarize: askida orani', () => {
  const runs = [...Array(12).fill({ status: 'HANG' }), ...Array(18).fill({ status: 'OK' })]
  const s = summarize(runs)
  assert.equal(s.HANG, 12)
  assert.ok(Math.abs(s.hangRate - 0.4) < 1e-9)
})
test('parseArgs: varsayilanlar ve gecersiz mod reddi', () => {
  const o = parseArgs([])
  assert.equal(o.runs, 30)
  assert.equal(o.pre, 'none')
  assert.equal(o.fire, 'head')
  assert.equal(o.burst, 1)
  assert.throws(() => parseArgs(['--pre', 'x']), /--pre/)
  assert.throws(() => parseArgs(['--runs', '0']), /pozitif/)
  assert.throws(() => parseArgs(['--bogus']), /bilinmeyen/)
  assert.equal(parseArgs(['--runs', '5', '--pre', 'sw-stopped', '--popup', '--burst', '2']).burst, 2)
  assert.equal(parseArgs(['--cleanup', 'X:/tmp/k2']).cleanup, 'X:/tmp/k2')
  assert.equal(parseArgs(['--pre', 'sw-idle']).pre, 'sw-idle')
})
test('buildPageHtml: head modu betigi hemen atar; delay modu setTimeout kullanir; burst sayisi gomulur', () => {
  const head = buildPageHtml({ fire: 'head', burst: 2, fireDelayMs: 1500 })
  assert.match(head, /\nfire\(\);\n/)
  assert.match(head, /i < 2/)
  assert.doesNotMatch(head, /setTimeout\(fire/)
  assert.match(buildPageHtml({ fire: 'delay', burst: 1, fireDelayMs: 777 }), /setTimeout\(fire, 777\)/)
  assert.match(buildPageHtml({ fire: 'dcl', burst: 1, fireDelayMs: 0 }), /DOMContentLoaded/)
})
test('mergeTimeline: gezinmeye gore goreli ve sirali', () => {
  const rows = mergeTimeline(1000, [{ at: 1500, src: 'sw', ev: 'b' }], [{ at: 1200, src: 'page', ev: 'a' }, { at: NaN, src: 'x', ev: 'bad' }])
  assert.deepEqual(rows.map((r) => [r.t, r.ev]), [[200, 'a'], [500, 'b']])
})


const ev = (t, src, ev, detail = '') => ({ t, src, ev, detail })

test('diagnoseTimeline: istek dinleyiciden ONCE -> A (olculen K2 deseni)', () => {
  const d = diagnoseTimeline([ev(56, 'inj', 'injected-eval'), ev(59, 'inj', 'request-post', 'eth_accounts #abc'), ev(121, 'content', 'listener-registering', 'complete')])
  assert.equal(d.verdict, 'A')
  assert.equal(d.facts.listenerAt, 121)
})
test('diagnoseTimeline: dinleyici ONCEDEN kuruluydu ama mesaj alinmadi -> A? (ENGELLI)', () => {
  const d = diagnoseTimeline([ev(10, 'content', 'listener-registering'), ev(59, 'inj', 'request-post', 'eth_accounts #abc')])
  assert.equal(d.verdict, 'A?')
})
test('diagnoseTimeline: icerik aldi, SW girmedi -> B; SW girdi yanitlamadi -> C; yanitladi -> E', () => {
  const base = [ev(1, 'content', 'listener-registering'), ev(59, 'inj', 'request-post', 'eth_accounts #abc'), ev(60, 'content', 'got-message', 'eth_accounts #abc'), ev(61, 'content', 'sendMessage-call', 'eth_accounts #abc')]
  assert.equal(diagnoseTimeline(base).verdict, 'B')
  assert.equal(diagnoseTimeline([...base, ev(70, 'sw', 'onMessage-enter', 'eth_accounts')]).verdict, 'C')
  assert.equal(diagnoseTimeline([...base, ev(70, 'sw', 'onMessage-enter', 'eth_accounts'), ev(71, 'sw', 'sendResponse', 'eth_accounts')]).verdict, 'E')
})
test('diagnoseTimeline: istek kaydi yok -> D; baska kimlikli kayitlar karismaz', () => {
  assert.equal(diagnoseTimeline([]).verdict, 'D')
  const d = diagnoseTimeline([ev(5, 'inj', 'request-post', 'eth_accounts #one'), ev(9, 'content', 'got-message', 'eth_chainId #two'), ev(99, 'content', 'listener-registering')])
  assert.equal(d.verdict, 'A')
})
