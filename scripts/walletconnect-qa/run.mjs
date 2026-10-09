// WalletConnect QA harness'i -- ana betik (spec bolum 12, S1-S9).
//
//   cd client && node scripts/walletconnect-qa/run.mjs --selftest   # cevrimdisi birim sinamalari (tarayicisiz)
//   cd client && node scripts/walletconnect-qa/run.mjs               # KURU KOSU (= --dry): S1-S5, yerel dapp, Lab YOK
//   cd client && node scripts/walletconnect-qa/run.mjs --live        # F1-F14, gercek Lab (T16)
//
// Secenekler: --phase hermetic|realrpc|all (live varsayilan all), --source head|worktree (varsayilan head,
// spec S1), --dist <dizin> (derlemeyi atla, hazir dist kullan; yalniz gelistirme), --headed, --only F3,F4,
// --out <dizin>, --keep (scratch'i silme), --chrome <yol>, --api-port <n> (stub HTTP portunu sabitle;
// --dist ile BIRLIKTE, o dist'in derlendigi portla ayni olmali).
//
// DEGISMEZLER: `npm run build` ve ana klasorde HICBIR derleme YOK; derleme yalniz SCRATCH kopyada
// (`git archive HEAD client` veya --source worktree). WT'ye (ve ana klasore) yazilmaz; kanit git DISI
// `.superpowers/sdd/walletconnect-qa/` altina gider. Hicbir tohum/parola kanita yazilmaz.
import { execFileSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Browser, findChrome } from './browser.mjs'
import { NetworkGuard, rpcHostsOf, selfTest as guardSelfTest } from './backend-guard.mjs'
import { createRpcMock, selfTest as rpcSelfTest } from './rpc-mock.mjs'
import { ensureTlsCert, startStub, selfTest as stubSelfTest } from './bundler-stub.mjs'
import { createClientLoader, createSeedPlan, seedExtension, unlockViaLogin, selfTest as seedSelfTest } from './seed-vault.mjs'
import { APPROVAL_PACE_MS, DEEP_SCRIPT, DRY_DAPP_HOST, DRY_DAPP_HTML, DRY_FLOWS, FLOWS, PROVIDER_LOG_SCRIPT, runFlows, uiText } from './flows.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CLIENT_ROOT = resolve(HERE, '../..')
export const REPO_ROOT = resolve(CLIENT_ROOT, '..')
const LAB_URL = 'https://lab.reown.com/appkit?name=wagmi'
const ALLOWED_BUILD_HOSTS = new Set(['https://watswallet.com', 'https://watswallet.com/logo.png', 'https://bundler.watswallet.com'])

// flows.mjs'in kullandigi tum i18n anahtarlari: selftest bunlarin en.json'da var oldugunu kilitler.
export const REQUIRED_I18N_KEYS = [
  'dapps.connect.title', 'dapps.connect.btn_connect', 'dapps.sign.title', 'dapps.sign.btn_sign',
  'dapps.switchChain.title', 'dapps.switchChain.btn_switch', 'header.connected', 'send.confirmTransaction.confirmTx',
  'send.confirmTransaction.cancel', 'header.disconnect',
]

export function parseArgs(argv) {
  const a = { mode: 'dry', apiPort: 0, phase: null, source: 'head', dist: null, headed: false, only: null, out: null, keep: false, chrome: null }
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]
    const v = () => {
      const x = argv[++i]
      if (x === undefined || x.startsWith('--')) throw new Error(`${k} icin deger eksik`)
      return x
    }
    if (k === '--selftest') a.mode = 'selftest'
    else if (k === '--dry') a.mode = 'dry'
    else if (k === '--live') a.mode = 'live'
    else if (k === '--phase') a.phase = v()
    else if (k === '--source') a.source = v()
    else if (k === '--dist') a.dist = resolve(v())
    else if (k === '--headed') a.headed = true
    else if (k === '--only') a.only = v().split(',').map((x) => x.trim()).filter(Boolean)
    else if (k === '--out') a.out = resolve(v())
    else if (k === '--api-port') {
      const raw = v()
      a.apiPort = Number(raw)
      if (!Number.isInteger(a.apiPort) || a.apiPort < 1 || a.apiPort > 65535) throw new Error(`--api-port gecersiz: ${raw} (1-65535 tam sayi)`)
    } else if (k === '--keep') a.keep = true
    else if (k === '--chrome') a.chrome = v()
    else throw new Error(`bilinmeyen secenek: ${k}`)
  }
  // Yazim hatasi sahte yesil uretmesin: bos akis kumesi "GECTI" sayilmaz.
  if (a.phase !== null && !['hermetic', 'realrpc', 'all'].includes(a.phase)) throw new Error(`--phase gecersiz: ${a.phase} (hermetic|realrpc|all)`)
  if (!['head', 'worktree'].includes(a.source)) throw new Error(`--source gecersiz: ${a.source} (head|worktree)`)
  if (a.only && !a.only.length) throw new Error('--only bos')
  return a
}

// Calistirilacak akislar (secili faz + --only suzgeci). Eslesmeyen --only kimligi hata sayilir.
export function plannedFlows(args) {
  const pick = (list) => list.filter((f) => !args.only || args.only.includes(f.id))
  const phases = args.phase && args.phase !== 'all' ? [args.phase] : ['hermetic', 'realrpc']
  const plan = args.mode === 'dry'
    ? [{ phase: 'hermetic', flows: pick(DRY_FLOWS) }]
    : phases.map((phase) => ({ phase, flows: pick(FLOWS.filter((f) => f.phase === phase)) }))
  const planned = new Set(plan.flatMap((p) => p.flows.map((f) => f.id)))
  const unmatched = (args.only || []).filter((id) => !planned.has(id))
  return { plan, unmatched }
}

const log = (m) => console.log(`[qa ${new Date().toISOString().slice(11, 19)}] ${m}`)

// --- WT'nin kirlenmedigini kanitlayan anlik goruntu (S8) ---
// Paralel calisan baska ajanlar/oturumlar ayni WT'de dosya duzenleyebilir; bu yuzden YALNIZ harness'in
// kirletebilecegi yollar (client/dist, client/release, client/node_modules) karsilastirilir. Tam `git status`
// farki bilgi amacli `wtStatusDelta` olarak summary.json'a yazilir, basarisizlik nedeni SAYILMAZ.
const HARNESS_PATH = /^.. "?client\/(dist|release|node_modules)(\/|"|$)/
function snapshotTree() {
  let status = 'git-yok'
  try { status = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], { encoding: 'utf8' }) } catch { /* depo disinda (gelistirme) */ }
  const listDir = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).map((f) => `${f}:${statSync(join(d, f)).mtimeMs}`).sort() : null)
  return {
    status,
    harnessStatus: status.split('\n').filter((l) => HARNESS_PATH.test(l)),
    nodeModules: existsSync(join(CLIENT_ROOT, 'node_modules', 'vite')),
    dist: listDir(join(CLIENT_ROOT, 'dist')),
    release: listDir(join(CLIENT_ROOT, 'release')),
  }
}

export function treeChanged(before, after) {
  const key = (t) => JSON.stringify({ h: t.harnessStatus, n: t.nodeModules, d: t.dist, r: t.release })
  return key(before) !== key(after)
}

function statusDelta(before, after) {
  const a = new Set(before.status.split('\n').filter(Boolean))
  const b = new Set(after.status.split('\n').filter(Boolean))
  return { added: [...b].filter((l) => !a.has(l)), removed: [...a].filter((l) => !b.has(l)) }
}

// Bos bir portu isletim sisteminden ister (rastgele sayi iki kosuyu carpistirabilirdi).
function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolvePort(port))
    })
  })
}

// Kanit klasorunde GIZLI deger (parola) gecmediginden emin ol. Kosunun KENDI urettigi gizliler verilir.
export function findSecrets(dir, secrets) {
  const hits = []
  if (!existsSync(dir)) return hits
  for (const f of walk(dir)) {
    if (!/\.(json|log|md|txt)$/.test(f)) continue
    const text = readFileSync(f, 'utf8')
    for (const sec of secrets) if (sec && text.includes(sec)) hits.push(f)
  }
  return hits
}

// --- S1: scratch kopya + derleme ---
export function removeJunction(p) {
  try { rmdirSync(p) } catch { /* yok veya zaten kaldirildi */ }
}

export function prepareScratchClient({ scratch, source, repoRoot = REPO_ROOT, clientRoot = CLIENT_ROOT }) {
  const dest = join(scratch, 'client')
  mkdirSync(scratch, { recursive: true })
  if (source === 'head') {
    const tarball = join(scratch, 'client.tar')
    execFileSync('git', ['-C', repoRoot, 'archive', '--format=tar', `--output=${tarball}`, 'HEAD', 'client'])
    // GNU tar (Git Bash) `C:` ile baslayan yolu uzak makine sanir: goreli ad + cwd kullan.
    execFileSync('tar', ['-xf', 'client.tar'], { cwd: scratch })
  } else {
    // worktree: izlenen + izlenmeyen-ama-yok-sayilmayan dosyalar (commit EDILMEMIS calismayi sinamak icin)
    const files = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', 'client'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    for (const f of files) {
      const from = join(repoRoot, f)
      if (!existsSync(from)) continue
      mkdirSync(dirname(join(scratch, f)), { recursive: true })
      cpSync(from, join(scratch, f))
    }
  }
  // node_modules: WT'nin kurulu paketlerine baglanti (junction). Silerken YALNIZ baglanti kaldirilir.
  symlinkSync(join(clientRoot, 'node_modules'), join(dest, 'node_modules'), 'junction')
  return dest
}

export function buildExtension({ scratchClient, apiBase }) {
  const env = { ...process.env, VITE_API_URL: apiBase, VITE_BUNDLER_BASE: apiBase }
  // Cikti yakalanir: derleme hatasinda derleyici mesajinin SONU gosterilir ("Command failed" tek basina ise yaramaz).
  const step = (stepArgs, timeout) => {
    try {
      execFileSync(process.execPath, stepArgs, { cwd: scratchClient, env, stdio: 'pipe', maxBuffer: 256 * 1024 * 1024, timeout })
    } catch (e) {
      const tail = `${e.stdout || ''}\n${e.stderr || ''}`.trim().split('\n').slice(-40).join('\n')
      throw new Error(`derleme adimi basarisiz (${stepArgs[0]}): ${String(e.message).split('\n')[0]}\n--- cikti sonu ---\n${tail}`)
    }
  }
  step(['scripts/gen-wallet-standard-metadata.mjs'], 120000)
  step(['node_modules/vite/bin/vite.js', 'build'], 600000)
  return join(scratchClient, 'dist')
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// Derleme sonrasi: (1) VITE_API_URL gercekten islendi mi, (2) hangi watswallet.com adresleri gomulu.
export function scanDist(distDir, apiBase) {
  const files = walk(distDir).filter((f) => /\.(js|html|json|css)$/.test(f))
  const found = new Set()
  let apiBaseHits = 0
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    if (text.includes(apiBase)) apiBaseHits += 1
    for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]*watswallet\.com[^"'`\\\s)]*/gi)) found.add(m[0])
  }
  const unexpected = [...found].filter((u) => !ALLOWED_BUILD_HOSTS.has(u))
  return { apiBase, apiBaseHits, ok: apiBaseHits > 0, watswalletUrls: [...found].sort(), unexpected }
}

// --- selftest ---
async function selfTestAll() {
  const chains = JSON.parse(readFileSync(join(CLIENT_ROOT, 'src/data/supported_chains.json'), 'utf8'))
  const tmp = join(tmpdir(), `wc-qa-selftest-${Date.now().toString(36)}`)
  mkdirSync(tmp, { recursive: true })
  const lines = []
  lines.push(guardSelfTest())
  lines.push(await rpcSelfTest(chains))
  lines.push(await stubSelfTest({ rpcMock: createRpcMock({ chains }), tmpDir: join(tmp, 'tls') }))
  lines.push(await seedSelfTest({ clientRoot: CLIENT_ROOT, cacheDir: join(tmp, 'vitecache') }))
  const en = JSON.parse(readFileSync(join(CLIENT_ROOT, 'src/i18n/locales/en.json'), 'utf8'))
  for (const k of REQUIRED_I18N_KEYS) {
    if (typeof uiText(en, k) !== 'string') throw new Error(`en.json'da anahtar yok: ${k} (flows.mjs buna dayanir)`)
  }
  // kanit gizlilik denetimi
  const sdir = join(tmp, 'secretcheck')
  mkdirSync(sdir, { recursive: true })
  writeFileSync(join(sdir, 'a.json'), JSON.stringify({ ok: 'temiz' }))
  if (findSecrets(sdir, ['qa-gizli-parola']).length !== 0) throw new Error('findSecrets yanlis pozitif')
  writeFileSync(join(sdir, 'b.json'), JSON.stringify({ sizinti: 'x qa-gizli-parola y' }))
  if (findSecrets(sdir, ['qa-gizli-parola']).length !== 1) throw new Error('findSecrets sizintiyi yakalamadi')
  lines.push('kanit gizlilik denetimi (findSecrets): tum sinama vakalari gecti')
  lines.push(`i18n: ${REQUIRED_I18N_KEYS.length} anahtar en.json'da var`)
  // Onay penceresi kisiti (T4a/T8/T9: ayni origin 10 sn'de 3): ardisik 4 hak harcayan istek arasindaki 3 aralik 10 sn'yi asmali.
  if (!(APPROVAL_PACE_MS * 3 > 10000)) throw new Error(`APPROVAL_PACE_MS=${APPROVAL_PACE_MS} yetersiz: 3 x aralik > 10000 ms olmali (onay penceresi kisiti -32005)`)
  lines.push(`onay kisiti aralamasi: ${APPROVAL_PACE_MS} ms (3 aralik ${APPROVAL_PACE_MS * 3} ms > 10000)`)
  // T11'in ekledigi typed data anahtarlari (F4 buna dayanir): henuz yoksa uyari, varsa bicim kilidi.
  const std = en.dapps && en.dapps.signTypedData
  if (!std) lines.push('UYARI: en.json dapps.signTypedData.* henuz YOK (T11 inmemis); F4 bu surumde calismaz')
  else {
    if (typeof std.title !== 'string') throw new Error('en.json dapps.signTypedData.title yok (F4 baslik bekler)')
    if (!Object.keys(std).some((k) => /^btn_.*sign/i.test(k))) throw new Error('en.json dapps.signTypedData altinda btn_*sign* anahtari yok (F4 imza dugmesini buradan bulur)')
    lines.push('i18n: dapps.signTypedData.title ve imza dugmesi anahtari var')
  }
  // Arguman dogrulamasi ve sahte-yesil korumalari
  const throws = (fn, label) => { let t = false; try { fn() } catch { t = true } if (!t) throw new Error(`parseArgs ${label} icin hata vermedi`) }
  throws(() => parseArgs(['--phase', 'typo']), '--phase typo')
  throws(() => parseArgs(['--source', 'main']), '--source main')
  throws(() => parseArgs(['--api-port', 'abc']), '--api-port abc')
  throws(() => parseArgs(['--api-port', '1.5']), '--api-port 1.5')
  throws(() => parseArgs(['--only']), '--only (deger yok)')
  if (plannedFlows(parseArgs(['--live', '--only', 'F99'])).unmatched.join() !== 'F99') throw new Error('plannedFlows eslesmeyen --only kimligini bulamadi')
  if (plannedFlows(parseArgs(['--live', '--phase', 'hermetic', '--only', 'F6'])).unmatched.join() !== 'F6') throw new Error('plannedFlows faz disi --only kimligini bulamadi')
  if (plannedFlows(parseArgs(['--dry'])).plan[0].flows.length === 0) throw new Error('kuru kosu akis kumesi bos')
  const t0 = { status: '', harnessStatus: [], nodeModules: true, dist: null, release: null }
  if (treeChanged(t0, { ...t0, status: ' M client/src/baska-ajan.js' })) throw new Error('treeChanged baska ajanin duzenlemesini harness kirliligi sandi')
  if (!treeChanged(t0, { ...t0, harnessStatus: ['?? client/release/x.zip'] })) throw new Error('treeChanged release kirliligini yakalamadi')
  lines.push('arguman dogrulamasi ve WT karsilastirmasi: tum sinama vakalari gecti')
  rmSync(tmp, { recursive: true, force: true })
  return lines
}

// --- ortam: scratch, derleme, stub ---
// Ortami kurar. Kurulum ORTASINDA hata olursa (ornegin dist taramasi) stub/yukleyici/scratch temizlenir:
// aksi halde acik dinleyiciler Node surecinin kapanmasini engeller ve kosu sonsuza dek asili kalir.
async function startEnvironment(args, outDir) {
  const state = { scratch: null, scratchClient: null, stub: null, loader: null }
  try {
    return await buildEnvironment(args, outDir, state)
  } catch (e) {
    await disposeEnvironment(state, args.keep).catch(() => {})
    throw e
  }
}

async function buildEnvironment(args, outDir, state) {
  const stamp = Date.now().toString(36)
  const scratch = process.env.QA_SCRATCH ? resolve(process.env.QA_SCRATCH, `wc-qa-${stamp}`) : join(tmpdir(), `wc-qa-${stamp}`)
  mkdirSync(scratch, { recursive: true })
  state.scratch = scratch
  const chains = JSON.parse(readFileSync(join(CLIENT_ROOT, 'src/data/supported_chains.json'), 'utf8'))
  const rpcHosts = [...rpcHostsOf(chains)]
  const rpcMock = createRpcMock({ chains })
  const tls = ensureTlsCert(join(scratch, 'tls'))

  // Once stub (port derleme ortamina girer), sonra derleme, sonra yukleyici (atsConfig/gasless icin).
  let loader = null
  const hooks = { paymasterFor: () => `0x${'ab'.repeat(20)}`, userOpHashFn: null }
  const stub = await startStub({
    rpcMock, tls, httpPort: args.apiPort,
    pages: { [DRY_DAPP_HOST]: { '/': { type: 'text/html', body: DRY_DAPP_HTML } } },
    paymasterFor: (c, x) => hooks.paymasterFor(c, x),
    userOpHashFn: (uo, c) => (hooks.userOpHashFn ? hooks.userOpHashFn(uo, c) : null),
  })
  state.stub = stub
  const apiBase = `http://127.0.0.1:${stub.httpPort}`
  let scratchClient = null
  let dist = args.dist
  if (!dist) {
    log(`S1: scratch kopya (${args.source}) ve derleme (bu ~1 dk surer)`)
    scratchClient = prepareScratchClient({ scratch, source: args.source })
    state.scratchClient = scratchClient
    dist = buildExtension({ scratchClient, apiBase })
  }
  const dscan = scanDist(dist, apiBase)
  writeFileSync(join(outDir, 'dist-scan.json'), JSON.stringify(dscan, null, 2))
  if (!dscan.ok) throw new Error(`DURDURULDU: dist icinde ${apiBase} yok; VITE_API_URL islenmemis, uzanti URETIM sunucusuna konusabilir. (--dist ile verilen dist farkli bir porta derlenmis olabilir.)`)
  if (dscan.unexpected.length) log(`UYARI: beklenmeyen watswallet.com adresleri dist'te: ${dscan.unexpected.join(', ')} (DNS eslemesi hepsini yerele cevirir, yine de kanitta)`)

  loader = await createClientLoader({ clientRoot: scratchClient || CLIENT_ROOT, cacheDir: join(scratch, 'vitecache') })
  state.loader = loader
  try {
    const atsCfg = await loader.load('/src/utils/atsConfig.js')
    const gasless = await loader.load('/src/utils/sdk/gasless.ts')
    hooks.paymasterFor = (chainId, crosschain) => {
      const c = atsCfg.ATS_CHAINS[chainId]
      return (crosschain && c && c.remotePaymaster) || (c && c.paymaster) || `0x${'ab'.repeat(20)}`
    }
    hooks.userOpHashFn = (uo, chainId) => {
      const addr = gasless.addressesFor(chainId)
      return gasless.computeUserOpHash(uo, { chainId: BigInt(chainId), entryPoint: addr.entryPoint, ...(uo.initCode === '0x' ? {} : { eip7702Delegate: addr.delegate }) })
    }
  } catch (e) {
    log(`UYARI: ATS taklit yardimcilari yuklenemedi (${e.message}); stub genel paymaster adresiyle calisir`)
  }
  return { scratch, scratchClient, dist, chains, rpcHosts, rpcMock, stub, loader, apiBase, tls }
}

async function disposeEnvironment(env, keep) {
  try { if (env.stub) await env.stub.close() } catch { /* kapali */ }
  try { if (env.loader) await env.loader.close() } catch { /* kapali */ }
  if (keep || !env.scratch) return
  if (env.scratchClient) removeJunction(join(env.scratchClient, 'node_modules'))
  try {
    rmSync(env.scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (e) { log(`UYARI: scratch silinemedi (${e.code}): ${env.scratch} elle silinmeli`) }
  if (!existsSync(join(CLIENT_ROOT, 'node_modules', 'vite'))) throw new Error('KRITIK: WT node_modules silinmis gorunuyor (junction temizligi hatali)')
}

// --- bir faz: tarayici + tohum + akislar ---
async function runPhase({ phase, flows, env, args, outDir, en }) {
  const phaseDir = join(outDir, phase)
  mkdirSync(join(phaseDir, 'screens'), { recursive: true })
  const guard = new NetworkGuard({ phase, rpcHosts: new Set(env.rpcHosts) })
  const hostNames = ['*.watswallet.com', 'watswallet.com', DRY_DAPP_HOST, ...(phase === 'hermetic' ? env.rpcHosts : [])]
  const hostRules = hostNames.map((h) => `MAP ${h} 127.0.0.1:${env.stub.httpsPort}`).join(', ')
  const debugPort = await freePort()
  log(`faz ${phase}: tarayici baslatiliyor (port ${debugPort})`)
  const browser = await Browser.launch({
    chrome: findChrome(args.chrome), extensionDir: env.dist, profileDir: join(env.scratch, `profile-${phase}`), debugPort,
    hostRules, headed: args.headed, onNetwork: (origin, sid, msg) => guard.handle(origin, sid, msg),
  })
  const result = { phase, flows: [], deviations: [] }
  let seed = null
  let flowErr = null
  try {
    seed = await createSeedPlan({ loader: env.loader, accountCount: 2 })
    if (!(await seed.verify())) throw new Error('tohum kasasi kendi modulunde dogrulanamadi')
    env.rpcMock.fund(seed.accounts[0].address, 10n ** 18n)
    env.rpcMock.fund(seed.accounts[1].address, 10n ** 18n)
    await seedExtension(() => browser.sw(), seed)
    log(`  tohum yazildi (adresler: ${seed.accounts.map((a) => a.address).join(', ')})`)

    // GERCEK Login ekranindan kilit ac, sonra popup sekmesini KAPAT (bkz. browser.mjs TUZAK).
    const popup = await browser.openPopupTab()
    await unlockViaLogin(popup, seed.password)
    await browser.closeTarget(popup.targetId)

    const shot = async (session, name) => {
      const f = join(phaseDir, 'screens', `${name}.png`)
      await session.screenshot(f)
      return relative(outDir, f).replaceAll('\\', '/')
    }
    const openDapp = async (url) => {
      const page = await browser.openPage('about:blank')
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PROVIDER_LOG_SCRIPT })
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: DEEP_SCRIPT })
      await page.send('Page.navigate', { url })
      await page.waitFor(`document.readyState === 'complete'`, { timeout: 60000, label: `${url} yuklendi` })
      return page
    }
    const ctx = {
      browser, seed, stub: env.stub, rpcMock: env.rpcMock, outDir: phaseDir, en, log, shot, openDapp, phase,
      labUrl: LAB_URL, dapp: null,
    }
    if (args.mode === 'dry') ctx.dapp = await openDapp(`https://${DRY_DAPP_HOST}/`)
    result.flows = await runFlows(flows, ctx, args.only)
  } catch (e) {
    flowErr = e
  }
  // Kanit yazimi ve sizinti denetimi HATA verse bile tarayici/profil temizligi MUTLAKA calisir (aksi halde Chrome ve
  // CDP soketi sizar, Node sureci takili kalir). Sizinti hatasi toplanir, temizlikten SONRA firlatilir.
  let leakErr = null
  let evidenceErr = null
  try {
    const swLogs = []
    for (const s of browser.sessions.values()) if (s.logs.length) swLogs.push({ origin: s.origin, url: s.url.slice(0, 120), logs: s.logs.slice(0, 200) })
    writeFileSync(join(phaseDir, 'extension-console.json'), JSON.stringify(swLogs, null, 2))
    await new Promise((r) => setTimeout(r, 1500)) // son ag olaylari akissin
    const report = guard.report()
    writeFileSync(join(phaseDir, 'network-report.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(phaseDir, 'stub-summary.json'), JSON.stringify({ ...env.stub.summary(), sponsorCalls: env.stub.sponsorCalls, userOps: env.stub.userOps }, null, 2))
    writeFileSync(join(phaseDir, 'rpc-log.json'), JSON.stringify({ unknown: env.rpcMock.unknown(), answeredCount: env.rpcMock.log().filter((l) => l.kind === 'answered').length }, null, 2))
    result.network = { ok: report.ok, counts: report.counts, violations: report.violations.length, staticHosts: report.staticHosts, rpcHostsSeen: report.rpcHostsSeen }
    writeFileSync(join(phaseDir, 'flows.json'), JSON.stringify(result.flows, null, 2))
    const leaked = seed ? findSecrets(outDir, [seed.password]) : []
    if (leaked.length) leakErr = new Error(`GIZLILIK IHLALI: parola kanit dosyalarinda bulundu: ${leaked.join(', ')}`)
  } catch (e) {
    evidenceErr = e
  } finally {
    await browser.close()
    await new Promise((r) => setTimeout(r, 1500)) // Chrome dosya kilitlerini birakana kadar
    try {
      rmSync(join(env.scratch, `profile-${phase}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    } catch (e) { log(`UYARI: profil silinemedi (${e.code}); scratch temizligi sonunda tekrar denenecek`) }
  }
  if (leakErr) throw leakErr
  if (flowErr) throw flowErr
  if (evidenceErr) throw evidenceErr
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'selftest') {
    for (const l of await selfTestAll()) console.log(l)
    console.log('SELFTEST: GECTI')
    return 0
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = args.out || join(REPO_ROOT, '.superpowers/sdd/walletconnect-qa', args.mode === 'live' ? 'live-run' : `dry-run/${stamp}`)
  mkdirSync(outDir, { recursive: true })
  const en = JSON.parse(readFileSync(join(CLIENT_ROOT, 'src/i18n/locales/en.json'), 'utf8'))
  const before = snapshotTree()
  let head = 'git-yok'
  try { head = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* depo disinda */ }
  writeFileSync(join(outDir, 'run-info.json'), JSON.stringify({ mode: args.mode, source: args.source, head, node: process.version, startedAt: new Date().toISOString(), dirtyBefore: before.status.split('\n').filter(Boolean) }, null, 2))

  // Eslesmeyen --only kimligi / bos akis kumesi: derlemeye baslamadan DUR (sahte yesil olmasin).
  const { plan, unmatched } = plannedFlows(args)
  if (unmatched.length) throw new Error(`--only kimlikleri secili modda/fazda hicbir akisla eslesmiyor: ${unmatched.join(', ')}`)
  if (!plan.some((p) => p.flows.length)) throw new Error('calistirilacak akis yok (--phase/--only kombinasyonunu kontrol edin)')
  const env = await startEnvironment(args, outDir)
  const phases = []
  try {
    for (const { phase, flows } of plan) {
      if (flows.length) phases.push(await runPhase({ phase, flows, env, args, outDir, en }))
    }
  } finally {
    await disposeEnvironment(env, args.keep)
  }
  const after = snapshotTree()
  const clean = !treeChanged(before, after)
  const executed = phases.reduce((n, p) => n + p.flows.length, 0)
  const summary = { phases: phases.map((p) => ({ phase: p.phase, flows: p.flows.map((f) => ({ id: f.id, status: f.status, detail: f.detail })), network: p.network })), flowsExecuted: executed, wtUnchanged: clean, wtStatusDelta: statusDelta(before, after) }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  const fail = executed === 0 || phases.some((p) => p.flows.some((f) => f.status === 'FAIL') || (p.network && !p.network.ok)) || !clean
  console.log(fail ? 'SONUC: KALDI (bkz. summary.json)' : 'SONUC: GECTI (DEVIATION satirlari sapma olarak README\'ye yazilir)')
  return fail ? 1 : 0
}

// Yalnizca dogrudan `node run.mjs` ile calisir; baska bir betikten import edilince (ornegin S1 denemesi) calismaz.
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().then((c) => { process.exitCode = c }).catch((e) => { console.error(`run.mjs hatasi: ${e.stack || e.message}`); process.exitCode = 1 })
}
