import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Interface, TypedDataEncoder, Wallet, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers'
import { createCowService } from './service'
import { XSTOCKS } from '../../data/xStocks'
import { APPROVE_WINDOW_MS, FEE_PREPARE_TIMEOUT_MS, GPV2_VAULT_RELAYER, ORDER_VALIDITY_SEC, PAY_TOKENS } from './config'
import { buildAppData, buildOrder, buildPostBody, orderDigest, orderTypedData, orderUid } from './order'
import { PERMIT_ABI, permitDomain, permitTypedData } from './permit'
import * as quoteStoreFns from './quoteStore'
import { blokGovdesi, yorumsuz } from '../../test-utils/kaynakTarama'

// permitTypedData sarmalanir: domain-yetkisiz dogrulama testi uretim kodunun IMZADAN ONCE kendi kontrolunu yapmasini sinar
vi.mock('./permit', async (orijinal) => {
  const m = await orijinal()
  return { ...m, permitTypedData: vi.fn((...a) => m.permitTypedData(...a)) }
})
const gercekPermit = await vi.importActual('./permit')

const HARDHAT_0_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // herkesce bilinen test anahtari
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ATTACKER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const NOW = 1_800_000_000_000
const VALID_TO = Math.floor(NOW / 1000) + ORDER_VALIDITY_SEC

const STOCK_ETH = XSTOCKS.find((s) => s.chains.includes(1))
const USDC = PAY_TOKENS[1].find((t) => t.symbol === 'USDC')
const PERMIT_IFACE = new Interface(PERMIT_ABI)

let sayac = 0
const yeniId = () => (++sayac).toString(16).padStart(32, '0')

function kayitUret(ek = {}) {
  const ad = buildAppData({ recipient: RECIPIENT })
  return {
    quoteId: yeniId(),
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    approveUntil: NOW + APPROVE_WINDOW_MS,
    owner: OWNER,
    chainId: 1,
    side: 'buy',
    symbol: STOCK_ETH.symbol,
    stockAddress: STOCK_ETH.address,
    payToken: USDC.address,
    sellToken: USDC.address,
    buyToken: STOCK_ETH.address,
    sellAmount: '100000000',
    networkFee: '0', // CoW feeAmount, sat tokeninde (quote() kayda yazar)
    expectedBuy: '263000000000000000',
    minBuy: '261000000000000000',
    sellDecimals: 6,
    buyDecimals: STOCK_ETH.decimals,
    protocolFeeBps: 2,
    fees: { network: '1', protocol: '2', partner: '3' },
    cowQuoteId: 777,
    verified: false,
    appData: { json: ad.json, hash: ad.hash },
    approval: { mode: 'none', allowance: '100000000' },
    locked: false,
    lockReason: null,
    consumed: false,
    display: {},
    reference: 380,
    ...ek,
  }
}

// POST govdesinden beklenen UID (uretim kodundan bagimsiz yeniden kurulum)
function uidOfBody(chainId, b) {
  const order = {
    sellToken: b.sellToken,
    buyToken: b.buyToken,
    receiver: b.receiver,
    sellAmount: b.sellAmount,
    buyAmount: b.buyAmount,
    validTo: b.validTo,
    appData: b.appDataHash,
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  }
  return orderUid(orderDigest(chainId, order), b.from, b.validTo)
}

const USDC_PERMIT = (nonce = 5n) => ({
  ok: true,
  name: 'USD Coin',
  version: '2',
  nonce,
  separator: TypedDataEncoder.hashDomain(permitDomain({ chainId: 1, token: USDC.address, name: 'USD Coin', version: '2' })),
})

function kur(ek = {}) {
  const cagrilar = []
  const kayit = (ad, fn) =>
    vi.fn(async (...a) => {
      cagrilar.push(ad)
      return fn(...a)
    })

  // chrome.storage.session taklidi (gercek quoteStore uzerinden: claim/consumed davranisi gercek)
  const kutu = {}
  const storage = {
    get: async (k) => (k === null ? { ...kutu } : k in kutu ? { [k]: structuredClone(kutu[k]) } : {}),
    set: async (o) => Object.assign(kutu, structuredClone(o)),
    remove: async (ks) => ks.forEach((k) => delete kutu[k]),
  }
  const quoteStore = {
    newQuoteId: yeniId,
    saveQuote: (r) => quoteStoreFns.saveQuote(r, { storage, now: NOW }),
    claimQuote: kayit('quoteStore.claimQuote', (a) => quoteStoreFns.claimQuote({ ...a, storage })),
    getQuote: (id) => quoteStoreFns.getQuote(id, { storage }),
  }

  const liste = (ek.orders ?? []).map((r) => structuredClone(r))
  const orders = {
    loadOrders: kayit('orders.loadOrders', () => liste.map((r) => ({ ...r }))),
    saveOrder: kayit('orders.saveOrder', (r) => {
      liste.push(structuredClone(r))
    }),
    patchOrder: kayit('orders.patchOrder', (uid, p) => {
      const i = liste.findIndex((r) => r.uid === uid)
      if (i !== -1) liste[i] = { ...liste[i], ...p }
    }),
    removeOrder: kayit('orders.removeOrder', (uid) => {
      const i = liste.findIndex((r) => r.uid === uid)
      if (i !== -1) liste.splice(i, 1)
    }),
  }
  const satirlar = []
  const pendingRows = {
    save: kayit('pendingRows.save', (row) => {
      satirlar.push(row)
    }),
    remove: kayit('pendingRows.remove', (uid) => {
      const i = satirlar.findIndex((r) => r.cow_uid === uid)
      if (i !== -1) satirlar.splice(i, 1)
    }),
    resolve: vi.fn(),
  }
  const api = {
    postOrder: kayit('api.postOrder', (chainId, body) =>
      ek.postOrder ? ek.postOrder(chainId, body) : { ok: true, data: uidOfBody(chainId, body) },
    ),
  }
  const chain = {
    readAllowance: kayit('chain.readAllowance', () => ek.allowance ?? 100_000_000n),
    readBalance: kayit('chain.readBalance', () => ek.balance ?? 10n ** 30n),
    readPermitInfo: kayit('chain.readPermitInfo', () => ek.permitInfo ?? { ok: false }),
  }
  const servis = createCowService({
    api,
    chain,
    reference: {},
    quoteStore,
    orders,
    pendingRows,
    now: () => NOW,
    recipient: 'recipient' in ek ? ek.recipient : RECIPIENT,
    fee: ek.fee,
    feeEnabled: ek.feeEnabled,
  })

  const wallet = new Wallet(HARDHAT_0_KEY)
  const imzaSpy = vi.spyOn(wallet, 'signTypedData')
  const getSigner = vi.fn(async () => (ek.signer ? ek.signer(wallet) : wallet))

  const kaydet = async (r) => {
    await quoteStore.saveQuote(r)
    return r
  }
  const calistir = (record, ek2 = {}) =>
    servis.placeOrder({ quoteId: record.quoteId, activeAddress: OWNER, getSigner, ...ek2 })

  return { servis, api, chain, orders, pendingRows, getSigner, imzaSpy, cagrilar, liste, satirlar, kaydet, calistir, storage, kutu }
}

const SIRA = ['orders.saveOrder', 'pendingRows.save', 'api.postOrder', 'orders.patchOrder']
const siraFiltre = (cagrilar) => cagrilar.filter((c) => SIRA.includes(c))

beforeEach(() => {
  permitTypedData.mockReset()
  permitTypedData.mockImplementation((...a) => gercekPermit.permitTypedData(...a))
})

describe('placeOrder mutlu yol (Ethereum USDC, mod none)', () => {
  it('govde buildPostBody ile birebir, sabit alanlar, imza owner a ait, cagri sirasi write-ahead', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret())
    const sonuc = await t.calistir(r)

    expect(sonuc.success).toBe(true)
    expect(sonuc.state).toBe('open')
    expect(sonuc.validTo).toBe(VALID_TO)
    expect(t.api.postOrder).toHaveBeenCalledTimes(1)
    const [chainId, body] = t.api.postOrder.mock.calls[0]
    expect(chainId).toBe(1)

    const order = buildOrder({
      sellToken: r.sellToken,
      buyToken: r.buyToken,
      owner: OWNER,
      sellAmount: r.sellAmount,
      buyAmount: r.minBuy,
      validTo: VALID_TO,
      appDataHash: r.appData.hash,
    })
    const beklenen = buildPostBody({
      order,
      signature: body.signature,
      quoteId: r.cowQuoteId,
      appDataJson: r.appData.json,
      appDataHash: r.appData.hash,
    })
    expect(body).toEqual(beklenen)
    expect(Object.keys(body)).toEqual(Object.keys(beklenen))
    expect(body.receiver).toBe(OWNER)
    expect(body.from).toBe(OWNER)
    expect(body.feeAmount).toBe('0')
    expect(body.kind).toBe('sell')
    expect(body.sellAmount).toBe(r.sellAmount)
    expect(body.buyAmount).toBe(r.minBuy)
    expect(body.validTo).toBe(VALID_TO)
    expect(body.quoteId).toBe(777)

    const td = orderTypedData(1, order)
    expect(verifyTypedData(td.domain, td.types, td.message, body.signature)).toBe(OWNER)
    expect(sonuc.uid).toBe(uidOfBody(1, body))

    expect(siraFiltre(t.cagrilar)).toEqual(SIRA)
    expect(t.liste).toHaveLength(1)
    expect(t.liste[0].status).toBe('open')
    expect(t.liste[0].postBody).toBeNull()
    expect(t.liste[0].apiStatus).toBe('open')
    expect(t.liste[0].approvalMode).toBe('none')
  })

  it('Gecmis satiri kullanici biriminde ve CoW kimligiyle yazilir', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret())
    const sonuc = await t.calistir(r)
    expect(t.satirlar).toHaveLength(1)
    const satir = t.satirlar[0]
    expect(satir.cow_uid).toBe(sonuc.uid)
    expect(satir.chain_id).toBe(1)
    expect(satir.erc20_transfers[0]).toMatchObject({ direction: 'send', token_symbol: 'USDC', value_formatted: '100.0' })
    expect(satir.erc20_transfers[1]).toMatchObject({ direction: 'receive', token_symbol: STOCK_ETH.symbol, value_formatted: '0.261' })
  })

  it('kayittaki appData hash i uretilenle uyusmazsa INVALID_ORDER ve POST yok', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ appData: { json: '{}', hash: '0x' + '11'.repeat(32) } }))
    const sonuc = await t.calistir(r)
    expect(sonuc).toEqual({ success: false, code: 'INVALID_ORDER' })
    expect(t.api.postOrder).not.toHaveBeenCalled()
    expect(t.imzaSpy).not.toHaveBeenCalled()
  })
})

describe('placeOrder Review Focus 2: imzalanan yapiyi istek belirleyemez', () => {
  it('istekteki receiver / sellAmount / buyAmount / validTo / sellToken yok sayilir', async () => {
    const t1 = kur()
    const r1 = await t1.kaydet(kayitUret({ quoteId: yeniId() }))
    await t1.calistir(r1)
    const t2 = kur()
    const r2 = await t2.kaydet(kayitUret({ quoteId: yeniId() }))
    await t2.calistir(r2, {
      receiver: ATTACKER,
      sellAmount: '1',
      buyAmount: '0',
      validTo: 1,
      sellToken: ATTACKER,
      owner: ATTACKER,
      chainId: 56,
    })
    const b1 = t1.api.postOrder.mock.calls[0][1]
    const b2 = t2.api.postOrder.mock.calls[0][1]
    // imza deterministik (RFC6979): govde birebir ayni olmali
    expect(b2).toEqual(b1)
    expect(t2.api.postOrder.mock.calls[0][0]).toBe(1)
    expect(b2.receiver).toBe(OWNER)
    expect(b2.sellToken).toBe(USDC.address)
  })

  it('kaynak: imza yalniz quoteId, activeAddress, getSigner alir; govdede request. / req. yok', () => {
    const kaynak = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'service.js'), 'utf8'))
    const imza = kaynak.match(/async function placeOrder\(\{([^}]*)\}/)
    expect(imza).not.toBeNull()
    expect(imza[1].split(',').map((s) => s.trim()).filter(Boolean)).toEqual(['quoteId', 'activeAddress', 'getSigner'])
    const ic = kaynak.match(/async function placeOrderInner\(\{([^}]*)\}/)
    expect(ic[1].split(',').map((s) => s.trim()).filter(Boolean)).toEqual(['quoteId', 'activeAddress', 'getSigner'])
    for (const govde of [
      blokGovdesi(kaynak, /async function placeOrderInner\(\{[^}]*\}\)\s*/),
      blokGovdesi(kaynak, /async function placeOrder\(\{[^}]*\} = \{\}\)\s*/),
    ]) {
      expect(govde).toBeTruthy()
      expect(govde).not.toMatch(/\breq(uest)?\./)
    }
  })
})

describe('placeOrder reddedilenler: getSigner ve postOrder YOK', () => {
  const temiz = (t) => {
    expect(t.getSigner).not.toHaveBeenCalled()
    expect(t.api.postOrder).not.toHaveBeenCalled()
    expect(t.imzaSpy).not.toHaveBeenCalled()
    expect(t.liste).toHaveLength(0)
  }

  it('bilinmeyen quoteId', async () => {
    const t = kur()
    const sonuc = await t.servis.placeOrder({ quoteId: 'ff'.repeat(16), activeAddress: OWNER, getSigner: t.getSigner })
    expect(sonuc).toEqual({ success: false, code: 'QUOTE_NOT_FOUND' })
    temiz(t)
  })

  it('bicimi bozuk quoteId', async () => {
    const t = kur()
    const sonuc = await t.servis.placeOrder({ quoteId: { toString: () => 'x' }, activeAddress: OWNER, getSigner: t.getSigner })
    expect(sonuc).toEqual({ success: false, code: 'INVALID_REQUEST' })
    temiz(t)
  })

  it('suresi dolmus kayit', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ expiresAt: NOW - 1 }))
    expect(await t.calistir(r)).toEqual({ success: false, code: 'QUOTE_EXPIRED' })
    temiz(t)
  })

  it('kullanilmis kayit (ikinci cagri)', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret())
    expect((await t.calistir(r)).success).toBe(true)
    t.api.postOrder.mockClear()
    t.getSigner.mockClear()
    expect(await t.calistir(r)).toEqual({ success: false, code: 'QUOTE_USED' })
    expect(t.api.postOrder).not.toHaveBeenCalled()
    expect(t.getSigner).not.toHaveBeenCalled()
  })

  it('kilitli (locked) kayit', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ locked: true, lockReason: 'PRICE_PROTECTION' }))
    expect(await t.calistir(r)).toEqual({ success: false, code: 'QUOTE_LOCKED' })
    temiz(t)
  })

  // 2026-10-21: placeOrder kapiyi kayittan YENIDEN hesaplar (locked bayragina guvenmez); quote() ile ayni tradeGate
  it('ag ucreti %10 ustu (%11) -> placeOrder ucret yuzunden REDDETMEZ, emir kurulur (kullanici karari)', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ networkFee: '11000000', expectedBuy: '234210526315789473' }))
    const res = await t.calistir(r)
    expect(res.success).toBe(true)
    expect(t.api.postOrder).toHaveBeenCalledTimes(1)
  })

  it('ag ucreti tam %10 ve fiyat temiz -> emir kurulur', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ networkFee: '10000000', expectedBuy: '236842105263157894' }))
    expect((await t.calistir(r)).success).toBe(true)
  })

  it('locked=false ama fiyat 5 kat -> PRICE_PROTECTION (ucret haric fiyat)', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ expectedBuy: '52000000000000000' }))
    expect(await t.calistir(r)).toEqual({ success: false, code: 'PRICE_PROTECTION' })
    temiz(t)
  })

  it('ucret %6 ve spot sapma kucuk: ucret fiyata katilmaz, emir kurulur', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ networkFee: '6000000', expectedBuy: '247368421052631578' }))
    expect((await t.calistir(r)).success).toBe(true)
  })

  it('kayitta networkFee yok ya da bozuk -> fail-closed BAD_QUOTE_RESPONSE', async () => {
    for (const networkFee of [undefined, 'abc', '-1']) {
      const t = kur()
      const r = await t.kaydet(kayitUret({ networkFee }))
      expect(await t.calistir(r)).toEqual({ success: false, code: 'BAD_QUOTE_RESPONSE' })
      temiz(t)
    }
  })

  it('onchain modlu kayit: APPROVAL_REQUIRED ve kayit tuketilmez', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret({ approval: { mode: 'onchain', allowance: '0' } }))
    expect(await t.calistir(r)).toEqual({ success: false, code: 'APPROVAL_REQUIRED' })
    temiz(t)
    const saklanan = await quoteStoreFns.getQuote(r.quoteId, { storage: t.storage })
    expect(saklanan.consumed).toBe(false)
  })

  it('baska activeAddress', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r, { activeAddress: ATTACKER })).toEqual({ success: false, code: 'ACCOUNT_CHANGED' })
    temiz(t)
  })

  it('signer adresi kayittaki owner dan farkli: ACCOUNT_CHANGED, imza ve POST yok', async () => {
    const t = kur({ signer: () => ({ address: ATTACKER, signTypedData: vi.fn() }) })
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'ACCOUNT_CHANGED' })
    expect(t.api.postOrder).not.toHaveBeenCalled()
    expect(t.liste).toHaveLength(0)
    expect(t.imzaSpy).not.toHaveBeenCalled()
  })

  it('ortak alici (recipient) tanimsizsa emir kurulmaz', async () => {
    const t = kur({ recipient: null })
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'PARTNER_FEE_RECIPIENT_MISSING' })
    temiz(t)
  })

  it('none modunda taze allowance yetersiz: APPROVAL_REQUIRED, imza yok', async () => {
    const t = kur({ allowance: 99_999_999n })
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'APPROVAL_REQUIRED' })
    temiz(t)
  })

  it('bakiye yetersiz', async () => {
    const t = kur({ balance: 99_999_999n })
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'INSUFFICIENT_BALANCE' })
    temiz(t)
  })
})

describe('placeOrder cift tik ve bakiye rezervi', () => {
  it('ayni teklife es zamanli iki cagri: tam bir POST, digeri QUOTE_USED', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret())
    const [a, b] = await Promise.all([t.calistir(r), t.calistir(r)])
    expect(t.api.postOrder).toHaveBeenCalledTimes(1)
    const sonuclar = [a, b]
    expect(sonuclar.filter((s) => s.success)).toHaveLength(1)
    expect(sonuclar.find((s) => !s.success)).toEqual({ success: false, code: 'QUOTE_USED' })
    expect(t.getSigner).toHaveBeenCalledTimes(1)
  })

  it('iki ayri teklif, bakiye yalniz birine yeter: ikincisi INSUFFICIENT_BALANCE (bekleyen kayit rezervi)', async () => {
    const t = kur({ balance: 150_000_000n })
    const r1 = await t.kaydet(kayitUret())
    const r2 = await t.kaydet(kayitUret())
    expect((await t.calistir(r1)).success).toBe(true)
    expect(await t.calistir(r2)).toEqual({ success: false, code: 'INSUFFICIENT_BALANCE' })
    expect(t.api.postOrder).toHaveBeenCalledTimes(1)
  })
})

describe('placeOrder permit (Review Focus 3)', () => {
  const permitKayit = (ek = {}) => kayitUret({ approval: { mode: 'permit', allowance: '0' }, ...ek })

  it('hook appData ya girer; hash eslesir; govdede quoteId YOK; permit imzasi owner a ait', async () => {
    const t = kur({ allowance: 0n, permitInfo: USDC_PERMIT(5n) })
    const r = await t.kaydet(permitKayit())
    const sonuc = await t.calistir(r)
    expect(sonuc).toMatchObject({ success: true, state: 'open' })
    const body = t.api.postOrder.mock.calls[0][1]

    const meta = JSON.parse(body.appData)
    const hook = meta.metadata.hooks.pre[0]
    expect(hook.target).toBe(USDC.address)
    const [owner, spender, value, deadline] = PERMIT_IFACE.decodeFunctionData('permit', hook.callData)
    expect(owner).toBe(OWNER)
    expect(spender).toBe(GPV2_VAULT_RELAYER)
    expect(value).toBe(2n ** 256n - 1n)
    expect(Number(deadline)).toBe(VALID_TO)
    expect(body.appDataHash).toBe(keccak256(toUtf8Bytes(body.appData)))
    expect(body.appDataHash).not.toBe(r.appData.hash)
    expect('quoteId' in body).toBe(false)
    expect(t.liste[0].approvalMode).toBe('permit')

    // iki imza: permit + emir; permit nonce 5 ile
    expect(t.imzaSpy).toHaveBeenCalledTimes(2)
    const permitMesaji = t.imzaSpy.mock.calls[0][2]
    expect(permitMesaji.nonce).toBe('5')
    expect(permitMesaji.owner).toBe(OWNER)
  })

  it('hook suz emirde quoteId = kayittaki cowQuoteId', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret())
    await t.calistir(r)
    expect(t.api.postOrder.mock.calls[0][1].quoteId).toBe(r.cowQuoteId)
  })

  it('ayirici uyusmazligi: PERMIT_DOMAIN_MISMATCH, hicbir imza atilmaz, POST yok', async () => {
    const info = { ...USDC_PERMIT(), separator: '0x' + '11'.repeat(32) }
    const t = kur({ allowance: 0n, permitInfo: info })
    const r = await t.kaydet(permitKayit())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'PERMIT_DOMAIN_MISMATCH' })
    expect(t.imzaSpy).not.toHaveBeenCalled()
    expect(t.api.postOrder).not.toHaveBeenCalled()
    expect(t.liste).toHaveLength(0)
  })

  it('permit bilgisi okunamadi: PERMIT_DOMAIN_MISMATCH, imza yok', async () => {
    const t = kur({ allowance: 0n, permitInfo: { ok: false } })
    const r = await t.kaydet(permitKayit())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'PERMIT_DOMAIN_MISMATCH' })
    expect(t.imzaSpy).not.toHaveBeenCalled()
    expect(t.api.postOrder).not.toHaveBeenCalled()
  })

  // Task 8 denetim notu: domain dogru ayiriciyi tutsa bile imza BASKA token/aga ait olamaz
  it.each([
    ['baska token', { verifyingContract: ATTACKER }],
    ['baska ag', { chainId: 137 }],
  ])('typedData.domain %s icin kurulmussa imza yok (fail-closed)', async (_ad, degisim) => {
    const gercek = permitDomain({ chainId: 1, token: USDC.address, name: 'USD Coin', version: '2' })
    const yanlis = { ...gercek, ...degisim }
    // ayirici YANLIS domain e gore verilir: verifyPermitDomain gecer, yalniz acik token/ag kontrolu yakalar
    const t = kur({ allowance: 0n, permitInfo: { ...USDC_PERMIT(), separator: TypedDataEncoder.hashDomain(yanlis) } })
    permitTypedData.mockImplementationOnce((a) => ({ ...gercekPermit.permitTypedData(a), domain: yanlis }))
    const r = await t.kaydet(permitKayit())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'PERMIT_DOMAIN_MISMATCH' })
    expect(t.imzaSpy).not.toHaveBeenCalled()
    expect(t.api.postOrder).not.toHaveBeenCalled()
  })

  it('permit modunda taze allowance >= S: hook suz gider, permit bilgisi okunmaz', async () => {
    const t = kur({ allowance: 100_000_000n, permitInfo: USDC_PERMIT() })
    const r = await t.kaydet(permitKayit())
    const sonuc = await t.calistir(r)
    expect(sonuc.success).toBe(true)
    const body = t.api.postOrder.mock.calls[0][1]
    expect(JSON.parse(body.appData).metadata.hooks).toBeUndefined()
    expect(body.appDataHash).toBe(r.appData.hash)
    expect(body.quoteId).toBe(r.cowQuoteId)
    expect(t.chain.readPermitInfo).not.toHaveBeenCalled()
    expect(t.imzaSpy).toHaveBeenCalledTimes(1)
    expect(t.liste[0].approvalMode).toBe('none')
  })
})

describe('placeOrder POST sonuclari (Review Focus 4)', () => {
  it('201 ve UID esit (buyuk harfli yanit dahil): open', async () => {
    const t = kur({ postOrder: (c, b) => ({ ok: true, data: '0x' + uidOfBody(c, b).slice(2).toUpperCase() }) })
    const r = await t.kaydet(kayitUret())
    const sonuc = await t.calistir(r)
    expect(sonuc).toMatchObject({ success: true, state: 'open' })
    expect(sonuc.duplicated).toBeUndefined()
    expect(t.liste[0].status).toBe('open')
  })

  it('duplicated (DuplicatedOrder): basari, open + duplicated:true', async () => {
    const t = kur({ postOrder: () => ({ ok: true, data: null, duplicated: true }) })
    const r = await t.kaydet(kayitUret())
    const sonuc = await t.calistir(r)
    expect(sonuc).toMatchObject({ success: true, state: 'open', duplicated: true })
    expect(t.liste[0].status).toBe('open')
    expect(t.liste[0].postBody).toBeNull()
  })

  it('UID farkli: UID_MISMATCH, kayit submitting kalir + lastError', async () => {
    const t = kur({ postOrder: () => ({ ok: true, data: '0x' + 'ab'.repeat(56) }) })
    const r = await t.kaydet(kayitUret())
    const sonuc = await t.calistir(r)
    expect(sonuc.success).toBe(false)
    expect(sonuc.code).toBe('UID_MISMATCH')
    expect(sonuc.uid).toMatch(/^0x[0-9a-f]{112}$/)
    expect(t.liste).toHaveLength(1)
    expect(t.liste[0].status).toBe('submitting')
    expect(t.liste[0].lastError).toBe('UID_MISMATCH')
    expect(t.liste[0].postBody).not.toBeNull()
    expect(t.satirlar).toHaveLength(1)
  })

  it.each(['NETWORK', 'TIMEOUT', 'SERVER'])('%s: belirsiz, success:true state submitting; kayit ve satir kalir', async (code) => {
    const t = kur({ postOrder: () => ({ ok: false, code }) })
    const r = await t.kaydet(kayitUret())
    const sonuc = await t.calistir(r)
    expect(sonuc).toMatchObject({ success: true, state: 'submitting', validTo: VALID_TO })
    expect(t.liste).toHaveLength(1)
    expect(t.liste[0].status).toBe('submitting')
    expect(t.liste[0].postBody).not.toBeNull()
    expect(t.satirlar).toHaveLength(1)
    expect(t.orders.removeOrder).not.toHaveBeenCalled()
    expect(t.pendingRows.remove).not.toHaveBeenCalled()
  })

  it.each(['REJECTED', 'INSUFFICIENT_ALLOWANCE', 'INSUFFICIENT_BALANCE', 'FORBIDDEN', 'RATE_LIMITED', 'CLOCK_SKEW', 'INVALID_ORDER'])(
    '%s: kesin red, kayit ve satir silinir, success:false',
    async (code) => {
      const t = kur({ postOrder: () => ({ ok: false, code }) })
      const r = await t.kaydet(kayitUret())
      const sonuc = await t.calistir(r)
      expect(sonuc).toEqual({ success: false, code })
      expect(t.liste).toHaveLength(0)
      expect(t.satirlar).toHaveLength(0)
      expect(t.pendingRows.remove).toHaveBeenCalledTimes(1)
    },
  )

  it('postOrder firlatirsa belirsiz sayilir (kayit kalir)', async () => {
    const t = kur({
      postOrder: () => {
        throw new Error('boom')
      },
    })
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r)).toMatchObject({ success: true, state: 'submitting' })
    expect(t.liste).toHaveLength(1)
  })

  it('satir yazimi basarisiz: POST gitmez, kayit geri alinir', async () => {
    const t = kur()
    t.pendingRows.save.mockRejectedValueOnce(new Error('disk'))
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'UNKNOWN' })
    expect(t.api.postOrder).not.toHaveBeenCalled()
    expect(t.liste).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- Faz 3: fee.mode karari ve borc kilidi
const ATS_1 = '1000000000000000000'
const ATS_2 = '2000000000000000000'
const HAZIR = { ready: true, mode: 'normal' }
const hazirlik = (ek = {}) => ({ isEvm: true, status: HAZIR, balanceRaw: '10000000000000000000', quotedFeeRaw: ATS_1, decimals: 18, ...ek })
const feeKur = (hazir = hazirlik()) => ({
  prepare: vi.fn(async () => (typeof hazir === 'function' ? hazir() : hazir)),
})
const borcluKayit = (ek = {}) => ({
  uid: '0x' + 'ab'.repeat(56),
  owner: OWNER,
  chainId: 1,
  status: 'fulfilled',
  fee: { mode: 'ats', state: 'owed', blocker: null, noServiceSince: null },
  ...ek,
})
const ACIK_FEE = (fee, orders = []) => ({ fee, feeEnabled: () => true, orders })
const kayitFee = (t) => t.liste.find((r) => r.uid !== borcluKayit().uid)?.fee

describe('placeOrder Faz 3: bayrak kapaliyken Faz 2 ile birebir', () => {
  it('fee verilmez: kayit fee.mode none, state idle', async () => {
    const t = kur()
    const r = await t.kaydet(kayitUret())
    expect((await t.calistir(r)).success).toBe(true)
    expect(t.liste[0].fee).toMatchObject({ mode: 'none', state: 'idle', quotedAtsRaw: null })
  })

  it('feeEnabled false + fee verilmis + borclu owed kayit: kilitlenmez, fee.prepare 0, cagri dizisi AYNI', async () => {
    const taban = kur()
    await taban.calistir(await taban.kaydet(kayitUret()))
    const fee = feeKur()
    const t = kur({ fee, feeEnabled: () => false, orders: [borcluKayit()] })
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
    expect((await t.calistir(r)).success).toBe(true)
    expect(fee.prepare).not.toHaveBeenCalled()
    expect(t.cagrilar).toEqual(taban.cagrilar)
    expect(kayitFee(t)).toMatchObject({ mode: 'none', state: 'idle' })
  })
})

describe('placeOrder Faz 3: borc kilidi', () => {
  it('owner in owed kaydi -> FEE_DEBT; getSigner, imza ve POST YOK; yeni kayit yazilmaz', async () => {
    const fee = feeKur()
    const t = kur(ACIK_FEE(fee, [borcluKayit()]))
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
    expect(await t.calistir(r)).toEqual({ success: false, code: 'FEE_DEBT' })
    expect(t.getSigner).not.toHaveBeenCalled()
    expect(t.imzaSpy).not.toHaveBeenCalled()
    expect(t.api.postOrder).not.toHaveBeenCalled()
    expect(t.liste).toHaveLength(1)
    expect(t.satirlar).toHaveLength(0)
  })

  it('baska owner in borcu kilitlemez', async () => {
    const t = kur(ACIK_FEE(feeKur(), [borcluKayit({ owner: ATTACKER })]))
    const r = await t.kaydet(kayitUret())
    expect((await t.calistir(r)).success).toBe(true)
  })

  it('NO_SERVICE >= 10 dk borc kilitlemez', async () => {
    const eski = borcluKayit({ fee: { mode: 'ats', state: 'blocked', blocker: 'NO_SERVICE', noServiceSince: NOW - 10 * 60 * 1000 } })
    const t = kur(ACIK_FEE(feeKur(), [eski]))
    const r = await t.kaydet(kayitUret())
    expect((await t.calistir(r)).success).toBe(true)
  })

  it('NO_SERVICE 10 dk dolmadan kilitler', async () => {
    const taze = borcluKayit({ fee: { mode: 'ats', state: 'blocked', blocker: 'NO_SERVICE', noServiceSince: NOW - 60_000 } })
    const t = kur(ACIK_FEE(feeKur(), [taze]))
    const r = await t.kaydet(kayitUret())
    expect(await t.calistir(r)).toEqual({ success: false, code: 'FEE_DEBT' })
  })
})

describe('placeOrder Faz 3 Review Focus: kullanicinin gormedigi ucret kesilmez', () => {
  it('onizleme ats + taze kapi ats -> kayit ats, quotedAtsRaw onizlemedeki rakam (taze rakam degil)', async () => {
    const fee = feeKur(hazirlik({ quotedFeeRaw: ATS_2 }))
    const t = kur(ACIK_FEE(fee))
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
    expect((await t.calistir(r)).success).toBe(true)
    expect(t.liste[0].fee).toMatchObject({ mode: 'ats', state: 'idle', quotedAtsRaw: ATS_1 })
    expect(fee.prepare).toHaveBeenCalledWith({ owner: OWNER, chainId: 1 })
  })

  it('onizleme none + taze kapi ats -> kayit none', async () => {
    const t = kur(ACIK_FEE(feeKur()))
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'none', quotedAtsRaw: null } }))
    expect((await t.calistir(r)).success).toBe(true)
    expect(t.liste[0].fee).toMatchObject({ mode: 'none', quotedAtsRaw: null })
  })

  it('onizleme alani hic yoksa (eski kayit) -> none', async () => {
    const t = kur(ACIK_FEE(feeKur()))
    const r = await t.kaydet(kayitUret())
    expect((await t.calistir(r)).success).toBe(true)
    expect(t.liste[0].fee.mode).toBe('none')
  })

  it('onizleme ats + taze kapi none (ATS harcandi) -> none', async () => {
    const t = kur(ACIK_FEE(feeKur(hazirlik({ balanceRaw: '1' }))))
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
    expect((await t.calistir(r)).success).toBe(true)
    expect(t.liste[0].fee).toMatchObject({ mode: 'none', quotedAtsRaw: null })
  })

  it('onizleme ats ama quotedAtsRaw rakam degil -> none', async () => {
    const t = kur(ACIK_FEE(feeKur()))
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: 'x' } }))
    expect((await t.calistir(r)).success).toBe(true)
    expect(t.liste[0].fee.mode).toBe('none')
  })

  it('fee.prepare firlatir -> none, emir yine kurulur', async () => {
    const t = kur(
      ACIK_FEE({
        prepare: vi.fn(async () => {
          throw new Error('rpc yok')
        }),
      }),
    )
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
    expect((await t.calistir(r)).success).toBe(true)
    expect(t.api.postOrder).toHaveBeenCalledTimes(1)
    expect(t.liste[0].fee.mode).toBe('none')
  })

  it('fee.prepare 4 sn icinde donmezse none ve emir kurulur', async () => {
    vi.useFakeTimers()
    try {
      const t = kur(ACIK_FEE({ prepare: vi.fn(() => new Promise(() => {})) }))
      const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
      const p = t.calistir(r)
      await vi.advanceTimersByTimeAsync(FEE_PREPARE_TIMEOUT_MS + 1)
      expect((await p).success).toBe(true)
      expect(t.liste[0].fee.mode).toBe('none')
    } finally {
      vi.useRealTimers()
    }
  })

  it('karar anahtardan (getSigner) ve imzadan ONCE verilir', async () => {
    const fee = feeKur()
    const t = kur(ACIK_FEE(fee))
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
    await t.calistir(r)
    expect(fee.prepare.mock.invocationCallOrder[0]).toBeLessThan(t.getSigner.mock.invocationCallOrder[0])
  })

  it('mode yazildiktan sonra ikinci placeOrder QUOTE_USED; kayit degismez, fee.prepare ve saveOrder tek', async () => {
    const fee = feeKur()
    const t = kur(ACIK_FEE(fee))
    const r = await t.kaydet(kayitUret({ feePreview: { mode: 'ats', quotedAtsRaw: ATS_1 } }))
    expect((await t.calistir(r)).success).toBe(true)
    const once = structuredClone(t.liste[0])
    expect(await t.calistir(r)).toEqual({ success: false, code: 'QUOTE_USED' })
    expect(t.liste).toHaveLength(1)
    expect(t.liste[0].fee).toEqual(once.fee)
    expect(fee.prepare).toHaveBeenCalledTimes(1)
    expect(t.orders.saveOrder).toHaveBeenCalledTimes(1)
  })
})

describe('placeOrder anahtar hijyeni', () => {
  let spies
  beforeEach(() => {
    spies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}))
  })
  afterEach(() => {
    spies.forEach((s) => s.mockRestore())
  })

  it('getSigner en fazla bir kez, hicbir yolda console cagrilmaz, sonuc JSON ile gecer ve gizli deger icermez', async () => {
    const yollar = [
      [{}, (r) => r],
      [{ postOrder: () => ({ ok: false, code: 'NETWORK' }) }, (r) => r],
      [{ postOrder: () => ({ ok: false, code: 'REJECTED' }) }, (r) => r],
      [{ postOrder: () => ({ ok: true, data: '0x' + 'cd'.repeat(56) }) }, (r) => r],
      [{ allowance: 0n, permitInfo: USDC_PERMIT() }, (r) => ({ ...r, approval: { mode: 'permit', allowance: '0' } })],
      [{ balance: 0n }, (r) => r],
    ]
    for (const [ek, degis] of yollar) {
      const t = kur(ek)
      const r = await t.kaydet(degis(kayitUret()))
      const sonuc = await t.calistir(r)
      const json = JSON.stringify(sonuc)
      expect(json).not.toContain(HARDHAT_0_KEY.slice(2))
      expect(json).not.toMatch(/0x[0-9a-f]{130}/)
      expect(json).not.toContain('signature')
      expect(json).not.toContain('postBody')
      expect(t.getSigner.mock.calls.length).toBeLessThanOrEqual(1)
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })

  it('getSigner reddederse firlatmaz, UNKNOWN doner, POST yok', async () => {
    const t = kur({
      signer: () => {
        throw new Error('anahtar: ' + HARDHAT_0_KEY)
      },
    })
    const r = await t.kaydet(kayitUret())
    const sonuc = await t.calistir(r)
    expect(sonuc).toEqual({ success: false, code: 'UNKNOWN' })
    expect(JSON.stringify(sonuc)).not.toContain(HARDHAT_0_KEY.slice(2))
    expect(t.api.postOrder).not.toHaveBeenCalled()
  })

  it('kaynak: privateKey / mnemonic / localStorage yok; placeOrder govdesinde ayirici imzadan once sinanir', () => {
    const kaynak = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'service.js'), 'utf8'))
    expect(kaynak).not.toMatch(/privateKey/)
    expect(kaynak).not.toMatch(/mnemonic/)
    expect(kaynak).not.toMatch(/localStorage/)
    // yalniz placeOrderInner govdesi: quote() icindeki cagrilar siralamayi yaniltmasin
    const govde = blokGovdesi(kaynak, /async function placeOrderInner\(\{[^}]*\}\)\s*/)
    expect(govde).toBeTruthy()
    const d = govde.indexOf('domainSeparator(')
    const s = govde.indexOf('signOrder(')
    expect(d).toBeGreaterThan(-1)
    expect(s).toBeGreaterThan(-1)
    expect(d).toBeLessThan(s)
  })

  it('kaynak: placeOrder govdesinde permit imzasindan once verifyPermitDomain cagrilir (quote() icindeki cagri sayilmaz)', () => {
    const kaynak = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'service.js'), 'utf8'))
    const govde = blokGovdesi(kaynak, /async function placeOrderInner\(\{[^}]*\}\)\s*/)
    expect(govde).toBeTruthy()
    const v = govde.indexOf('verifyPermitDomain(')
    const s = govde.indexOf('signPermit(')
    expect(v).toBeGreaterThan(-1)
    expect(s).toBeGreaterThan(-1)
    expect(v).toBeLessThan(s)
  })
})
