// K2 (ilk provider istegi askida) -- SAF yardimcilar. Tarayici/ag/dosya YOK: node --test ile sinanir.
//
// Siniflandirma sozlesmesi (bir kosu = bir sayfa yuklemesi + sayfa yuklenir yuklenmez atilan N cagri):
//   OK          her cagri yanitlandi VE hepsi `[]` dondu (taze profilde bagli dapp yok)
//   HANG        sure sonunda en az bir cagri HIC yanitlanmadi (K2'nin kendisi)
//   ERROR       yanit geldi ama hata ya da `[]` olmayan sonuc (K1 "bos yanit" -32603 gibi)
//   NOPROVIDER  atis aninda window.ethereum yoktu (icerik betigi hic enjekte edilmedi)
//   SLOW        sure doldu ama yanit sonradan GELDI (kayip degil, yavas: SW soguk baslangici); HANG'dan ayri sayilir

export function classifyRun(calls, { timedOut }) {
  if (!Array.isArray(calls) || calls.length === 0) return 'NOPROVIDER'
  if (calls.some((c) => c && c.status === 'NOPROVIDER')) return 'NOPROVIDER'
  const pending = calls.filter((c) => !c || !c.done)
  if (pending.length > 0) return timedOut ? 'HANG' : 'PENDING'
  const bad = calls.some((c) => c.status !== 'OK' || !Array.isArray(c.result) || c.result.length !== 0)
  return bad ? 'ERROR' : 'OK'
}

export function summarize(runs) {
  const s = { n: runs.length, OK: 0, HANG: 0, SLOW: 0, ERROR: 0, NOPROVIDER: 0, PENDING: 0, SCRIPT_ERROR: 0 }
  for (const r of runs) s[r.status] = (s[r.status] || 0) + 1
  s.hangRate = s.n === 0 ? 0 : s.HANG / s.n
  // "Sifir askida" tek basina yetmez: 0/30 icin %95 ust sinir ~%9.5 (uc kurali 3/n).
  // %40 gibi bir gercek oranin 30 kosuda hic gorunmeme olasiligi 0.6^30 ~ 2e-7.
  s.ruleOfThreeUpper95 = s.n === 0 ? 1 : Math.min(1, 3 / s.n)
  s.pNoHangIfRate40 = Math.pow(0.6, s.n)
  return s
}

export function formatSummary(label, s) {
  return `${label}: N=${s.n} OK=${s.OK} HANG=${s.HANG} SLOW=${s.SLOW} ERROR=${s.ERROR} NOPROVIDER=${s.NOPROVIDER} SCRIPT_ERROR=${s.SCRIPT_ERROR}`
    + ` | hang orani ${(s.hangRate * 100).toFixed(1)}%`
    + (s.HANG === 0 ? ` (95% ust sinir ~${(s.ruleOfThreeUpper95 * 100).toFixed(1)}%; gercek %40 ise hic gorunmeme olasiligi ${s.pNoHangIfRate40.toExponential(1)})` : '')
}

const DEFAULTS = {
  runs: 30, timeoutMs: 8000, pre: 'none', fire: 'head', state: 'fresh', burst: 1,
  settleMs: 4000, fireDelayMs: 1500, popup: false, instrument: false, source: 'head',
  dist: '', out: '', cleanup: '', keep: false, headed: false, wt: '', chrome: '',
}
export const PRE_MODES = ['none', 'sw-ready', 'settle', 'sw-stopped', 'sw-idle']
export const FIRE_MODES = ['head', 'dcl', 'load', 'delay']
export const STATE_MODES = ['fresh', 'has-vault']

export function parseArgs(argv) {
  const o = { ...DEFAULTS }
  const num = (k, v) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${k} sayi olmali: ${v}`); return n }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} bir deger ister`); i += 1; return argv[i] }
    switch (a) {
      case '--runs': o.runs = num(a, next()); break
      case '--timeout-ms': o.timeoutMs = num(a, next()); break
      case '--pre': o.pre = next(); break
      case '--fire': o.fire = next(); break
      case '--state': o.state = next(); break
      case '--burst': o.burst = num(a, next()); break
      case '--settle-ms': o.settleMs = num(a, next()); break
      case '--fire-delay-ms': o.fireDelayMs = num(a, next()); break
      case '--popup': o.popup = true; break
      case '--instrument': o.instrument = true; break
      case '--source': o.source = next(); break
      case '--dist': o.dist = next(); break
      case '--out': o.out = next(); break
      case '--cleanup': o.cleanup = next(); break
      case '--keep': o.keep = true; break
      case '--headed': o.headed = true; break
      case '--wt': o.wt = next(); break
      case '--chrome': o.chrome = next(); break
      default: throw new Error(`bilinmeyen secenek: ${a}`)
    }
  }
  if (!PRE_MODES.includes(o.pre)) throw new Error(`--pre ${PRE_MODES.join('|')} olmali: ${o.pre}`)
  if (!FIRE_MODES.includes(o.fire)) throw new Error(`--fire ${FIRE_MODES.join('|')} olmali: ${o.fire}`)
  if (!STATE_MODES.includes(o.state)) throw new Error(`--state ${STATE_MODES.join('|')} olmali: ${o.state}`)
  if (!['head', 'worktree'].includes(o.source)) throw new Error(`--source head|worktree olmali: ${o.source}`)
  if (o.runs < 1 || !Number.isInteger(o.runs)) throw new Error('--runs pozitif tam sayi olmali')
  if (o.burst < 1 || !Number.isInteger(o.burst)) throw new Error('--burst pozitif tam sayi olmali')
  return o
}

// Sayfa tarafi kosum betigi. `fire` modu atis ANINI belirler; atis eth_accounts x burst (Lab acilista iki tane atar).
export function buildPageHtml({ fire, burst, fireDelayMs }) {
  const trigger = fire === 'head' ? 'fire();'
    : fire === 'dcl' ? "document.addEventListener('DOMContentLoaded', fire);"
      : fire === 'load' ? "window.addEventListener('load', fire);"
        : `setTimeout(fire, ${Number(fireDelayMs)});`
  const body = `
var K = window.__k2 = { t0: Date.now(), fireMode: ${JSON.stringify(fire)}, calls: [], firedAt: 0, readyStateAtFire: '' };
function fire() {
  K.firedAt = Date.now(); K.readyStateAtFire = document.readyState;
  K.providerAtFire = !!(window.ethereum && typeof window.ethereum.request === 'function');
  for (var i = 0; i < ${Number(burst)}; i += 1) (function (idx) {
    var c = { idx: idx, done: false, status: '', result: null, error: null, ms: 0 };
    K.calls.push(c);
    if (!K.providerAtFire) { c.done = true; c.status = 'NOPROVIDER'; return }
    var t = Date.now();
    window.ethereum.request({ method: 'eth_accounts' }).then(
      function (r) { c.done = true; c.status = 'OK'; c.result = r; c.ms = Date.now() - t },
      function (e) { c.done = true; c.status = 'ERROR'; c.error = { code: e && e.code, message: e && e.message }; c.ms = Date.now() - t }
    );
  })(i);
}
${trigger}
`
  return `<!doctype html><html><head><meta charset="utf-8"><title>k2</title><script>${body}</script></head><body>k2</body></html>`
}

// Zaman cizelgesi: (sayfa, icerik betigi, SW) kayitlarini ayni saatle (Date.now) birlestirir; t0 = gezinme baslangici.
export function mergeTimeline(navAt, ...sources) {
  const rows = []
  for (const list of sources) for (const e of list || []) if (e && Number.isFinite(e.at)) rows.push({ t: e.at - navAt, src: e.src, ev: e.ev, detail: e.detail })
  return rows.sort((a, b) => a.t - b.t)
}

// Askida kalan kosunun ZAMAN CIZELGESINDEN halka teshisi (plan Faz 3 karar tablosu). Yalniz ILK istegi izler.
//   A  icerik betigi istegi HIC almadi VE dinleyici istekten SONRA kuruldu (ya da hic kurulmadi)  -> Dal A
//   A? icerik betigi zaten dinliyordu ama almadi (cerceve/dunya uyumsuzlugu)                      -> ENGELLI
//   B  icerik betigi aldi + sendMessage cagirdi, SW onMessage'e HIC girmedi                       -> Dal B (platform) ENGELLI raporu
//   C  SW onMessage'e girdi ama sendResponse yapmadi                                              -> Dal C (background.js)
//   E  SW sendResponse yapti ama icerik betigine geri cagri ulasmadi / sayfaya yanit gitmedi      -> ENGELLI
//   D  sayfa tarafinda istek kaydi bile yok (saglayici/betik yuklenmedi)                          -> ENGELLI
export function diagnoseTimeline(rows) {
  const list = Array.isArray(rows) ? rows : []
  const firstPost = list.find((r) => r.src === 'inj' && r.ev === 'request-post')
  if (!firstPost) return { verdict: 'D', why: 'injected request-post kaydi yok' }
  const [method, idPart] = String(firstPost.detail).split(' #')
  const id = idPart
  const forId = (src, ev) => list.find((r) => r.src === src && r.ev === ev && String(r.detail).includes(`#${id}`))
  const got = forId('content', 'got-message')
  const call = forId('content', 'sendMessage-call')
  const cb = forId('content', 'sendMessage-cb')
  const listener = list.find((r) => r.src === 'content' && r.ev === 'listener-registering')
  const swEnter = list.find((r) => r.src === 'sw' && r.ev === 'onMessage-enter' && r.detail === method && r.t >= firstPost.t)
  const swResp = list.find((r) => r.src === 'sw' && r.ev === 'sendResponse' && r.detail === method && r.t >= firstPost.t)
  const facts = { id, method, postAt: firstPost.t, listenerAt: listener ? listener.t : null, gotAt: got ? got.t : null, callAt: call ? call.t : null, cbAt: cb ? cb.t : null, swEnterAt: swEnter ? swEnter.t : null, swRespAt: swResp ? swResp.t : null }
  if (!got) {
    const late = !listener || listener.t > firstPost.t
    return { verdict: late ? 'A' : 'A?', why: late ? 'icerik betigi dinleyicisi istekten SONRA kuruldu (ya da hic kurulmadi)' : 'dinleyici istekten ONCE kuruluydu ama mesaj alinmadi', facts }
  }
  if (!swEnter) return { verdict: 'B', why: 'icerik betigi sendMessage cagirdi, SW onMessage kaydi yok', facts }
  if (!swResp) return { verdict: 'C', why: 'SW onMessage girdi, sendResponse kaydi yok', facts }
  return { verdict: 'E', why: 'SW yanitladi ama sayfaya yanit ulasmadi', facts }
}
