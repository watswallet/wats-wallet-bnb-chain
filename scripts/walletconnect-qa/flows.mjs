// WalletConnect QA harness'i -- akislar (spec bolum 12 S6 ve Ek A).
//
// Iki akis kumesi:
//   DRY_FLOWS (D1-D5) : yerel dapp sayfasi (https://dapp.qa-local.test/) ile S1-S5
//                       mekanizmalarini sinar; Lab'a BAGIMLI DEGIL. `run.mjs --dry`.
//   FLOWS (F1-F14)    : GERCEK https://lab.reown.com/appkit?name=wagmi ile bolum 4 vakalari.
//                       `run.mjs --live` (T16 kosusu).
//
// Her akis `async (ctx) => { status, detail, evidence }` doner. status: PASS | FAIL | DEVIATION
// (mekanizma beklendigi gibi calismadi ama kosu surdu; sapma README'ye yazilir).
// Akis HICBIR ZAMAN firlatmaz; yakalanan hata FAIL olarak kaydedilir.
//
// ctx: { browser, seed, stub, rpcMock, outDir, en (en.json), log(msg), shot(session, name),
//        dapp (dapp/Lab sayfa oturumu), providerLog() }
import { verifyMessage, verifyTypedData, getAddress } from 'ethers'
import { sleep } from './browser.mjs'
import { unlockViaLogin } from './seed-vault.mjs'

// ---------------------------------------------------------------------------
// Ortak yardimcilar
// ---------------------------------------------------------------------------
export const uiText = (en, key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), en)

// Sayfa dunyasinda calisir (Page.addScriptToEvaluateOnNewDocument): dapp'in provider cagrilarini
// ve olaylarini window.__qaLog / window.__qaEvents icine yazar. EIP-6963 duyurusunu ve
// window.ethereum'u yakalar; ikisi ayni nesne ise bir kez sarilir.
export const PROVIDER_LOG_SCRIPT = `(() => {
  if (window.__qaLog) return
  window.__qaLog = []
  window.__qaEvents = []
  const wrap = (p) => {
    if (!p || p.__qaWrapped || typeof p.request !== 'function') return
    try {
      const orig = p.request.bind(p)
      p.request = (args) => {
        const rec = { t: Date.now(), method: args && args.method, params: args && args.params }
        window.__qaLog.push(rec)
        return orig(args).then((r) => { rec.result = r; return r }, (e) => { rec.error = { code: e && e.code, message: e && e.message }; throw e })
      }
      p.__qaWrapped = true
      if (typeof p.on === 'function') {
        for (const ev of ['accountsChanged', 'chainChanged', 'connect', 'disconnect']) {
          p.on(ev, (d) => window.__qaEvents.push({ t: Date.now(), event: ev, data: d }))
        }
      }
    } catch (e) { window.__qaLog.push({ wrapError: String(e) }) }
  }
  window.addEventListener('eip6963:announceProvider', (e) => wrap(e.detail && e.detail.provider), true)
  const timer = setInterval(() => { if (window.ethereum) wrap(window.ethereum) }, 25)
  setTimeout(() => clearInterval(timer), 15000)
})()`

// Yerel kuru-kosu dapp'i (stub `pages` tablosuna konur).
export const FIRST_CALL_SETTLE_MS = 4000

// ONAY PENCERESI KISITI (T4a/T8/T9): cuzdan, AYNI origin'in imza/gonderim/typed data pencere acma denemesini
// kayan pencerede 10 sn'de 3 ile sinirlar. Kontrol AYRISTIRMADAN ONCE yapilir ve ok:true donen her cagri bir hak
// harcar (reddedilen cagri kaydedilmez). Ilk istekten >10 sn gecmeden gelen 4. istek `-32005 Rate limited` alir.
// Bu bir CUZDAN kusuru DEGIL, harness hizidir: hak harcayan istekler arasinda en az 3600 ms birakilir; ardisik 4
// istek arasindaki 3 aralik >= 10800 ms (> 10 sn) olur. Hak harcamayan istekler (wallet_foo_bar, okuma gecidi
// yontemleri) aralanmaz. Yeni onay isteyen bir akis eklenirse onay sonrasina `await paceApprovals()` konur.
export const APPROVAL_PACE_MS = 3600
export const paceApprovals = () => sleep(APPROVAL_PACE_MS)
const rateLimitHint = (x) => (/-32005/.test(JSON.stringify(x === undefined ? null : x)) ? ' [-32005 Rate limited: HARNESS ARALAMA hatasi (APPROVAL_PACE_MS), cuzdan kusuru DEGIL]' : '')
export const DRY_DAPP_HOST = 'dapp.qa-local.test'
export const DRY_DAPP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>WATS QA dapp</title></head>
<body><h1>WATS QA dapp</h1><pre id="out">idle</pre>
<script>
window.qa = {
  start(name, method, params) {
    window.qa[name] = window.ethereum.request({ method, params }).then((r) => ({ ok: r }), (e) => ({ err: { code: e && e.code, message: e && e.message } }))
    return true
  },
}
</script></body></html>`

// Gorunur, etkin bir dugmeyi metniyle tiklar (buyuk/kucuk harf duyarsiz, tam eslesme).
export async function clickButton(session, label, { timeout = 20000 } = {}) {
  const want = JSON.stringify(String(label).trim().toLowerCase())
  await session.waitFor(
    `[...document.querySelectorAll('button')].some((b) => b.textContent.trim().toLowerCase() === ${want} && !b.disabled)`,
    { timeout, label: `dugme '${label}' (etkin)` },
  )
  await session.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().toLowerCase() === ${want} && !x.disabled)
    b.click(); return true
  })()`)
}

export const pageHas = (session, text) =>
  session.evaluate(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(String(text).toLowerCase())})`)

const evidenceOf = async (ctx, session, name) => {
  try { return await ctx.shot(session, name) } catch { return null }
}

// Bir akisi guvenle calistirir.
async function guarded(id, title, fn, ctx) {
  const started = Date.now()
  try {
    const out = await fn(ctx)
    return { id, title, ms: Date.now() - started, ...out }
  } catch (e) {
    let targets = null
    try { targets = ctx.browser.describe() } catch { /* tani yardimci */ }
    return { id, title, ms: Date.now() - started, status: 'FAIL', detail: `istisna: ${e.message}`, evidence: { targets } }
  }
}

// ---------------------------------------------------------------------------
// Kuru kosu akislari (yerel dapp sayfasi)
// ---------------------------------------------------------------------------
export const DRY_FLOWS = [
  {
    id: 'D1', title: 'saglayici duyurulur, baglanmadan eth_accounts -> []',
    run: async (ctx) => {
      const p = ctx.dapp
      await p.waitFor(`!!(window.ethereum && window.ethereum.isWatsWallet)`, { timeout: 20000, label: 'window.ethereum (WATS) enjekte' })
      // 2026-10-05 GOZLEMI: sayfa yuklendikten HEMEN sonra (<~2 sn) atilan ILK provider istegi
      // (eth_accounts) kosularin ~%40'inda 90 sn yanitsiz kaldi; 4 sn bekleyince 6/6 kosuda cevap geldi
      // (kok neden BILINMIYOR: icerik betigi/SW baslatma yarisi olabilir; DOGRULANMADI). Harness once
      // FIRST_CALL_SETTLE_MS bekler; yine de askida kalirsa 15 sn sonra yeniden dener ve DEVIATION yazar.
      await sleep(FIRST_CALL_SETTLE_MS)
      const ask = `Promise.race([window.ethereum.request({ method: 'eth_accounts' }), new Promise((r) => setTimeout(() => r('__timeout__'), 15000))])`
      let accounts = await p.evaluate(ask)
      let retries = 0
      while (accounts === '__timeout__' && retries < 2) {
        retries += 1
        accounts = await p.evaluate(ask)
      }
      const ok = Array.isArray(accounts) && accounts.length === 0
      if (ok && retries > 0) {
        return { status: 'DEVIATION', detail: `ilk eth_accounts ${retries} kez yanitsiz kaldi (15 sn), sonraki istek [] dondu: ILK ISTEK ASKIDA GOZLEMI`, evidence: { retries } }
      }
      return { status: ok ? 'PASS' : 'FAIL', detail: `eth_accounts -> ${JSON.stringify(accounts)}`, evidence: { retries } }
    },
  },
  {
    id: 'D2', title: 'baglan: onay penceresi (#window) cikar, Connect, hesap doner',
    run: async (ctx) => {
      const { dapp: p, browser } = ctx
      await p.evaluate(`window.qa.start('connect', 'eth_requestAccounts', [])`)
      const a = await browser.waitApproval()
      await a.waitFor(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(uiText(ctx.en, 'dapps.connect.title').toLowerCase())})`, { timeout: 30000, label: 'ConnectDapp ekrani' })
      const shot = await evidenceOf(ctx, a, 'D2-connect-approval')
      await clickButton(a, uiText(ctx.en, 'dapps.connect.btn_connect'))
      const res = await p.evaluate(`window.qa.connect`)
      await browser.waitClosed(a.targetId)
      await paceApprovals() // onay penceresi kisiti (-32005): bkz. APPROVAL_PACE_MS
      const want = ctx.seed.accounts[0].address.toLowerCase()
      const ok = res.ok && res.ok.length === 1 && res.ok[0].toLowerCase() === want
      return { status: ok ? 'PASS' : 'FAIL', detail: `sonuc: ${JSON.stringify(res)}${rateLimitHint(res)}`, evidence: { shot } }
    },
  },
  {
    id: 'D3', title: 'personal_sign: Sign ekrani, imza hesapla dogrulanir',
    run: async (ctx) => {
      const { dapp: p, browser } = ctx
      const msg = 'Hello AppKit!'
      const hexMsg = `0x${Buffer.from(msg, 'utf8').toString('hex')}`
      const addr = ctx.seed.accounts[0].address
      await p.evaluate(`window.qa.start('sign', 'personal_sign', [${JSON.stringify(hexMsg)}, ${JSON.stringify(addr)}])`)
      const a = await browser.waitApproval()
      await a.waitFor(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(uiText(ctx.en, 'dapps.sign.title').toLowerCase())})`, { timeout: 30000, label: 'Sign ekrani' })
      const shot = await evidenceOf(ctx, a, 'D3-sign-approval')
      await clickButton(a, uiText(ctx.en, 'dapps.sign.btn_sign'))
      const res = await p.evaluate(`window.qa.sign`)
      await browser.waitClosed(a.targetId)
      await paceApprovals()
      const recovered = res.ok ? verifyMessage(msg, res.ok) : null
      const ok = recovered && getAddress(recovered) === getAddress(addr)
      return { status: ok ? 'PASS' : 'FAIL', detail: `imza ${res.ok ? 'alindi' : JSON.stringify(res)}; imzalayan eslesiyor: ${Boolean(ok)}${rateLimitHint(res)}`, evidence: { shot } }
    },
  },
  {
    id: 'D4', title: 'zincir gecisi OP: SwitchChain onay ekrani, eth_chainId 0xa, chainChanged olayi',
    run: async (ctx) => {
      const { dapp: p, browser } = ctx
      await p.evaluate(`window.qa.start('switch', 'wallet_switchEthereumChain', [{ chainId: '0xa' }])`)
      const a = await browser.waitApproval()
      await a.waitFor(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(uiText(ctx.en, 'dapps.switchChain.title').toLowerCase())})`, { timeout: 30000, label: 'SwitchChain ekrani' })
      const shot = await evidenceOf(ctx, a, 'D4-switch-approval')
      await clickButton(a, uiText(ctx.en, 'dapps.switchChain.btn_switch'))
      const res = await p.evaluate(`window.qa.switch`)
      await browser.waitClosed(a.targetId)
      await paceApprovals()
      const chainId = await p.evaluate(`window.ethereum.request({ method: 'eth_chainId' })`)
      const events = await p.evaluate(`window.__qaEvents || []`)
      const sawEvent = events.some((e) => e.event === 'chainChanged' && e.data === '0xa')
      const ok = res.ok === null && chainId === '0xa' && sawEvent
      return { status: ok ? 'PASS' : 'FAIL', detail: `switch -> ${JSON.stringify(res)}, eth_chainId -> ${chainId}, chainChanged goruldu: ${sawEvent}${rateLimitHint(res)}`, evidence: { shot } }
    },
  },
  {
    id: 'D5', title: 'OP eth_sendTransaction: onay ekrani + ATS ucret karti; hermetik zincir/bundler',
    run: async (ctx) => {
      const { dapp: p, browser, stub } = ctx
      const from = ctx.seed.accounts[0].address
      const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
      ctx.rpcMock.fund(from, 10n ** 18n)
      await p.evaluate(`window.qa.start('send', 'eth_sendTransaction', [{ from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, value: '0xf4240', gas: '0x5208' }])`)
      const a = await browser.waitApproval()
      // Dapp.vue: onay dugmesi (Confirm & Send) gorunene kadar bekle; ucret karti ATS metnini tasir.
      const confirm = uiText(ctx.en, 'send.confirmTransaction.confirmTx')
      await a.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().toLowerCase().startsWith(${JSON.stringify(confirm.toLowerCase())}))`, { timeout: 45000, label: 'Dapp ekraninda onay dugmesi' })
      await sleep(2500) // ATS teklifi (quote) yuklensin
      const text = await a.text()
      const hasAts = /ats/i.test(text)
      const shot = await evidenceOf(ctx, a, 'D5-send-approval')
      const enabled = await a.evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().toLowerCase().startsWith(${JSON.stringify(confirm.toLowerCase())}) && !b.disabled)`)
      if (!enabled) {
        return { status: 'DEVIATION', detail: `onay dugmesi KILITLI (ATS hazirligi/teklif tamamlanmadi). Ekran metni: ${text.replace(/\s+/g, ' ').slice(0, 400)}`, evidence: { shot, stub: stub.summary(), rpcUnknown: ctx.rpcMock.unknown() } }
      }
      await clickButton(a, confirm, { timeout: 5000 }).catch(async () => {
        await a.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().toLowerCase().startsWith(${JSON.stringify(confirm.toLowerCase())})); b && b.click(); return true })()`)
      })
      const res = await Promise.race([p.evaluate(`window.qa.send`), sleep(60000).then(() => ({ timeout: true }))])
      await browser.waitClosed(a.targetId)
      await paceApprovals()
      const sp = stub.sponsorCalls[stub.sponsorCalls.length - 1]
      const uo = stub.userOps[stub.userOps.length - 1]
      const matched = Boolean(uo && uo.call && uo.call.to.toLowerCase() === to && uo.call.value === '1000000' && uo.chainId === 10)
      const evidence = { shot, sendResult: res, sponsor: sp || null, userOp: uo || null, stub: stub.summary(), rpcUnknown: ctx.rpcMock.unknown() }
      if (res.ok && matched) return { status: 'PASS', detail: `gonderim tamam: UserOp hedef/deger/zincir Lab istegiyle eslesti; ATS karti: ${hasAts}`, evidence }
      return { status: 'DEVIATION', detail: `gonderim tamamlanmadi/eslesmedi: sonuc ${JSON.stringify(res)}${rateLimitHint(res)}, userOp eslesti: ${matched}, sponsor cagrisi: ${Boolean(sp)}, ATS karti: ${hasAts}`, evidence }
    },
  },
  {
    id: 'D6', title: 'cuzdan tarafi zincir gecisi (popup ana ekran, NetworkScopePill): Base, dapp chainChanged alir',
    run: async (ctx) => {
      const { dapp: p, browser } = ctx
      const before = (await p.evaluate(`window.__qaEvents || []`)).length
      const popup = await browser.openPopupTab()
      try {
        // Ana ekranda ag duragi: ilk `div.relative.z-30 > button` (NetworkScopePill). Menu satiri title=<zincir adi>.
        await popup.waitFor(`!!document.querySelector('div.relative.z-30 > button')`, { timeout: 30000, label: 'NetworkScopePill dugmesi' })
        await popup.evaluate(`document.querySelector('div.relative.z-30 > button').click()`)
        await popup.waitFor(`!!document.querySelector('button[title="Base"]')`, { timeout: 10000, label: 'Base menu satiri' })
        await popup.evaluate(`document.querySelector('button[title="Base"]').click()`)
        await p.waitFor(`(window.__qaEvents || []).some((e) => e.event === 'chainChanged' && e.data === '0x2105')`, { timeout: 30000, label: 'dapp chainChanged 0x2105' })
      } finally {
        await browser.closeTarget(popup.targetId)
      }
      const chainId = await p.evaluate(`window.ethereum.request({ method: 'eth_chainId' })`)
      const events = (await p.evaluate(`window.__qaEvents || []`)).slice(before)
      const ok = chainId === '0x2105'
      return { status: ok ? 'PASS' : 'FAIL', detail: `eth_chainId -> ${chainId}; yeni olaylar: ${JSON.stringify(events)}; alert: ${JSON.stringify(browser.dialogs)}`, evidence: { dialogs: browser.dialogs.slice() } }
    },
  },
  {
    id: 'D8', title: 'hesap degisimi (Header cekmecesi): dapp accountsChanged, eth_accounts ve imza YENI hesapla tutarli (G4)',
    run: async (ctx) => {
      const { dapp: p, browser } = ctx
      const second = ctx.seed.accounts[1].address
      const before = (await p.evaluate(`window.__qaEvents || []`)).length
      const popup = await browser.openPopupTab()
      try {
        // Header: ilk dugme avatar -> sol cekmece; cekmecede hesap dugmesi kimlik simgesinin (src) adresi tasir.
        await popup.waitFor(`!!document.querySelector('header button')`, { timeout: 30000, label: 'Header avatar dugmesi' })
        await popup.evaluate(`document.querySelector('header button').click()`)
        await popup.waitFor(`!!document.querySelector('img[src*="${second}"]')`, { timeout: 10000, label: 'cekmecede ikinci hesap' })
        await popup.evaluate(`document.querySelector('img[src*="${second}"]').closest('button').click()`)
        await sleep(1500)
      } finally {
        await browser.closeTarget(popup.targetId)
      }
      const events = (await p.evaluate(`window.__qaEvents || []`)).slice(before)
      const accounts = await p.evaluate(`window.ethereum.request({ method: 'eth_accounts' })`)
      const sawEvent = events.some((e) => e.event === 'accountsChanged' && Array.isArray(e.data) && e.data.length === 1 && e.data[0].toLowerCase() === second.toLowerCase())
      const accountsOk = Array.isArray(accounts) && accounts.length === 1 && accounts[0].toLowerCase() === second.toLowerCase()
      // imza YENI hesapla basarili olmali
      const msg = 'qa-account-switch'
      const hexMsg = `0x${Buffer.from(msg, 'utf8').toString('hex')}`
      await p.evaluate(`window.qa.start('sign2', 'personal_sign', [${JSON.stringify(hexMsg)}, ${JSON.stringify(second)}])`)
      let signOk = false
      let signDetail = ''
      try {
        const a = await browser.waitApproval({ timeout: 15000 })
        await a.waitFor(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(uiText(ctx.en, 'dapps.sign.title').toLowerCase())})`, { timeout: 20000, label: 'Sign ekrani' })
        await clickButton(a, uiText(ctx.en, 'dapps.sign.btn_sign'))
        const res = await p.evaluate(`window.qa.sign2`)
        await browser.waitClosed(a.targetId)
        await paceApprovals()
        signOk = Boolean(res.ok) && getAddress(verifyMessage(msg, res.ok)) === getAddress(second)
        signDetail = res.ok ? 'imza alindi' : `${JSON.stringify(res)}${rateLimitHint(res)}`
      } catch (e) {
        const res = await p.evaluate(`Promise.race([window.qa.sign2, new Promise((r) => setTimeout(() => r({ pending: true }), 1000))])`).catch(() => null)
        signDetail = `onay penceresi yok/sonuc: ${JSON.stringify(res)} (${e.message})`
      }
      const ok = sawEvent && accountsOk && signOk
      return { status: ok ? 'PASS' : 'FAIL', detail: `accountsChanged([yeni]) goruldu: ${sawEvent}; eth_accounts -> ${JSON.stringify(accounts)} (yeni hesapla tutarli: ${accountsOk}); yeni hesapla imza: ${signOk} (${signDetail}). NOT: G4 duzeltmesinden (T3/T12/T13/T14a) ONCEKI tabanda (c8f2f97) bu akisin KALMASI BEKLENIR.`, evidence: { events } }
    },
  },
  {
    id: 'D7', title: 'cuzdan tarafi baglanti kesme (Header acilir menu): dapp accountsChanged([]), kayit silinir',
    run: async (ctx) => {
      const { dapp: p, browser } = ctx
      const host = DRY_DAPP_HOST
      const before = (await p.evaluate(`window.__qaEvents || []`)).length
      const popup = await browser.openPopupWindowFor(p)
      let sawPill = false
      try {
        await popup.waitFor(`!!document.querySelector('button[title*="${host}"]')`, { timeout: 25000, label: `Header baglanti dugmesi (${host})` })
        sawPill = true
        await popup.evaluate(`document.querySelector('button[title*="${host}"]').click()`)
        await popup.waitFor(`!!document.querySelector('button[title="${uiText(ctx.en, 'header.disconnect')}"]')`, { timeout: 10000, label: 'Disconnect dugmesi' })
        await popup.evaluate(`document.querySelector('button[title="${uiText(ctx.en, 'header.disconnect')}"]').click()`)
        await sleep(1500)
      } catch (e) {
        if (!sawPill) {
          return { status: 'DEVIATION', detail: `Header dapp sekmesini goremedi (popup penceresi mekanizmasi: ${e.message}); wallet-side kesme UI uzerinden surulemedi`, evidence: { targets: browser.describe() } }
        }
        throw e
      } finally {
        // Her yolda kapat: acik uzanti sayfasi sonraki dapp isteklerine "-32603 bos yanit" verdirir.
        await browser.closeTarget(popup.targetId)
      }
      const events = (await p.evaluate(`window.__qaEvents || []`)).slice(before)
      const sawEmpty = events.some((e) => e.event === 'accountsChanged' && Array.isArray(e.data) && e.data.length === 0)
      const stored = await browser.sw().evaluate(`chrome.storage.local.get('dapps').then((o) => Object.keys(o.dapps || {}))`)
      const accounts = await p.evaluate(`window.ethereum.request({ method: 'eth_accounts' })`)
      const ok = sawEmpty && !stored.includes(host) && Array.isArray(accounts) && accounts.length === 0
      return { status: ok ? 'PASS' : 'FAIL', detail: `accountsChanged([]) goruldu: ${sawEmpty}; dapps anahtarlari: ${JSON.stringify(stored)}; eth_accounts -> ${JSON.stringify(accounts)}`, evidence: { events } }
    },
  },
]

// Dapp/Lab sayfasinin saglayici cagri ve olay gunlugu (PROVIDER_LOG_SCRIPT). Sayfa yenilenirse dizi
// SIFIRLANIR: bu yuzden dilimleme dizin ile degil ZAMAN DAMGASIYLA yapilir.
async function providerLog(ctx) {
  try {
    if (!ctx.dapp) return null
    return JSON.parse(await ctx.dapp.evaluate(`JSON.stringify({ calls: window.__qaLog || [], events: window.__qaEvents || [] })`, { timeout: 8000 }))
  } catch { return null }
}

export async function runFlows(flows, ctx, only = null) {
  const results = []
  for (const f of flows) {
    if (only && !only.includes(f.id)) continue
    ctx.log(`akis ${f.id}: ${f.title}`)
    const startedAt = Date.now()
    const r = await guarded(f.id, f.title, f.run, ctx)
    // Ek A karsilastirmasi (T16) icin: bu akis boyunca dapp tarafinin gordugu TUM cagri ve olaylar.
    const log = await providerLog(ctx)
    if (log) {
      r.providerCalls = log.calls.filter((c) => c.t >= startedAt)
      r.providerEvents = log.events.filter((e) => e.t >= startedAt)
    }
    r.startedAt = startedAt
    r.cases = f.cases || null
    ctx.log(`  -> ${r.status}: ${r.detail}`)
    results.push(r)
  }
  return results
}

// ---------------------------------------------------------------------------
// Lab (Reown AppKit Lab) surucusu: shadow DOM'u delen yardimcilar + fare tiklamasi.
// 2026-10-03 arastirmasinda (taklit saglayici ile) kanitlanan teknikler; GERCEK eklentiyle
// F1-F4 plan zamaninda canli denendi, F5-F14 T16'da dogrulanir (DOGRULANMADI).
// ---------------------------------------------------------------------------
export const DEEP_SCRIPT = `(() => {
  if (window.__deep) return
  function* walk(root) {
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()
      if (n.nodeType === 1) { yield n; if (n.shadowRoot) stack.push(n.shadowRoot) }
      const kids = n.children || []
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
    }
  }
  const deep = {
    all(root = document) { return Array.from(walk(root)) },
    byTag(tag, root = document) { tag = tag.toLowerCase(); return deep.all(root).filter((e) => e.localName === tag) },
    textOf(el) { return (el.innerText || el.textContent || '').trim() },
    deepText(root) {
      const out = []
      const rec = (n) => {
        if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push(t); return }
        if (n.nodeType !== 1 && n.nodeType !== 11) return
        if (n.nodeType === 1 && ['STYLE', 'SCRIPT'].includes(n.tagName)) return
        if (n.shadowRoot) rec(n.shadowRoot)
        for (const c of n.childNodes) rec(c)
      }
      rec(root)
      return out
    },
    click(el) {
      el.scrollIntoView && el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
    },
  }
  window.__deep = deep
})()`

export const LAB_SEL = {
  connectButton: `(() => { const e = __deep.byTag('wui-connect-button')[0]; return e && ((e.shadowRoot && e.shadowRoot.querySelector('button')) || e) })()`,
  watsRow: `__deep.byTag('wui-list-wallet').find((e) => (e.name || e.getAttribute('name')) === 'WATS Wallet')`,
  networkButton: `(() => { const e = __deep.byTag('appkit-network-button')[0]; return e && ((e.shadowRoot && __deep.all(e.shadowRoot).find((x) => x.localName === 'wui-network-button')) || e) })()`,
  accountButton: `(() => { const e = __deep.byTag('appkit-account-button')[0]; return e && ((e.shadowRoot && __deep.all(e.shadowRoot).find((x) => x.localName === 'wui-account-button')) || e) })()`,
  modalCloseX: `(() => { const m = document.querySelector('w3m-modal'); if (!m) return null; const h = __deep.all(m).find((e) => e.localName === 'w3m-header'); return h && __deep.all(h).find((e) => e.localName === 'ph-x') })()`,
  button: (text, nth = 0) => `__deep.all(document).filter((e) => e.localName === 'button' && __deep.textOf(e) === ${JSON.stringify(text)})[${nth}]`,
  modalItem: (tag, name) => `__deep.all(document.querySelector('w3m-modal')).find((e) => e.localName === ${JSON.stringify(tag)} && (e.name || e.getAttribute('name')) === ${JSON.stringify(name)})`,
  modalOpen: `!!document.querySelector('w3m-modal') && __deep.all(document.querySelector('w3m-modal')).some((e) => e.localName === 'w3m-header')`,
}

const labRect = async (lab, expr) => {
  const r = await lab.evaluate(`(() => { const e = (${expr}); if (!e) return null; return JSON.stringify(window.__deep.click(e)) })()`)
  return r ? JSON.parse(r) : null
}
async function labWaitRect(lab, expr, { tries = 60, ms = 500 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const r = await labRect(lab, expr)
    if (r && r.w > 0 && r.h > 0) return r
    await sleep(ms)
  }
  return null
}
async function labMouseClick(lab, x, y) {
  await lab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await lab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await lab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
// Tiklar; `effect()` 3 sn icinde dogrulanmazsa BIR kez daha tiklar (AppKit modal kapandiktan sonraki ilk
// tiklamayi bazen yutar: harness artefakti, cuzdanla ilgisi yok).
async function labClick(lab, expr, label, effect = null) {
  const r = await labWaitRect(lab, expr)
  if (!r) throw new Error(`Lab ogesi bulunamadi: ${label}`)
  await sleep(800) // yerlesimin oturmasi
  const r2 = (await labRect(lab, expr)) || r
  await labMouseClick(lab, r2.x, r2.y)
  if (!effect) return
  for (let i = 0; i < 6; i += 1) {
    await sleep(500)
    if (await effect()) return
  }
  const r3 = (await labRect(lab, expr)) || r2
  await labMouseClick(lab, r3.x, r3.y)
}
const labText = (lab) => lab.evaluate(`window.__deep.deepText(document.body).join(' | ')`)
const calls = async (lab) => JSON.parse(await lab.evaluate(`JSON.stringify(window.__qaLog || [])`))
const events = async (lab) => JSON.parse(await lab.evaluate(`JSON.stringify(window.__qaEvents || [])`))
const lastCall = (list, method, from = 0) => [...list.slice(from)].reverse().find((c) => c.method === method)

async function openLab(ctx) {
  const lab = await ctx.openDapp(ctx.labUrl)
  ctx.dapp = lab
  await lab.waitFor(`!!window.__deep && window.__deep.byTag('wui-connect-button').length > 0`, { timeout: 90000, label: 'Lab yuklendi (Connect Wallet dugmesi)' })
  return lab
}

// Onay penceresi: bekle, baslik gorunsun, goruntu al, dugmeye bas, pencere kapansin.
async function approve(ctx, { titleKey, buttonKeys, shotName }) {
  const a = await ctx.browser.waitApproval({ timeout: 30000 })
  const title = uiText(ctx.en, titleKey)
  await a.waitFor(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(title.toLowerCase())})`, { timeout: 40000, label: `onay ekrani basligi '${title}'` })
  // TransactionStatus (App.vue, tum sayfalarda) onceki bir ISLEMIN "Transaction Successful" kartini tam ekran
  // katman olarak gosterir ve basarili kart arayuz kayda baktigi andan 6 sn sonra kendiliginden kapanir
  // (txAutoDismiss SUCCESS_TTL_MS). Yeni acilan onay penceresinde bu katman Sign/Reject'i ILK ~6 sn ORTER
  // (T16 duzeltme turu bulgusu W-1). Kanit goruntusu gercek onay ekranini gostersin diye katman kalkana kadar
  // beklenir; ortulu hali ayri goruntude (-tx-overlay) saklanir.
  const overlayLabel = `${uiText(ctx.en, 'transactionStatus.transactions')} (`
  const overlayExpr = `document.body.innerText.includes(${JSON.stringify(overlayLabel)})`
  const overlayCovered = await a.evaluate(overlayExpr).catch(() => false)
  let overlayShot = null
  let overlayGoneMs = null
  if (overlayCovered) {
    overlayShot = await evidenceOf(ctx, a, `${shotName}-tx-overlay`)
    const t0 = Date.now()
    await a.waitFor(`!(${overlayExpr})`, { timeout: 15000, label: 'islem durumu katmani kalkti' }).then(() => { overlayGoneMs = Date.now() - t0 }).catch(() => {})
  }
  const shot = await evidenceOf(ctx, a, shotName)
  // Goruntunun GERCEKTEN bu onay ekrani oldugunu kanitlar: pencere URL'si, gorunen metin, kaydirma ve
  // pencere merkezindeki en ust elemanlar (ust uste binen bir katman onay ekranini ortuyorsa gorunur).
  const probe = await a.evaluate(`JSON.stringify({ url: location.href.slice(0, 120), text: document.body.innerText.slice(0, 240), scrollY: window.scrollY, innerH: window.innerHeight, scrollH: document.documentElement.scrollHeight, centerStack: document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).slice(0, 5).map((e) => e.tagName + '.' + String(e.className).slice(0, 50)) })`).then((v) => JSON.parse(v)).catch((e) => ({ error: e.message }))
  let clicked = null
  for (const key of buttonKeys) {
    const label = uiText(ctx.en, key)
    if (!label) continue
    try { await clickButton(a, label, { timeout: 8000 }); clicked = label; break } catch { /* siradaki etiket */ }
  }
  if (!clicked) throw new Error(`onay dugmesi bulunamadi (${buttonKeys.join(', ')}): ${(await a.text()).replace(/\s+/g, ' ').slice(0, 200)}`)
  await ctx.browser.waitClosed(a.targetId)
  await paceApprovals() // her onay bir pencere hakki harcar (-32005 kisiti): sonraki istegi ara
  return { shot, clicked, probe, overlayCovered, overlayShot, overlayGoneMs }
}

// T11'in ekledigi typed data onay dugmesi etiketi: anahtar adi plan zamaninda bilinmiyor.
function typedDataButtonKeys(en) {
  const block = (en.dapps && en.dapps.signTypedData) || {}
  const keys = Object.keys(block).filter((k) => /^btn_sign/i.test(k) || /^btn_.*sign/i.test(k)).map((k) => `dapps.signTypedData.${k}`)
  return keys.length ? keys : ['dapps.signTypedData.btn_sign']
}

async function connectLab(ctx) {
  const { dapp: lab } = ctx
  const mark = (await calls(lab)).length
  await labClick(lab, LAB_SEL.connectButton, 'Connect Wallet', async () => lab.evaluate(LAB_SEL.modalOpen))
  await lab.waitFor(`window.__deep.byTag('wui-list-wallet').length >= 2`, { timeout: 40000, label: 'modal cuzdan listesi' })
  await sleep(2500)
  const rows = JSON.parse(await lab.evaluate(`JSON.stringify(window.__deep.byTag('wui-list-wallet').map((e) => ({ name: e.name || e.getAttribute('name'), tag: e.tagLabel || e.getAttribute('tagLabel') || e.getAttribute('taglabel') || null })))`))
  const wats = rows.find((r) => r.name === 'WATS Wallet')
  if (!wats) throw new Error(`modalda 'WATS Wallet' satiri yok (satirlar: ${JSON.stringify(rows.slice(0, 8))})`)
  const r = await labWaitRect(lab, LAB_SEL.watsRow)
  await labMouseClick(lab, r.x, r.y)
  const ap = await approve(ctx, { titleKey: 'dapps.connect.title', buttonKeys: ['dapps.connect.btn_connect', 'dapps.connect.btn_switch_and_connect'], shotName: `${ctx.phase}-connect-approval` })
  await lab.waitFor(`(window.__qaLog || []).slice(${mark}).some((c) => c.method === 'eth_requestAccounts' && (c.result || c.error))`, { timeout: 40000, label: 'eth_requestAccounts sonucu' })
  await sleep(1500)
  if (await lab.evaluate(LAB_SEL.modalOpen)) await labClick(lab, LAB_SEL.modalCloseX, 'modal kapat').catch(() => {})
  return { rows, wats, approval: ap, mark }
}

// Lab ag seciciyle zincir degistirir (dapp tarafi). SwitchChain onayi tiklanir.
async function labSwitchNetwork(ctx, name, { expectUnsupported = false } = {}) {
  const { dapp: lab } = ctx
  const mark = (await calls(lab)).length
  await labClick(lab, LAB_SEL.networkButton, 'ag secici dugmesi', async () => lab.evaluate(LAB_SEL.modalOpen))
  if (!ctx.labNetworks) {
    // Lab'in o anki ag listesi (R-8: etiketli surumle canli liste farkli olabilir) kanita yazilir.
    ctx.labNetworks = JSON.parse(await lab.evaluate(`JSON.stringify(window.__deep.byTag('wui-list-network').map((e) => e.name || e.getAttribute('name')))`))
  }
  await labClick(lab, LAB_SEL.modalItem('wui-list-network', name), `ag '${name}'`)
  let approval = null
  if (!expectUnsupported) approval = await approve(ctx, { titleKey: 'dapps.switchChain.title', buttonKeys: ['dapps.switchChain.btn_switch'], shotName: `${ctx.phase}-switch-${name.replace(/\W+/g, '_')}` })
  await sleep(expectUnsupported ? 5000 : 2500)
  if (await lab.evaluate(LAB_SEL.modalOpen)) await labClick(lab, LAB_SEL.modalCloseX, 'modal kapat').catch(() => {})
  return { mark, approval, calls: (await calls(lab)).slice(mark) }
}

// Lab'in KENDI RPC'sine giden eth_estimateGas'i yerelde cevaplar (fonsuz hesapla Gonder dugmesi asili kalmasin).
// Baska hicbir Lab istegine dokunulmaz (continueRequest). Dis cagri YAPILMAZ.
async function stubLabEstimateGas(ctx) {
  const { dapp: lab, browser } = ctx
  await lab.send('Fetch.enable', { patterns: [{ urlPattern: 'https://rpc.walletconnect.org/v1/*', requestStage: 'Request' }] })
  const stats = { paused: 0, estimates: 0, other: [] }
  const handler = (m) => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== lab.sessionId) return
    const { requestId, request } = m.params
    stats.paused += 1
    let body = null
    try { body = JSON.parse(request.postData || 'null') } catch { body = null }
    const items = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []
    if (!(items.length && items.every((i) => i.method === 'eth_estimateGas'))) stats.other.push(items.map((i) => i.method).join(',') || request.url.slice(0, 80))
    if (items.length && items.every((i) => i.method === 'eth_estimateGas')) {
      stats.estimates += 1
      const out = items.map((i) => ({ jsonrpc: '2.0', id: i.id, result: '0x5208' }))
      lab.send('Fetch.fulfillRequest', {
        requestId, responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }],
        body: Buffer.from(JSON.stringify(Array.isArray(body) ? out : out[0])).toString('base64'),
      }).catch(() => {})
    } else {
      lab.send('Fetch.continueRequest', { requestId }).catch(() => {})
    }
  }
  browser.cdp.on(handler)
  const dispose = async () => {
    browser.cdp.off(handler)
    await lab.send('Fetch.disable').catch(() => {})
  }
  dispose.stats = stats
  return dispose
}

const sameAddr = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

// Cuzdanin su anki AKTIF hesabi (akislar sirayla durum paylasir; sabit seed.accounts[0] varsayilmaz).
async function activeAddr(ctx) {
  return (await ctx.browser.swReady()).evaluate(`chrome.storage.local.get('active_account').then((o) => o.active_account && o.active_account.address)`)
}
async function otherSeedAccount(ctx) {
  const cur = await activeAddr(ctx)
  return ctx.seed.accounts.find((a) => !sameAddr(a.address, cur)) || ctx.seed.accounts[1]
}

// ---------------------------------------------------------------------------
// F1-F14 (spec bolum 12, S6). `phase`: hermetic (yerel RPC + bundler taklidi) | realrpc (F6/F7 gercek RPC).
// Akislar SIRALIDIR ve ayni tarayici/oturum durumunu paylasir (F2 baglar, F9 keser, F11 yeniden baglar...).
// `--only` ile tek akis calistirilirsa onkosul akislari (F1, F2) otomatik EKLENMEZ: --only F1,F2,F3 verin.
// ---------------------------------------------------------------------------
async function recoverTyped(payloadJson, signature) {
  const td = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson
  const types = { ...td.types }
  delete types.EIP712Domain
  const ethersAddr = verifyTypedData(td.domain, types, td.message, signature)
  const viem = await import('viem')
  const viemAddr = await viem.recoverTypedDataAddress({ domain: td.domain, types, primaryType: td.primaryType, message: td.message, signature })
  return { ethersAddr, viemAddr, domain: td.domain, primaryType: td.primaryType }
}

export const FLOWS = [
  {
    id: 'F1', phase: 'hermetic', cases: [2, 12], title: 'Lab yukleme: eth_accounts -> [] (cuzdan INSTALLED duyurur)',
    run: async (ctx) => {
      const lab = await openLab(ctx)
      let ok = false
      let retries = 0 // K2 sayaci: Lab yenilemesi gerektiren her ilk-istek askisi (flows.json evidence.retries)
      for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
        try {
          await lab.waitFor(`(window.__qaLog || []).some((c) => c.method === 'eth_accounts' && (c.result || c.error))`, { timeout: 25000, label: 'Lab eth_accounts sonucu' })
          ok = true
        } catch (e) {
          if (attempt === 0) { retries += 1; ctx.log('  F1: ilk eth_accounts yanitlanmadi, Lab yenileniyor (ILK ISTEK ASKIDA gozlemi)'); await lab.send('Page.reload'); await lab.waitFor(`!!window.__deep && window.__deep.byTag('wui-connect-button').length > 0`, { timeout: 90000, label: 'Lab yeniden yuklendi' }) } else throw e
        }
      }
      const list = (await calls(lab)).filter((c) => c.method === 'eth_accounts')
      const empty = list.length > 0 && list.every((c) => Array.isArray(c.result) && c.result.length === 0)
      const shot = await evidenceOf(ctx, lab, 'F1-lab-loaded')
      // Plan bolum 7 F1: ilk istek askida kalip Lab yenilendiyse "ILK ISTEK ASKIDA" DEVIATION'i KAYDEDILIR (K2, T19 sonrasi CUZDAN bulgusu).
      const status = !empty ? 'FAIL' : retries > 0 ? 'DEVIATION' : 'PASS'
      return { status, detail: `${retries > 0 ? 'ILK ISTEK ASKIDA (Lab yenilendi, ' + retries + ' kez); ' : ''}eth_accounts cagrilari: ${JSON.stringify(list.map((c) => c.result ?? c.error))}`, evidence: { retries, shot, calls: await calls(lab) } }
    },
  },
  {
    id: 'F2', phase: 'hermetic', cases: [2], title: 'baglan: "WATS Wallet" (INSTALLED) + onay; hesap seed hesabi',
    run: async (ctx) => {
      const lab = ctx.dapp
      const c = await connectLab(ctx)
      const all = await calls(lab)
      const req = lastCall(all, 'eth_requestAccounts', c.mark)
      const perm = lastCall(all, 'wallet_requestPermissions', c.mark)
      const providerOk = req && Array.isArray(req.result) && sameAddr(req.result[0], await activeAddr(ctx))
      // Lab ARAYUZU de baglandi demeli: hesap dugmesi var, "Connection declined" yok. (2026-10-05: tabanda
      // sayisal kodsuz wallet_requestPermissions hatasi Lab'da "Connection declined" uretti: G5 kaniti.)
      const uiConnected = await lab.evaluate(`window.__deep.byTag('appkit-account-button').length > 0`)
      const declined = /Connection declined/i.test(await labText(lab))
      const ok = providerOk && uiConnected && !declined
      const shot = await evidenceOf(ctx, lab, 'F2-connected')
      return { status: ok ? 'PASS' : 'FAIL', detail: `WATS satiri etiketi: ${c.wats.tag}; eth_requestAccounts -> ${JSON.stringify(req && (req.result ?? req.error))}; wallet_requestPermissions -> ${JSON.stringify(perm ? (perm.result ?? perm.error) : 'cagrilmadi')}; Lab arayuzu bagli: ${uiConnected}; 'Connection declined' gorundu: ${declined}`, evidence: { shot, rows: c.rows, approval: c.approval, calls: all.slice(c.mark) } }
    },
  },
  {
    id: 'F3', phase: 'hermetic', cases: [9], title: 'personal_sign: "Hello AppKit!" imzasi hesapla dogrulanir',
    run: async (ctx) => {
      const lab = ctx.dapp
      const mark = (await calls(lab)).length
      await labClick(lab, LAB_SEL.button('Sign Message'), 'Sign Message')
      const ap = await approve(ctx, { titleKey: 'dapps.sign.title', buttonKeys: ['dapps.sign.btn_sign'], shotName: 'F3-sign-approval' })
      await lab.waitFor(`(window.__qaLog || []).slice(${mark}).some((c) => c.method === 'personal_sign' && (c.result || c.error))`, { timeout: 30000, label: 'personal_sign sonucu' })
      const call = lastCall(await calls(lab), 'personal_sign', mark)
      const msg = Buffer.from(String(call.params[0]).slice(2), 'hex').toString('utf8')
      const recovered = call.result ? verifyMessage(msg, call.result) : null
      const ok = recovered && sameAddr(recovered, await activeAddr(ctx))
      const text = await labText(lab)
      return { status: ok ? 'PASS' : 'FAIL', detail: `mesaj '${msg}'; imzalayan hesapla eslesiyor: ${Boolean(ok)}; Lab metni 'Signing Succeeded': ${/Signing Succeeded/i.test(text)}`, evidence: { approval: ap, call } }
    },
  },
  {
    id: 'F4', phase: 'hermetic', cases: [10], title: 'eth_signTypedData_v4: imzadan cikan adres == hesap (ethers + viem); ikinci zincirde de',
    run: async (ctx) => {
      const lab = ctx.dapp
      const out = []
      for (const round of ['ilk-zincir', 'OP']) {
        if (round === 'OP') await labSwitchNetwork(ctx, 'OP Mainnet')
        const mark = (await calls(lab)).length
        await labClick(lab, LAB_SEL.button('Sign Typed Data'), 'Sign Typed Data', async () => (await calls(lab)).length > mark)
        const ap = await approve(ctx, { titleKey: 'dapps.signTypedData.title', buttonKeys: typedDataButtonKeys(ctx.en), shotName: `F4-typed-approval-${round}` })
        await lab.waitFor(`(window.__qaLog || []).slice(${mark}).some((c) => c.method === 'eth_signTypedData_v4' && (c.result || c.error))`, { timeout: 40000, label: 'eth_signTypedData_v4 sonucu' })
        const call = lastCall(await calls(lab), 'eth_signTypedData_v4', mark)
        let rec = null
        if (call.result) rec = await recoverTyped(call.params[1], call.result)
        const want = await activeAddr(ctx)
        const ok = rec && sameAddr(rec.ethersAddr, want) && sameAddr(rec.viemAddr, want)
        out.push({ round, ok: Boolean(ok), domainChainId: rec && rec.domain.chainId, primaryType: rec && rec.primaryType, error: call.error || null, approval: ap })
      }
      const all = out.every((o) => o.ok)
      return { status: all ? 'PASS' : 'FAIL', detail: out.map((o) => `${o.round}: ${o.ok ? 'imzalayan hesapla eslesti' : `BASARISIZ ${JSON.stringify(o.error)}`} (domain.chainId=${o.domainChainId})`).join('; '), evidence: { rounds: out } }
    },
  },
  {
    id: 'F5', phase: 'hermetic', cases: [11], title: 'OP\'de gonder: onay ekrani zinciri + ATS ucret karti; yerel bundler UserOp\'u Lab istegiyle eslesir',
    run: async (ctx) => {
      const { dapp: lab, browser, stub } = ctx
      ctx.rpcMock.fund(await activeAddr(ctx), 10n ** 18n)
      const dispose = await stubLabEstimateGas(ctx)
      try {
        const cur = await lab.evaluate(`window.ethereum.request({ method: 'eth_chainId' })`)
        if (cur !== '0xa') await labSwitchNetwork(ctx, 'OP Mainnet')
        const mark = (await calls(lab)).length
        await labClick(lab, LAB_SEL.button('Send Transaction to Vitalik'), 'Send Transaction to Vitalik', async () => (await calls(lab)).length > mark)
        let a
        try {
          a = await browser.waitApproval({ timeout: 40000 })
        } catch (e) {
          const t = await labText(lab)
          const sent = lastCall(await calls(lab), 'eth_sendTransaction', mark)
          const after = (await calls(lab)).slice(mark).map((c) => `${c.method}:${JSON.stringify(c.result ?? c.error ?? null).slice(0, 60)}`)
          return { status: 'FAIL', detail: `onay penceresi cikmadi: ${e.message}; Lab estimateGas stub: ${JSON.stringify(dispose.stats)}; tikla sonrasi saglayici cagrilari: ${JSON.stringify(after)}; eth_sendTransaction cagrisi: ${JSON.stringify(sent || null)}; zincir: ${await lab.evaluate(`window.ethereum.request({ method: 'eth_chainId' })`)}; Lab metni (parca): ${t.slice(t.indexOf('Send Transaction') - 100, t.indexOf('Send Transaction') + 300)}`, evidence: { shot: await evidenceOf(ctx, lab, 'F5-no-approval') } }
        }
        const confirm = uiText(ctx.en, 'send.confirmTransaction.confirmTx')
        await a.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().toLowerCase().startsWith(${JSON.stringify(confirm.toLowerCase())}))`, { timeout: 45000, label: 'Dapp ekraninda onay dugmesi' })
        await sleep(2500)
        const text = await a.text()
        const shot = await evidenceOf(ctx, a, 'F5-send-approval')
        const enabled = await a.evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().toLowerCase().startsWith(${JSON.stringify(confirm.toLowerCase())}) && !b.disabled)`)
        const sendCall = lastCall(await calls(lab), 'eth_sendTransaction', mark)
        const showsChain = /optimism|op mainnet/i.test(text)
        const showsAts = /ats/i.test(text)
        if (!enabled) return { status: 'DEVIATION', detail: `onay dugmesi kilitli. Ekran: ${text.replace(/\s+/g, ' ').slice(0, 300)}`, evidence: { shot, sendCall } }
        await clickButton(a, confirm, { timeout: 5000 })
        await browser.waitClosed(a.targetId, 60000)
        await paceApprovals()
        await lab.waitFor(`(window.__qaLog || []).slice(${mark}).some((c) => c.method === 'eth_sendTransaction' && (c.result || c.error))`, { timeout: 60000, label: 'eth_sendTransaction sonucu' }).catch(() => {})
        const done = lastCall(await calls(lab), 'eth_sendTransaction', mark)
        const uo = stub.userOps[stub.userOps.length - 1]
        const req = (done && done.params && done.params[0]) || {}
        const matched = Boolean(uo && uo.chainId === 10 && uo.call && req.to && sameAddr(uo.call.to, req.to) && BigInt(uo.call.value) === BigInt(req.value || '0x0'))
        const ok = matched && showsChain && showsAts && done && done.result
        return { status: ok ? 'PASS' : 'DEVIATION', detail: `onay ekrani zincir adi: ${showsChain}, ATS karti: ${showsAts}; UserOp Lab istegiyle eslesti: ${matched}; dapp sonucu: ${JSON.stringify(done && (done.result ?? done.error))}`, evidence: { shot, request: req, userOp: uo || null, sponsor: stub.sponsorCalls.slice(-1)[0] || null, stub: stub.summary(), rpcUnknown: ctx.rpcMock.unknown() } }
      } finally {
        await dispose()
      }
    },
  },
  {
    id: 'F6', phase: 'realrpc', cases: [4], title: 'dapp tarafi zincir gecisi (GERCEK RPC): OP, Base, Arbitrum, Polygon; desteklenmeyen ZKsync -> declined',
    run: async (ctx) => {
      // GERCEK RPC fazinda yeni tarayici: once Lab'a yeniden baglan.
      await openLab(ctx)
      await connectLab(ctx)
      const rows = []
      for (const [name, hex] of [['OP Mainnet', '0xa'], ['Base', '0x2105'], ['Arbitrum One', '0xa4b1'], ['Polygon', '0x89']]) {
        const dBefore = ctx.browser.dialogs.length
        const r = await labSwitchNetwork(ctx, name)
        const sw = lastCall(r.calls, 'wallet_switchEthereumChain')
        const ev = (await events(ctx.dapp)).filter((e) => e.event === 'chainChanged').slice(-1)[0]
        const cur = await ctx.browser.sw().evaluate(`chrome.storage.local.get('currentNetwork').then((o) => o.currentNetwork && o.currentNetwork.chainId)`)
        rows.push({ name, switchResult: sw && (sw.result ?? sw.error), chainChanged: ev && ev.data, storedChainId: cur, alerts: ctx.browser.dialogs.slice(dBefore).map((d) => d.message), ok: Boolean(sw && sw.result === null && ev && ev.data === hex && cur === parseInt(hex, 16) && ctx.browser.dialogs.length === dBefore) })
      }
      const z = await labSwitchNetwork(ctx, 'ZKsync Era', { expectUnsupported: true })
      const sw = lastCall(z.calls, 'wallet_switchEthereumChain')
      const add = lastCall(z.calls, 'wallet_addEthereumChain')
      const text = await labText(ctx.dapp)
      const declinedOk = Boolean(sw && sw.error && sw.error.code === 4902 && add && add.error && add.error.code === 4200)
      const ok = rows.every((r) => r.ok) && declinedOk
      return { status: ok ? 'PASS' : 'FAIL', detail: `desteklenen: ${rows.map((r) => `${r.name}:${r.ok ? 'ok' : 'KALDI'}`).join(', ')}; ZKsync: 4902->${JSON.stringify(add && add.error)} ; Lab 'declined': ${/declined/i.test(text)}`, evidence: { rows, zksync: { sw, add }, labNetworks: ctx.labNetworks || null, rpcReceiptProbeHosts: 'bkz. network-report.json rpcHostsSeen' } }
    },
  },
  {
    id: 'F7', phase: 'realrpc', cases: [5], title: 'cuzdan tarafi zincir gecisi: OP/Base/Arbitrum/Polygon gecer; BSC aynen kaydedilir; TON -> disconnect, geri donus temiz',
    run: async (ctx) => {
      const { browser } = ctx
      if (!ctx.dapp) { await openLab(ctx); await connectLab(ctx) } // F6 calismadiysa (--only F7) kendi durumunu kurar
      const lab = ctx.dapp
      // Gercek RPC sondasi (findFastestRPC) saniyeler surebilir (publicnode 7 sn olculdu): sabit bekleme DEGIL,
      // beklenen olay gelene kadar (en fazla 60 sn) yoklanir.
      const switchWalletSide = async (title, until) => {
        const evBefore = (await events(lab)).length
        const popup = await browser.openPopupTab()
        try {
          await popup.waitFor(`!!document.querySelector('div.relative.z-30 > button')`, { timeout: 30000, label: 'NetworkScopePill' })
          await popup.evaluate(`document.querySelector('div.relative.z-30 > button').click()`)
          await popup.waitFor(`!!document.querySelector('button[title=${JSON.stringify(title)}]')`, { timeout: 10000, label: `menu satiri ${title}` })
          await popup.evaluate(`document.querySelector('button[title=${JSON.stringify(title)}]').click()`)
          const end = Date.now() + 60000
          while (Date.now() < end) {
            const got = (await events(lab)).slice(evBefore)
            if (got.some(until)) break
            await sleep(500)
          }
          await sleep(1000)
        } finally {
          await browser.closeTarget(popup.targetId)
        }
        return (await events(lab)).slice(evBefore)
      }
      const rows = []
      for (const [title, hex] of [['Optimism', '0xa'], ['Base', '0x2105'], ['Arbitrum One', '0xa4b1'], ['Polygon', '0x89']]) {
        const dBefore = browser.dialogs.length
        const evs = await switchWalletSide(title, (e) => e.event === 'chainChanged' && e.data === hex)
        rows.push({ title, events: evs, alerts: browser.dialogs.slice(dBefore).map((d) => d.message), ok: evs.some((e) => e.event === 'chainChanged' && e.data === hex) && browser.dialogs.length === dBefore })
      }
      // BSC: Lab'in gosterdigi AYNEN kaydedilir (hukum yok; spec R-16).
      const bscEvents = await switchWalletSide('BNB Smart Chain', (e) => e.event === 'chainChanged' || e.event === 'disconnect')
      const bscText = await labText(lab)
      const bsc = { events: bscEvents, labTextSample: bscText.slice(0, 400) }
      // TON: dapp'lere 4901'li disconnect gitmesi beklenir; Lab "disconnected".
      const tonEvents = await switchWalletSide('TON', (e) => e.event === 'disconnect' || e.event === 'chainChanged')
      const tonText = await labText(lab)
      const ton = { events: tonEvents, labDisconnected: /Connect Wallet|Disconnected/i.test(tonText) }
      // Geri donus + temiz yeniden baglanma. Cuzdan EVM'e donunce Lab kendiliginden yeniden baglanmis olabilir:
      // o durumda arayuz baglidir ve `eth_accounts` ile dogrulanir; degilse Lab modalindan baglanilir.
      await switchWalletSide('Optimism', (e) => e.event === 'chainChanged' && e.data === '0xa')
      let reconnect = null
      try {
        const already = await lab.evaluate(`window.__deep.byTag('appkit-account-button').length > 0`)
        if (already) {
          const acc = await lab.evaluate(`window.ethereum.request({ method: 'eth_accounts' })`)
          reconnect = { ok: Array.isArray(acc) && acc.length === 1 && sameAddr(acc[0], await activeAddr(ctx)), mode: 'Lab kendiliginden yeniden baglandi', accounts: acc }
        } else {
          const c = await connectLab(ctx)
          const req = lastCall(await calls(lab), 'eth_requestAccounts', c.mark)
          reconnect = { ok: Boolean(req && Array.isArray(req.result) && sameAddr(req.result[0], await activeAddr(ctx))), mode: 'modaldan yeniden baglanildi' }
        }
      } catch (e) { reconnect = { ok: false, error: e.message } }
      // TON gecisi dapp'lere `disconnect` olayi gondermeli (spec: 4901'li kopma); BSC yalniz KAYIT (hukum yok).
      const tonDisconnectEvent = tonEvents.some((e) => e.event === 'disconnect')
      const ok = rows.every((r) => r.ok) && reconnect.ok && tonDisconnectEvent
      // Lab metni sezgiseldir: olay geldi ama metin kopuk gostermiyorsa FAIL degil DEVIATION.
      const status = !ok ? 'FAIL' : ton.labDisconnected ? 'PASS' : 'DEVIATION'
      return { status, detail: `TON disconnect olayi: ${tonDisconnectEvent}; OP/Base/Arb/Pol: ${rows.map((r) => `${r.title}:${r.ok ? 'ok' : 'KALDI'}`).join(', ')}; BSC olaylari: ${JSON.stringify(bscEvents)}; TON olaylari: ${JSON.stringify(tonEvents)} (Lab kopuk: ${ton.labDisconnected}); geri donus yeniden baglanma: ${JSON.stringify(reconnect)}`, evidence: { rows, bsc, ton, reconnect } }
    },
  },
  {
    id: 'F8', phase: 'hermetic', cases: [6], title: 'hesap degisimi (Header): Lab yeni adres, eth_accounts yeni, imza BASARILI; varyant: sessiz active_account yazici yolu',
    run: async (ctx) => {
      const { dapp: lab, browser } = ctx
      const second = (await otherSeedAccount(ctx)).address
      const evBefore = (await events(lab)).length
      const popup = await browser.openPopupTab()
      try {
        await popup.waitFor(`!!document.querySelector('header button')`, { timeout: 30000, label: 'Header avatar' })
        await popup.evaluate(`document.querySelector('header button').click()`)
        await popup.waitFor(`!!document.querySelector('img[src*="${second}"]')`, { timeout: 10000, label: 'cekmecede ikinci hesap' })
        await popup.evaluate(`document.querySelector('img[src*="${second}"]').closest('button').click()`)
        await sleep(2500)
      } finally {
        await browser.closeTarget(popup.targetId)
      }
      const evs = (await events(lab)).slice(evBefore)
      const accounts = await lab.evaluate(`window.ethereum.request({ method: 'eth_accounts' })`)
      const accountsChanged = evs.filter((e) => e.event === 'accountsChanged')
      const exactlyOne = accountsChanged.length === 1 && accountsChanged[0].data.length === 1 && sameAddr(accountsChanged[0].data[0], second)
      const accountsOk = Array.isArray(accounts) && accounts.length === 1 && sameAddr(accounts[0], second)
      const text = await labText(lab)
      const labShows = text.toLowerCase().includes(second.toLowerCase().slice(0, 6))
      // imza YENI hesapla
      const mark = (await calls(lab)).length
      await labClick(lab, LAB_SEL.button('Sign Message'), 'Sign Message', async () => (await calls(lab)).length > mark)
      // YENI hesapla imza: ya onay penceresi acilir (beklenen) ya cuzdan hemen hata doner (G4 tabani: 4100).
      let ap = null
      let signNote = ''
      const end = Date.now() + 20000
      while (Date.now() < end) {
        const c = lastCall(await calls(lab), 'personal_sign', mark)
        if (c && c.error) { signNote = `onaysiz hata: ${JSON.stringify(c.error)}`; break }
        if ([...browser.sessions.values()].some((x) => x.origin === 'approval' && !browser.usedApprovals.has(x.targetId))) {
          ap = await approve(ctx, { titleKey: 'dapps.sign.title', buttonKeys: ['dapps.sign.btn_sign'], shotName: 'F8-sign-after-switch' })
          break
        }
        await sleep(300)
      }
      await lab.waitFor(`(window.__qaLog || []).slice(${mark}).some((c) => c.method === 'personal_sign' && (c.result || c.error))`, { timeout: 20000, label: 'personal_sign sonucu' }).catch(() => {})
      const call = lastCall(await calls(lab), 'personal_sign', mark) || { params: ['0x'], error: { message: 'cagri yok' } }
      const msg = Buffer.from(String(call.params[0]).slice(2), 'hex').toString('utf8')
      const signOk = Boolean(call.result) && sameAddr(verifyMessage(msg, call.result), second)
      // VARYANT (sessiz `active_account` yazici yolu; CreateAccount'un yazdigi gibi: vaults + active_account,
      // storage.onChanged tek tetikleyici). UI yolu (Ayarlar > Hesap Olustur) harness'te elle/ek akisla DEGIL, dogrudan yazimla.
      //
      // HUKUM (T16 duzeltme turu, bulgu D-F8): plan "yeni hesap dapp'e SIZMAZ" der, ama SPEC (D1 = A, G4, K10 --
      // spec kazanir) bunu ikiye boler: (A) hibesi TAM `[onceki aktif]` olan ve followActive !== false bir site
      // aktif hesabi IZLER: tek `accountsChanged([yeni])` ve `eth_accounts == [yeni]` BEKLENEN davranistir (Lab'in
      // baglanma ekraninda olusan kayit tam budur); (B) takip ETMEYEN site (kullanici Manage Permissions'ta hesaplari
      // elle duzenleyince followActive=false olur) yeni, ACIKCA verilmemis hesabi ASLA almaz: SIZINTI YOK. Plan
      // cumlesinin dogru okumasi (B)'dir; ikisi de BURADA ayri ayri sinanir ve ikisi de PASS kosuludur.
      const host = new URL(lab.url).hostname
      const gather = async (evMark) => {
        const evs = (await events(lab)).slice(evMark).filter((e) => e.event === 'accountsChanged')
        const accts = await lab.evaluate(`window.ethereum.request({ method: 'eth_accounts' })`)
        const rec = await browser.sw().evaluate(`chrome.storage.local.get('dapps').then((o) => (o.dapps || {})[${JSON.stringify(host)}] || null)`)
        return { evs, accts, rec }
      }
      // (A) takip eden site
      const next = ctx.seed.nextAccount()
      const evMarkA = (await events(lab)).length
      await browser.sw().evaluate(`chrome.storage.local.set(${JSON.stringify({ vaults: next.vaults, active_account: next.active_account })}).then(() => true)`)
      await sleep(3000)
      const A = await gather(evMarkA)
      const followOk = A.evs.length === 1 && A.evs[0].data.length === 1 && sameAddr(A.evs[0].data[0], next.account.address)
        && Array.isArray(A.accts) && A.accts.length === 1 && sameAddr(A.accts[0], next.account.address)
        && Boolean(A.rec) && A.rec.followActive !== false && Array.isArray(A.rec.accounts) && A.rec.accounts.length === 1 && sameAddr(A.rec.accounts[0], next.account.address)
      // (B) takip ETMEYEN site: Manage Permissions'taki elle duzenlemenin yazdigi bayrak (applyManualAccountEdit -> followActive=false)
      await browser.sw().evaluate(`chrome.storage.local.get('dapps').then((o) => { const d = o.dapps || {}; if (d[${JSON.stringify(host)}]) d[${JSON.stringify(host)}].followActive = false; return chrome.storage.local.set({ dapps: d }) }).then(() => true)`)
      await sleep(500)
      const fourth = ctx.seed.nextAccount(next.vaults[0])
      const evMarkB = (await events(lab)).length
      await browser.sw().evaluate(`chrome.storage.local.set(${JSON.stringify({ vaults: fourth.vaults, active_account: fourth.active_account })}).then(() => true)`)
      await sleep(3000)
      const B = await gather(evMarkB)
      const leaked = B.evs.some((e) => e.data.some((a) => sameAddr(a, fourth.account.address)))
        || (Array.isArray(B.accts) && B.accts.some((a) => sameAddr(a, fourth.account.address)))
        || Boolean(B.rec && Array.isArray(B.rec.accounts) && B.rec.accounts.some((a) => sameAddr(a, fourth.account.address)))
      const noLeakOk = !leaked && Array.isArray(B.accts) && B.accts.length === 1 && sameAddr(B.accts[0], next.account.address)
      const variantNote = `varyant A (followActive site, sessiz yazici): tek accountsChanged([yeni]) + eth_accounts==[yeni] + kayit==[yeni]: ${followOk} (olaylar ${JSON.stringify(A.evs.map((e) => e.data))}, eth_accounts ${JSON.stringify(A.accts)}); varyant B (followActive=false site, 4. hesap sessizce aktif): yeni hesap SIZMADI: ${noLeakOk} (olaylar ${JSON.stringify(B.evs.map((e) => e.data))}, eth_accounts ${JSON.stringify(B.accts)}, kayit ${JSON.stringify(B.rec && B.rec.accounts)})`
      const ok = exactlyOne && accountsOk && signOk && followOk && noLeakOk
      return { status: ok ? 'PASS' : 'FAIL', detail: `TOPLAMDA tek accountsChanged([yeni]): ${exactlyOne}; eth_accounts yeni: ${accountsOk}; Lab yeni adresi gosteriyor: ${labShows}; yeni hesapla imza: ${signOk} ${signNote}; ${variantNote}`, evidence: { events: evs, approval: ap, signNote, signCall: call, variantA: { events: A.evs, accounts: A.accts, record: A.rec, ok: followOk }, variantB: { events: B.evs, accounts: B.accts, record: B.rec, leaked, ok: noLeakOk } } }
    },
  },
  {
    id: 'F9', phase: 'hermetic', cases: [7], title: 'Lab\'dan kes: wallet_revokePermissions -> chrome.storage.local.dapps\'ta ve UI\'da site yok',
    run: async (ctx) => {
      const { dapp: lab, browser } = ctx
      const host = new URL(lab.url).hostname
      const mark = (await calls(lab)).length
      await labClick(lab, LAB_SEL.accountButton, 'hesap dugmesi', async () => lab.evaluate(LAB_SEL.modalOpen))
      await labClick(lab, `__deep.all(document.querySelector('w3m-modal')).find((e) => ['wui-list-item', 'wui-button', 'wui-list-button', 'wui-icon-link'].includes(e.localName) && __deep.deepText(e).join(' ').trim() === 'Disconnect')`, 'Disconnect')
      await sleep(4000)
      if (await lab.evaluate(LAB_SEL.modalOpen)) await labClick(lab, LAB_SEL.modalCloseX, 'modal kapat').catch(() => {})
      const revoke = lastCall(await calls(lab), 'wallet_revokePermissions', mark)
      const stored = await browser.sw().evaluate(`chrome.storage.local.get('dapps').then((o) => Object.keys(o.dapps || {}))`)
      const gone = !stored.some((k) => k === host || k.endsWith(host))
      const text = await labText(lab)
      const labDisc = /Connect Wallet/i.test(text)
      // R-18: navigator.locks service worker'da calisiyor mu (dappsStore serilestirmesi buna dayanir)?
      const locks = await (await browser.swReady()).evaluate(`(async () => { if (typeof navigator === 'undefined' || !navigator.locks) return 'navigator.locks YOK'; return navigator.locks.request('qa-probe', async () => 'locks calisiyor') })()`).catch((e) => `hata: ${e.message}`)
      // UI YARISI (spec S6 F9: "chrome.storage.local.dapps VE UI'da site yok"): cuzdan Header'i Lab sekmesi icin
      // "Not Connected" demeli ve baglanti acilir menusunde Disconnect / Manage Permissions dugmeleri OLMAMALI.
      // Header yalniz AKTIF SEKMENIN ana makinesini gosterir (bagli siteler listesi yoktur); bu en dogrudan UI kanitidir.
      const connectedTitle = `${host} — ${uiText(ctx.en, 'header.connected')}`
      const notConnectedTitle = `${host} — ${uiText(ctx.en, 'header.not_connected')}`
      const ui = { notConnectedTitle, pillTitle: null, disconnectBtn: null, manageBtn: null, shot: null, error: null }
      const popup = await browser.openPopupWindowFor(lab).catch((e) => { ui.error = e.message; return null })
      if (popup) {
        try {
          await popup.waitFor(`!!document.querySelector('button[title*="${host}"]')`, { timeout: 25000, label: `Header baglanti dugmesi (${host})` })
          ui.pillTitle = await popup.evaluate(`document.querySelector('button[title*="${host}"]').getAttribute('title')`)
          await popup.evaluate(`document.querySelector('button[title*="${host}"]').click()`)
          await sleep(800)
          ui.disconnectBtn = await popup.evaluate(`!!document.querySelector('button[title="${uiText(ctx.en, 'header.disconnect')}"]')`)
          ui.manageBtn = await popup.evaluate(`!!document.querySelector('button[title="${uiText(ctx.en, 'header.manage_permissions')}"]')`)
          ui.shot = await evidenceOf(ctx, popup, 'F9-wallet-ui-after-revoke')
        } catch (e) { ui.error = e.message } finally { await browser.closeTarget(popup.targetId) }
      }
      const uiOk = ui.pillTitle === notConnectedTitle && ui.pillTitle !== connectedTitle && ui.disconnectBtn === false && ui.manageBtn === false
      const ok = Boolean(revoke) && gone && labDisc && uiOk
      return { status: ok ? 'PASS' : 'FAIL', detail: `wallet_revokePermissions -> ${JSON.stringify(revoke && (revoke.result ?? revoke.error))}; dapps anahtarlari: ${JSON.stringify(stored)} (site yok: ${gone}); Lab kopuk gorunuyor: ${labDisc}; cuzdan UI (Header dugmesi) '${ui.pillTitle}' (beklenen '${notConnectedTitle}'), Disconnect dugmesi: ${ui.disconnectBtn}, Manage Permissions dugmesi: ${ui.manageBtn}${ui.error ? ' [UI hatasi: ' + ui.error + ']' : ''}; SW navigator.locks: ${locks}`, evidence: { revoke, stored, swLocks: locks, ui } }
    },
  },
  {
    id: 'F10', phase: 'hermetic', cases: [7], title: 'cuzdan tarafi kes (Header): Lab "disconnected" olur',
    run: async (ctx) => {
      const { browser } = ctx
      const lab = ctx.dapp
      const host = new URL(lab.url).hostname
      await connectLab(ctx)
      const evBefore = (await events(lab)).length
      const popup = await browser.openPopupWindowFor(lab)
      let sawPill = false
      try {
        await popup.waitFor(`!!document.querySelector('button[title*="${host}"]')`, { timeout: 25000, label: `Header baglanti dugmesi (${host})` })
        sawPill = true
        await popup.evaluate(`document.querySelector('button[title*="${host}"]').click()`)
        await popup.waitFor(`!!document.querySelector('button[title="${uiText(ctx.en, 'header.disconnect')}"]')`, { timeout: 10000, label: 'Disconnect dugmesi' })
        await popup.evaluate(`document.querySelector('button[title="${uiText(ctx.en, 'header.disconnect')}"]').click()`)
        await sleep(3000)
      } catch (e) {
        if (!sawPill) return { status: 'DEVIATION', detail: `Header Lab sekmesini goremedi: ${e.message}`, evidence: { targets: browser.describe() } }
        throw e
      } finally {
        await browser.closeTarget(popup.targetId)
      }
      const evs = (await events(lab)).slice(evBefore)
      const sawEmpty = evs.some((e) => e.event === 'accountsChanged' && Array.isArray(e.data) && e.data.length === 0)
      const text = await labText(lab)
      const labDisc = /Connect Wallet/i.test(text)
      return { status: sawEmpty && labDisc ? 'PASS' : 'FAIL', detail: `accountsChanged([]) goruldu: ${sawEmpty}; Lab kopuk: ${labDisc}`, evidence: { events: evs, shot: await evidenceOf(ctx, lab, 'F10-after-wallet-disconnect') } }
    },
  },
  {
    id: 'F11', phase: 'hermetic', cases: [12], title: 'yenile ve yeniden baglan: kesikken Lab cuzdana cagri atmaz; baglanma temiz',
    run: async (ctx) => {
      const lab = ctx.dapp
      await lab.send('Page.reload')
      await lab.waitFor(`!!window.__deep && window.__deep.byTag('wui-connect-button').length > 0`, { timeout: 90000, label: 'Lab yeniden yuklendi' })
      await sleep(4000)
      const idle = (await calls(lab)).filter((c) => c.method !== 'eth_accounts')
      const c = await connectLab(ctx)
      const req = lastCall(await calls(lab), 'eth_requestAccounts', c.mark)
      const ok = req && Array.isArray(req.result) && sameAddr(req.result[0], await activeAddr(ctx)) && idle.length === 0
      return { status: ok ? 'PASS' : 'FAIL', detail: `kesikken yenilemede eth_accounts DISI cagri: ${JSON.stringify(idle.map((x) => x.method))}; yeniden baglanma: ${JSON.stringify(req && (req.result ?? req.error))}`, evidence: {} }
    },
  },
  {
    id: 'F12', phase: 'hermetic', cases: [13], title: '"Fetch Capabilities": wallet_getCapabilities -> 4200, Lab "No capabilities found"',
    run: async (ctx) => {
      const lab = ctx.dapp
      const mark = (await calls(lab)).length
      await labClick(lab, LAB_SEL.button('Fetch Capabilities'), 'Fetch Capabilities')
      await sleep(5000)
      const cap = lastCall(await calls(lab), 'wallet_getCapabilities', mark)
      const text = await labText(lab)
      const ok = cap && cap.error && cap.error.code === 4200
      return { status: ok ? 'PASS' : 'FAIL', detail: `wallet_getCapabilities -> ${JSON.stringify(cap && (cap.result ?? cap.error))}; Lab 'No capabilities found': ${/No capabilities found/i.test(text)}`, evidence: {} }
    },
  },
  {
    id: 'F13', phase: 'hermetic', cases: [10, 11], title: 'negatifler: chainId uyusmazligi, boyut asimi, bilinmeyen yontem, hibesiz imza, yaprak uyusmazligi: hepsi SAYISAL kod',
    run: async (ctx) => {
      const { dapp: lab, browser } = ctx
      const acct = await activeAddr(ctx)
      const other = '0x000000000000000000000000000000000000dEaD'
      const typed = (domainChainId, extra = {}) => JSON.stringify({
        domain: { name: 'Ether Mail', version: '1', chainId: domainChainId, verifyingContract: '0xcccccccccccccccccccccccccccccccccccccccc' },
        message: { from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' }, to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' }, contents: 'Hello, Bob!', ...extra },
        primaryType: 'Mail',
        types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }], Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }] },
      })
      const leafMismatch = JSON.stringify({ domain: { name: 'X', version: '1' }, message: { allowed: 'false' }, primaryType: 'Perm', types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }], Perm: [{ name: 'allowed', type: 'bool' }] } })
      const cases = [
        { name: 'chainId uyusmazligi', method: 'eth_signTypedData_v4', params: [acct, typed(999999)], want: -32602 },
        { name: 'boyut asimi', method: 'eth_signTypedData_v4', params: [acct, typed(1, { contents: 'x'.repeat(600000) })], want: -32602 },
        { name: 'bilinmeyen yontem', method: 'wallet_foo_bar', params: [], want: 4200 },
        { name: 'hibesiz hesapla imza', method: 'personal_sign', params: ['0x68656c6c6f', other], want: 4100 },
        { name: 'yaprak uyusmazligi allowed:"false"', method: 'eth_signTypedData_v4', params: [acct, leafMismatch], want: -32602 },
        // Okuma gecidi (T4b) YAPILDIYSA: QA_READ_GATE=1 ile calistirin. Forwarded okuma sonuc doner; yasak yontem 4200.
        ...(process.env.QA_READ_GATE === '1' ? [
          { name: 'okuma gecidi eth_blockNumber (iletilir)', method: 'eth_blockNumber', params: [], wantOk: true },
          { name: 'okuma gecidi eth_sendRawTransaction (YASAK)', method: 'eth_sendRawTransaction', params: ['0x02f8'], want: 4200 },
        ] : []),
      ]
      // Onay penceresi kisiti: hak HARCAMAYAN vakalar (bilinmeyen yontem, okuma gecidi) aralanmaz; digerleri her vakadan
      // sonra APPROVAL_PACE_MS bekler (aksi halde 4. hak harcayan vaka -32602 yerine -32005 alir).
      const NO_APPROVAL_SLOT = new Set(['wallet_foo_bar', 'eth_blockNumber', 'eth_sendRawTransaction'])
      const rows = []
      for (const c of cases) {
        const fetchCountBefore = ctx.stub.requests.length
        const res = await lab.evaluate(`Promise.race([window.ethereum.request({ method: ${JSON.stringify(c.method)}, params: ${JSON.stringify(c.params)} }).then((r) => ({ ok: r }), (e) => ({ err: { code: e && e.code, message: e && e.message } })), new Promise((r) => setTimeout(() => r({ hang: true }), 20000))])`)
        // Hata yolunda onay penceresi ACILMAMALI (hata kodu mesajdan ONCE doner).
        const popped = browser.sessions && [...browser.sessions.values()].some((s) => s.origin === 'approval')
        const good = c.wantOk ? Boolean(res.ok) && !popped : Boolean(res.err) && res.err.code === c.want && typeof res.err.code === 'number' && !popped
        rows.push({ name: c.name, want: c.wantOk ? 'sonuc' : c.want, got: res.err ? res.err.code : res.hang ? 'ASILI' : 'basarili', numeric: res.err ? typeof res.err.code === 'number' : false, windowOpened: Boolean(popped), ok: good, stubRequestsDuring: ctx.stub.requests.length - fetchCountBefore })
        if (!NO_APPROVAL_SLOT.has(c.method)) await paceApprovals()
      }
      const ok = rows.every((r) => r.ok)
      return { status: ok ? 'PASS' : 'FAIL', detail: rows.map((r) => `${r.name}: ${r.got} (beklenen ${r.want})${r.windowOpened ? ' PENCERE ACILDI' : ''}${r.got === -32005 ? ' [-32005: HARNESS ARALAMA hatasi, cuzdan kusuru DEGIL]' : ''}`).join('; '), evidence: { rows } }
    },
  },
  {
    id: 'F14', phase: 'hermetic', cases: [9, 10], title: 'kilitli / soguk SW: istek KILITLI cuzdanla baslar (Login sonra onay); KONTROL kosusu (SW durmaz) + istek ile onay arasinda SW durdurulan kosu',
    run: async (ctx) => {
      const { dapp: lab, browser } = ctx
      // Bir tur: KILITLI baslangic (oturum anahtarini sil), personal_sign iste, Login -> Sign, istege bagli SW durdur, Sign'a bas.
      const round = async (label, { stopSw }) => {
        const notes = []
        await browser.sw().evaluate(`chrome.storage.session.remove('sessionMasterKeyJwk').then(() => true)`)
        const acct = await activeAddr(ctx)
        await lab.evaluate(`window.__f14 = window.ethereum.request({ method: 'personal_sign', params: ['0x68656c6c6f', ${JSON.stringify(acct)}] }).then((r) => ({ ok: r }), (e) => ({ err: { code: e && e.code, message: e && e.message } })); true`)
        const a = await browser.waitApproval({ timeout: 30000 })
        await a.waitFor(`!!document.getElementById('login-password') || document.body.innerText.toLowerCase().includes(${JSON.stringify(uiText(ctx.en, 'dapps.sign.title').toLowerCase())})`, { timeout: 40000, label: 'Login veya Sign ekrani' })
        const sawLogin = await a.evaluate(`!!document.getElementById('login-password')`)
        notes.push(`onay penceresi kilitliyken ilk ekran: ${sawLogin ? 'Login' : 'Sign (kilit acik gorunuyor)'}`)
        const loginShot = sawLogin ? await evidenceOf(ctx, a, `F14-${label}-login`) : null
        if (sawLogin) await unlockViaLogin(a, ctx.seed.password).catch((e) => notes.push(`Login hatasi: ${e.message}`))
        await a.waitFor(`document.body.innerText.toLowerCase().includes(${JSON.stringify(uiText(ctx.en, 'dapps.sign.title').toLowerCase())})`, { timeout: 40000, label: 'Sign ekrani (kilit acildiktan sonra)' })
        // Onceki islem katmani (bkz. approve()) Sign ekranini ortuyorsa kalkana kadar bekle; goruntu gercek Sign ekranini gostersin.
        const overlayExpr = `document.body.innerText.includes(${JSON.stringify(`${uiText(ctx.en, 'transactionStatus.transactions')} (`)})`
        if (await a.evaluate(overlayExpr).catch(() => false)) await a.waitFor(`!(${overlayExpr})`, { timeout: 15000 }).catch(() => {})
        const signShot = await evidenceOf(ctx, a, `F14-${label}-sign`)
        // SW'yi ISTEK ile ONAY arasinda durdur. `ServiceWorker` CDP alani TARAYICI duzeyinde degil, SAYFA
        // oturumunda bulunur (2026-10-05 olcumu: tarayici oturumunda 'ServiceWorker.enable wasn't found').
        let stopped = false
        if (stopSw) {
          let h = null
          try {
            const found = []
            h = (m) => { if (m.method === 'ServiceWorker.workerVersionUpdated' && m.sessionId === lab.sessionId) found.push(...m.params.versions) }
            browser.cdp.on(h)
            await lab.send('ServiceWorker.enable')
            await sleep(2000)
            const v = found.reverse().find((x) => String(x.scriptURL || '').includes(browser.extId) && x.runningStatus === 'running')
            if (v) { await lab.send('ServiceWorker.stopWorker', { versionId: v.versionId }); stopped = true } else notes.push(`calisan uzanti SW surumu bulunamadi (gorulen surumler: ${found.length})`)
            await lab.send('ServiceWorker.disable').catch(() => {})
          } catch (e) { notes.push(`ServiceWorker.stopWorker kullanilamadi: ${e.message}`) } finally { if (h) browser.cdp.off(h) }
          notes.push(`SW durduruldu: ${stopped}`)
          await sleep(1500)
        }
        let signed = null
        try {
          await clickButton(a, uiText(ctx.en, 'dapps.sign.btn_sign'), { timeout: 15000 })
          signed = await lab.evaluate(`Promise.race([window.__f14, new Promise((r) => setTimeout(() => r({ hang: true }), 40000))])`)
        } catch (e) { notes.push(`imza adimi: ${e.message}`) }
        await browser.waitClosed(a.targetId).catch(() => {})
        await paceApprovals() // her tur bir onay penceresi hakki harcar (-32005): sonraki turu ara
        let recovered = null
        if (signed && signed.ok) { try { recovered = verifyMessage('hello', signed.ok) } catch { /* gecersiz imza */ } }
        return { notes, signed, stopped, sawLogin, acct, recovered, shots: { loginShot, signShot } }
      }
      // (1) KONTROL: SW durmaz. Kilitli baslangic -> Login -> Sign -> GECERLI imza (kilitli-baslangic basari yolu).
      const control = await round('kontrol', { stopSw: false })
      const controlOk = Boolean(control.signed && control.signed.ok) && control.recovered !== null && sameAddr(control.recovered, control.acct)
      // (2) SW DURDURULAN tur: sayisal kod veya gecerli imza, ASILI KALMAZ.
      const stop = await round('sw-durdurulan', { stopSw: true })
      const numeric = stop.signed && (stop.signed.ok || (stop.signed.err && typeof stop.signed.err.code === 'number'))
      const ok = controlOk && Boolean(numeric)
      return { status: ok ? (stop.stopped ? 'PASS' : 'DEVIATION') : 'FAIL', detail: `KONTROL (SW durmaz): ${control.notes.join('; ')}; imza ${controlOk ? 'GECERLI (imzalayan == aktif hesap)' : 'GECERSIZ/yok: ' + JSON.stringify(control.signed)}. SW DURDURULAN: ${stop.notes.join('; ')}; dapp sonucu: ${JSON.stringify(stop.signed)} (sayisal kod veya basarili imza beklenir, ASILI KALMAMALI)`, evidence: { control: { signed: control.signed, recovered: control.recovered, ok: controlOk, shots: control.shots }, signed: stop.signed, stopRound: { stopped: stop.stopped, shots: stop.shots } } }
    },
  },
]
