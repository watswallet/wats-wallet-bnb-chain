// SWAP/BRIDGE KOMISYONU — gonderim yolunun ucu uca testleri.
// Belge: "Swap ve Bridge Komisyonu" (§02 bolge, §04 akis, §05 batch bicimi, §07 hata kodlari).
//
// Burada kanitlanan sey su: komisyon op'un ICINE dogru bicimde, dogru SIRADA ve YALNIZ dogru
// bolgede giriyor. Bunlarin her biri yanlis oldugunda bedeli para: spoke'ta fazladan bir
// transfer CIFT ODEME, BSC'de eksik calls[0] commission-missing, yanlis sira ATS satan bir
// swap'ta AA33 ve yanan gaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ethers as realEthers } from 'ethers'

const ADDR = '0x' + '1'.repeat(40)
const PK = '0x' + '1'.repeat(64)
// atsConfig'teki GERCEK kayitlar — allowlist ve token adresi bunlarla eslesmek zorunda.
const PM_BSC = '0x004e1f5aB1B7bf85412B11628Ca7A8C73Cd8ad53'
const ATS_BSC = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const PM_ARB = '0x89e6FA55fC0e29dFCdf1bbfA50c9c0BcC216c74c'
const DELEGATE = '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A'

const TREASURY = '0x' + 'ab'.repeat(20)
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'   // PancakeSwap V2 Router 02
const TOKEN_IN = '0x' + '5'.repeat(40)

// Tipik swap: approve + swap. Router YALNIZ ikincisinin hedefi — backend tum cagrilari tarar.
const APPROVE_CALL = { to: TOKEN_IN, value: '0', data: '0xaaaaaaaa' }
const SWAP_CALL = { to: ROUTER, value: '0', data: '0xbbbbbbbb' }

// Backend'in TANIMADIGI hedef (listede olmayan bir kontrat) ve duz bir ERC20 transferi.
// Canli olcumde (2026-08-19) ikisi de /quote'tan `commissionAts` ALMAZ — komisyon yalnizca
// listeli bir router'a dokunan op'lardan istenir.
const UNLISTED = '0x' + '7'.repeat(40)
const UNLISTED_CALL = { to: UNLISTED, value: '0', data: '0xcccccccc' }
const PLAIN_TRANSFER_CALL = { to: '0x' + '3'.repeat(40), value: '0', data: '0xdddddddd' }

const H = vi.hoisted(() => ({ state: {} }))

vi.mock('./sdk/gasless', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    GaslessClient: class {
      status() { return Promise.resolve(H.state.status) }
      health() {
        return Promise.resolve({
          ok: true,
          chains: [{ chainId: 56, paymaster: PM_BSC }, { chainId: 42161, paymaster: PM_ARB }],
        })
      }
      // /quote'un GORDUGU callData kaydedilir: §03/§04 komisyonlu op'ta bunun gonderilmesini
      // sart kosuyor.
      quote(gas, sender, callData) {
        H.state.quoteCalls.push({ sender, callData })
        // CANLI SOZLESME (2026-08-19 sonda ciktisi): `commissionAts` alani YALNIZCA gonderilen
        // callData backend'in TANIDIGI bir router'a dokunuyorsa doner. Duz transferde, listesiz
        // hedefte ve callData'siz cagrida alan HIC GELMEZ.
        //
        // Eski mock alani callData'ya BAKMADAN koyuyordu, yani "her op vergili" diye bir evren
        // simule ediyordu; BSC'de her duz transferin hazineye 6.88 ATS tasidigi hatanin
        // testlerden kacmasinin ikinci kok nedeni buydu.
        //
        // Override fonksiyon da olabilir (argumani 1-tabanli tur numarasi): backend'in tur
        // ortasinda fikir degistirdigi senaryolar ancak boyle kurulabilir.
        const raw = H.state.quoteCommissionOverride
        const o = typeof raw === 'function' ? raw(H.state.quoteCalls.length) : raw
        const status = H.state.status.budget?.commissionAts
        const amount = o !== undefined
          ? (o === null ? undefined : o)
          : (status && status !== '0' && callData && hitsListedRouter(callData) ? status : undefined)
        return Promise.resolve({
          atsFee: '10', atsFeeCrosschain: '20',
          quoteId: `Q${H.state.quoteCalls.length}`,
          ...(amount !== undefined ? { commissionAts: amount } : {}),
        })
      }
      sponsor(req) {
        H.state.sponsorReqs.push(req)
        if (H.state.sponsorErrors.length) {
          const next = H.state.sponsorErrors.shift()
          const err = new Error(next.message || 'sponsor reddetti')
          err.code = next.code
          return Promise.reject(err)
        }
        const pm = Number(H.state.chainId) === 56 ? PM_BSC : PM_ARB
        // Bootstrap akisinda YALNIZ ilk op bootstrap'tir; ikincisi (izin op1'de olustugu icin)
        // normal yoldan gider. Ikisine birden 'bootstrap' donmek assertSponsorModeConsistent'i
        // hakli olarak firlatirdi — o kontrolu test kurgusu yuzunden delmek yerine sunucunun
        // gercek davranisini taklit ediyoruz.
        const mode = H.state.status.mode === 'bootstrap' && H.state.sponsorReqs.length > 1
          ? 'normal' : H.state.status.mode
        return Promise.resolve({
          paymaster: pm, paymasterAndDataPrefix: pm + '0'.repeat(64), paymasterData: '0xabcd',
          // /sponsor'un `atsFee`'si TAHSIL EDILECEK tutardir — /quote'unkiyle ayni sey DEGIL.
          // Spoke zincirde komisyon bunun ICINDEDIR; override o gercegi taklit etmek icin.
          atsFee: H.state.sponsorAtsFee ?? '10', settlementId: '0xset', mode,
        })
      }
      relay(userOp) {
        H.state.relayCount++
        H.state.lastUserOpHash = actual.computeUserOpHash(userOp, {
          chainId: BigInt(H.state.chainId),
          entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
          ...(userOp.initCode && userOp.initCode !== '0x' ? { eip7702Delegate: DELEGATE } : {}),
        })
        return Promise.resolve({ success: true, txHash: '0x' + 'f'.repeat(64) })
      }
    },
  }
})

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal()
  const TOPIC0 = actual.ethers.id(
    'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
  const receipt = () => ({
    logs: [{
      address: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
      topics: [TOPIC0, H.state.lastUserOpHash],
      data: actual.ethers.AbiCoder.defaultAbiCoder()
        .encode(['uint256', 'bool', 'uint256', 'uint256'], [0n, true, 0n, 0n]),
    }],
  })
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class {
        estimateGas() { return Promise.resolve(40000n) }
        getFeeData() { return Promise.resolve({ maxPriorityFeePerGas: 100n, gasPrice: 5n }) }
        getBlock() { return Promise.resolve({ baseFeePerGas: 1000n }) }
        getCode() { return Promise.resolve('0xef0100268d193d74d3b9a13a82da831302cf8dbdc9245a') }
        getTransactionCount() { return Promise.resolve(0) }
        waitForTransaction() { return Promise.resolve(receipt()) }
        getTransactionReceipt() { return Promise.resolve(receipt()) }
      },
      Wallet: class {
        constructor() {
          this.address = ADDR
          this.signingKey = { sign: () => ({ serialized: '0x' + 'cd'.repeat(65) }) }
        }
      },
      Contract: class {
        getNonce() { return Promise.resolve(0n) }
        balanceOf() { return Promise.resolve(0n) }
      },
    },
  }
})

const {
  executeAtsTransfer, _resetAtsStatusCache, _resetPaymasterAllowlist, _setAtsSettlementStore,
} = await import('./atsPaymaster')

const BATCH_IFACE = new realEthers.Interface([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)',
])
const EXEC_IFACE = new realEthers.Interface(['function execute(address dest, uint256 value, bytes func)'])
const ERC20_IFACE = new realEthers.Interface(['function transfer(address to, uint256 amount)'])

const decodeBatch = (callData) => BATCH_IFACE.decodeFunctionData('executeBatch', callData)[0]
const isBatch = (callData) => callData.slice(0, 10) === '0x34fcd5be'
// Backend callData'yi cozup hedeflere bakar; mock da ayni soruyu sormali.
const targetsOf = (cd) => (isBatch(cd)
  ? decodeBatch(cd).map((c) => c.target)
  : [EXEC_IFACE.decodeFunctionData('execute', cd)[0]])
const hitsListedRouter = (cd) => targetsOf(cd).some((t) => String(t).toLowerCase() === ROUTER.toLowerCase())

beforeEach(() => {
  H.state = {
    chainId: 56,
    status: {
      ready: true, mode: 'normal', delegated: true, collection: 'local',
      budget: { commissionAts: '0' },
    },
    quoteCalls: [], sponsorReqs: [], sponsorErrors: [], relayCount: 0,
    quoteCommissionOverride: undefined,
    sponsorAtsFee: undefined,
    lastUserOpHash: '0x' + '0'.repeat(64),
  }
  _resetAtsStatusCache()
  _resetPaymasterAllowlist()
  _setAtsSettlementStore(null)
})

// Bu dosyanin varsayilan senaryosu bir SWAP'tir; `opKind` de oyle verilmeli. Tohum (seed)
// yalnizca op turune gore konur: swap/bridge komisyonun ADAYIDIR, transfer DEGIL.
const run = (over = {}) => executeAtsTransfer({
  privateKey: PK, chainId: H.state.chainId, rpcUrl: 'http://rpc',
  calls: [APPROVE_CALL, SWAP_CALL],
  quoted: { transferFee: 5 },
  opKind: 'swap',
  ...over,
})

const withCommission = (amount, treasury = TREASURY) => {
  H.state.status.budget = { commissionAts: amount, commissionTreasury: treasury }
}

// --- §05 batch bicimi -------------------------------------------------------------------

describe('BSC (collection local) — komisyon op un ICINE girer', () => {
  it('calls[0] ATS.transfer(treasury, komisyon) ve value 0', async () => {
    withCommission('4200')
    await run()
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls[0].target.toLowerCase()).toBe(ATS_BSC.toLowerCase())
    expect(calls[0].value).toBe(0n)
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 4200n]))
  })

  // Sira dayatilmali: ATS SATAN bir swap komisyondan once calisirsa bakiye tukenir, komisyon
  // transferi revert eder ve op TUMDEN duser.
  it('komisyon EN BASTA, kullanici cagrilari kendi sirasinda arkasinda', async () => {
    withCommission('7')
    await run()
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls.length).toBe(3)
    expect(calls[1].target.toLowerCase()).toBe(TOKEN_IN.toLowerCase())
    expect(calls[1].data).toBe('0xaaaaaaaa')
    expect(calls[2].target.toLowerCase()).toBe(ROUTER.toLowerCase())
    expect(calls[2].data).toBe('0xbbbbbbbb')
  })

  // USDT gibi approve-reset isteyen tokenlar: batch DORT cagri olur, komisyon yine calls[0].
  it('dort cagrili batch te de komisyon calls[0] da kalir', async () => {
    withCommission('7')
    await run({ calls: [
      { to: TOKEN_IN, value: '0', data: '0x11111111' },
      { to: TOKEN_IN, value: '0', data: '0x22222222' },
      SWAP_CALL,
    ] })
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls.length).toBe(4)
    expect(calls[0].target.toLowerCase()).toBe(ATS_BSC.toLowerCase())
    expect(calls.slice(1).map((c) => c.data)).toEqual(['0x11111111', '0x22222222', '0xbbbbbbbb'])
  })
})

// --- §02 bolge --------------------------------------------------------------------------

describe('spoke (collection src) — op a HICBIR SEY eklenmez', () => {
  it('komisyon > 0 olsa bile batch e komisyon transferi GIRMEZ (cift odeme olurdu)', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    withCommission('4200')
    await run()
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls.length).toBe(2)
    expect(calls.every((c) => c.target.toLowerCase() !== ATS_BSC.toLowerCase())).toBe(true)
  })

  // Karar collection'dan okunur, chainId'den DEGIL: sunucu 56'yi 'src' derse ona uyulur.
  it('BSC te bile collection src ise komisyon op a girmez', async () => {
    H.state.status.collection = 'src'
    withCommission('4200')
    await run()
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls.length).toBe(2)
  })
})

// --- §01 kapaliyken bit-bit ayni --------------------------------------------------------

describe('komisyon KAPALIYKEN bugunku davranis', () => {
  it('tek cagrili transfer hala duz execute (batch e SARILMAZ)', async () => {
    await run({ calls: undefined, call: SWAP_CALL })
    const cd = H.state.sponsorReqs[0].callData
    expect(isBatch(cd)).toBe(false)
    expect(cd).toBe(EXEC_IFACE.encodeFunctionData('execute', [ROUTER, 0n, '0xbbbbbbbb']))
  })

  it('cok cagrili op komisyonsuz duz batch olur', async () => {
    await run()
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls.length).toBe(2)
  })

  it('treasury alani HIC gelmese de calisir (kapaliyken backend gondermiyor)', async () => {
    H.state.status.budget = { commissionAts: '0' }
    await expect(run()).resolves.toBeTruthy()
  })
})

// --- §03/§04 /quote callData ile ---------------------------------------------------------

describe('/quote callData ile cagrilir', () => {
  it('gonderilen callData ile /quote a verilen callData AYNIDIR', async () => {
    withCommission('4200')
    await run()
    // SON tur baglayicidir: planli gecis olan senaryolarda ilk tur zaten cope atilmis olur.
    expect(H.state.quoteCalls.at(-1).callData).toBe(H.state.sponsorReqs[0].callData)
    expect(H.state.quoteCalls.length).toBe(1)
  })

  // Bu test DEKORATIF DEGIL: "alan yoklugu = komisyonsuz" cikariminin TEK on kosulu, /quote'un
  // gonderim yolunda HER ZAMAN callData ile cagrilmasidir. Bir tur callData'siz cagrilirsa
  // yokluk "soru sorulmadi" anlamina gelir ve batch'ten komisyonu dusurmek YANLIS olur.
  it('/quote HER ZAMAN callData ile cagrilir — "alan yoklugu = komisyonsuz" cikariminin ON KOSULU budur', async () => {
    withCommission('4200')
    await run()
    expect(H.state.quoteCalls.length).toBeGreaterThan(0)
    expect(H.state.quoteCalls.every((q) => !!q.callData)).toBe(true)
  })
})

// --- §07 hata kodlari --------------------------------------------------------------------

describe('commission-missing — batch mesajdaki tutarla yeniden kurulur', () => {
  it('ikinci denemede calls[0] BEKLENEN tutari tasir ve op gonderilir', async () => {
    withCommission('100')
    // /sponsor "beklenen 555" diyorsa /quote de o turdan itibaren 555 kilitler; ayrisik birakmak
    // sunucuyu kendi kendisiyle celisir gostermek olurdu.
    H.state.quoteCommissionOverride = (turn) => (turn === 1 ? '100' : '555')
    H.state.sponsorErrors = [{
      code: 'commission-missing',
      message: 'komisyon eksik: beklenen 555, bulunan 100',
    }]
    const r = await run()
    expect(H.state.sponsorReqs.length).toBe(2)
    const calls = decodeBatch(H.state.sponsorReqs[1].callData)
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 555n]))
    expect(r.txHash).toBeTruthy()
  })

  // Kilit callData'ya civilidir: yeni batch eski kilitle gonderilirse bu sefer
  // commission-calldata-mismatch doner. Bu yuzden kilit YENILENIR.
  it('yeni batch icin TAZE kilit alinir', async () => {
    withCommission('100')
    H.state.quoteCommissionOverride = (turn) => (turn === 1 ? '100' : '555')
    H.state.sponsorErrors = [{ code: 'commission-missing', message: 'beklenen 555 bulunan 100' }]
    await run()
    expect(H.state.quoteCalls.length).toBe(2)
    expect(H.state.quoteCalls[1].callData).toBe(H.state.sponsorReqs[1].callData)
    expect(H.state.sponsorReqs[1].quoteId).toBe('Q2')
  })

  // Tutar cozulemiyorsa UYDURMA: yanlis bir calls[0] ya ayni hatayi ya da FAZLA odemeyi uretir.
  it('mesajdan tutar cozulemezse hata OLDUGU GIBI yukari verilir', async () => {
    withCommission('100')
    H.state.sponsorErrors = [{ code: 'commission-missing', message: 'komisyon eksik' }]
    await expect(run()).rejects.toMatchObject({ code: 'commission-missing' })
    expect(H.state.sponsorReqs.length).toBe(1)
  })

  it('spoke ta commission-missing yeniden kurulmaz (komisyon op a hic girmez)', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    withCommission('100')
    H.state.sponsorErrors = [{ code: 'commission-missing', message: 'beklenen 555' }]
    await expect(run()).rejects.toMatchObject({ code: 'commission-missing' })
  })
})

// §04 3. adim: /status'un tutari batch'i KURAR, /quote'unki KILITLER. Keeper tam o anda
// setRate yazdiysa ikisi ayrisir ve calls[0] yanlis tutari tasir. Proaktif yakalamak,
// /sponsor'un commission-missing demesini beklemekten bir /sponsor cagrisi ucuzdur.
describe('proaktif komisyon mutabakati (/quote vs /status)', () => {
  it('kilitlenen tutar farkliysa batch KILIDIN tutariyla yeniden kurulur', async () => {
    withCommission('100')
    H.state.quoteCommissionOverride = '555'
    const r = await run()
    // Ilk /sponsor HIC cagrilmaz: uyusmazlik quote asamasinda yakalanir.
    expect(H.state.sponsorReqs.length).toBe(1)
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 555n]))
    expect(r.txHash).toBeTruthy()
  })

  it('tutarlar ayniysa fazladan tur ATILMAZ', async () => {
    withCommission('100')
    // Override YOK: mock zaten listeli router'a dokunan bu op icin /status tutarini doner.
    await run()
    expect(H.state.quoteCalls.length).toBe(1)
    expect(H.state.sponsorReqs.length).toBe(1)
  })

  // Spoke'ta komisyon op'a hic girmez; orada mutabakat aramak her op'u bosuna dondururdu.
  it('spoke ta mutabakat KOSMAZ', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    withCommission('100')
    H.state.quoteCommissionOverride = '555'
    await expect(run()).resolves.toBeTruthy()
    expect(H.state.quoteCalls.length).toBe(1)
  })

  it('alan YOKKEN ve batch komisyonsuzken mutabakat sessizdir', async () => {
    withCommission('0')
    await expect(run()).resolves.toBeTruthy()
    expect(H.state.sponsorReqs.length).toBe(1)
    // Komisyon KAPALIYKEN de callData gonderilmeli. Ayri test degil ayni testte: "tohum 0 ise
    // /quote'a callData vermeye gerek yok" sadelestirmesi tam da bu senaryoda cazip gorunur ve
    // yapildigi gun "alan yoklugu = komisyonsuz" cikarimi dayanaksiz kalir.
    expect(H.state.quoteCalls.every((q) => !!q.callData)).toBe(true)
  })
})

// --- tohum ile benimseme AYRI kumeler ---------------------------------------------------

// 2026-08-20 CANLI HATASI — Polygon 1 POL -> USDT: ekran 13.986992 dedi, /sponsor 20.980488
// istedi, op oldu. Fark tam olarak komisyondu. Ekranin onayladigi sayi (ucret + komisyon)
// gonderim tarafina GECMEZSE tavan komisyonsuz kurulur ve her komisyonlu op patlar.
describe('onay tavani /sponsor un TAHSIL EDECEGI tutari kapsar', () => {
  const FEE = 10n ** 18n            // 1 ATS
  const COMMISSION = 5n * 10n ** 17n // 0.5 ATS

  it('spoke: /sponsor ucret + komisyon derse ve ekran ikisini de onayladiysa GECER', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    H.state.sponsorAtsFee = (FEE + COMMISSION).toString()
    await expect(run({ quoted: { transferFee: 1, commissionFee: 0.5 } })).resolves.toBeTruthy()
  })

  it('ekran komisyonu GECIRMEZSE ayni op reddedilir (hatanin ta kendisi)', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    H.state.sponsorAtsFee = (FEE + COMMISSION).toString()
    await expect(run({ quoted: { transferFee: 1 } })).rejects.toThrow(/asti/i)
  })

  // Tavan komisyon kadar genisliyor, SINIRSIZ degil: gercek bir asim hala durdurulur.
  it('komisyon onaylansa da gercek asim yine durdurulur', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    H.state.sponsorAtsFee = (FEE * 3n).toString()   // tavan = 1*1.25 + 0.5 = 1.75
    await expect(run({ quoted: { transferFee: 1, commissionFee: 0.5 } })).rejects.toThrow(/asti/i)
  })
})

describe('op turu: tohum (hiz) ile benimseme (guven) ayrilir', () => {
  // 2026-08-20 CANLI OLCUM: backend kopru hedefini (Li.Fi Diamond) de TANIYOR ve
  // commissionAts donuyor. Bu yuzden bridge de tohumlanir — tohumu cikarmak BSC'deki her
  // kopruye bosa bir /quote turu ve tuketilmis bir planli butce maliyeti yukluyordu.
  it('bridge TOHUMLANIR — taninan hedefte tek turda biter', async () => {
    withCommission('4200')
    await run({ opKind: 'bridge' })
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 4200n]))
    expect(H.state.quoteCalls.length).toBe(1)
  })

  // Taninmayan hedefte tohum yanlis cikar; bedeli EN FAZLA bir /quote turudur ve komisyon
  // batch'ten DUSURULUR — asla yanlis odeme degil.
  it('bridge taninmayan hedefte komisyonu bir turda dusurur', async () => {
    withCommission('4200')
    await run({ opKind: 'bridge', calls: [APPROVE_CALL, PLAIN_TRANSFER_CALL] })
    const cd = H.state.sponsorReqs[0].callData
    expect(targetsOf(cd).map((t) => String(t).toLowerCase())).not.toContain(ATS_BSC.toLowerCase())
    expect(H.state.quoteCalls.length).toBe(2)
  })

  it('bridge komisyonu /quote isterse BENIMSER (ekranda gosteriliyor)', async () => {
    withCommission('0')
    H.state.quoteCommissionOverride = '777'
    await run({ opKind: 'bridge' })
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 777n]))
  })

  // Send'in tavani ve ekran karsiligi YOK; sessizce odemek yerine GORUNUR hata verilir.
  it('transfer komisyonu BENIMSEMEZ — /quote isterse op durur, /sponsor a hic varmaz', async () => {
    withCommission('0')
    H.state.quoteCommissionOverride = '777'
    await expect(run({ opKind: 'transfer', calls: undefined, call: PLAIN_TRANSFER_CALL }))
      .rejects.toThrow()
    expect(H.state.sponsorReqs.length).toBe(0)
  })
})

describe('commission-quote-required / lock-missing / calldata-mismatch', () => {
  it('kilit dusurulur ve TAZE /quote callData ile alinir', async () => {
    withCommission('4200')
    H.state.sponsorErrors = [{ code: 'commission-quote-required' }]
    await run()
    expect(H.state.quoteCalls.length).toBe(2)
    expect(H.state.sponsorReqs[1].quoteId).toBe('Q2')
    // Batch DEGISMEZ: yalniz kilit yenilenir.
    expect(H.state.sponsorReqs[1].callData).toBe(H.state.sponsorReqs[0].callData)
  })

  it('commission-lock-missing ayni yolu izler', async () => {
    withCommission('4200')
    H.state.sponsorErrors = [{ code: 'commission-lock-missing' }]
    await expect(run()).resolves.toBeTruthy()
    expect(H.state.sponsorReqs.length).toBe(2)
  })

  it('commission-calldata-mismatch ayni yolu izler', async () => {
    withCommission('4200')
    H.state.sponsorErrors = [{ code: 'commission-calldata-mismatch' }]
    await expect(run()).resolves.toBeTruthy()
    expect(H.state.sponsorReqs.length).toBe(2)
  })

  // Komisyon butcesi AYRIDIR: bedelsiz bir duzeltme, gercek ag hatasi icin ayrilan makbuzlu
  // deneme hakkini YEMEZ.
  it('komisyon duzeltmesi makbuzlu deneme butcesini tuketmez', async () => {
    withCommission('4200')
    H.state.sponsorErrors = [
      { code: 'commission-quote-required' },
      { code: undefined, message: 'socket hang up' },
    ]
    await expect(run()).resolves.toBeTruthy()
    expect(H.state.sponsorReqs.length).toBe(3)
  })

  // Sinirsiz donmek /sponsor'u tekrar tekrar cagirir ve BSC bootstrap hakkini yakardi.
  it('ikinci komisyon hatasinda DURUR (butce 1)', async () => {
    withCommission('4200')
    H.state.sponsorErrors = [
      { code: 'commission-quote-required' },
      { code: 'commission-quote-required' },
    ]
    await expect(run()).rejects.toMatchObject({ code: 'commission-quote-required' })
  })
})

// --- KOMISYON YALNIZ BACKEND ISTEDIGI OP'A GIRER --------------------------------------
//
// Canli olcum (2026-08-19): /paymaster/status'un budget.commissionAts'i ON ZINCIRIN HEPSINDE
// ayni degeri doner ve OP TURUNE BAKMAZ (status bir op gormez, callData almaz). Bir op'un
// gercekten komisyon dogurup dogurmadigini soyleyen TEK alan, O op'un callData'si ile yapilan
// /quote'un `commissionAts`'idir.
//
// Bu ayrimi kaybetmenin bedeli dogrudan para: BSC'deki her duz transfer hazineye ~6.88 ATS'lik
// istenmemis bir transfer tasir, backend itiraz etmez (o bicimden komisyon beklemiyor) ve
// Send onay ekrani komisyonu HIC gostermedigi icin kullanici odedigini gormez bile.
describe('op turu — komisyon yalniz /quote istedigi op a girer', () => {
  it('BSC de duz transfer KOMISYON TASIMAZ (status komisyonu > 0 olsa bile)', async () => {
    withCommission('6881838827334664106')
    await run({ calls: undefined, call: PLAIN_TRANSFER_CALL, opKind: 'transfer' })
    const cd = H.state.sponsorReqs[0].callData
    expect(isBatch(cd)).toBe(false)
    expect(cd).toBe(EXEC_IFACE.encodeFunctionData(
      'execute', [PLAIN_TRANSFER_CALL.to, 0n, PLAIN_TRANSFER_CALL.data]))
    // Hazine adresi callData'nin HICBIR yerinde gecmemeli.
    expect(cd.toLowerCase()).not.toContain(TREASURY.slice(2).toLowerCase())
    expect(H.state.quoteCalls.length).toBe(1)
    expect(H.state.sponsorReqs.length).toBe(1)
  })

  // Tohum (seed) yanlis cikarsa bedeli EN FAZLA bir /quote turudur — tahsilat yok, bootstrap
  // hakki yanmaz. Yanlis odeme ihtimali yok.
  it('backend in TANIMADIGI hedefe giden batch ten komisyon DUSURULUR (bir /quote turu)', async () => {
    withCommission('4200')
    await run({ calls: [APPROVE_CALL, UNLISTED_CALL] })
    expect(H.state.quoteCalls.length).toBe(2)
    expect(H.state.sponsorReqs.length).toBe(1)
    const sent = H.state.sponsorReqs[0].callData
    const calls = decodeBatch(sent)
    expect(calls.length).toBe(2)
    expect(calls[0].target.toLowerCase()).toBe(APPROVE_CALL.to.toLowerCase())
    // Ilk tur komisyonlu sorulur (tohum), ikinci tur komisyonsuz.
    expect(decodeBatch(H.state.quoteCalls[0].callData).length).toBe(3)
    expect(H.state.quoteCalls[1].callData).toBe(sent)
  })

  // A'nin (minimal) secilme gerekcesi: komisyonun BEKLENDIGI op'ta fazladan tur ATILMAZ.
  it('listeli router a dokunan swap te komisyon ILK turda girer, tur SAYISI artmaz', async () => {
    withCommission('4200')
    await run()
    expect(H.state.quoteCalls.length).toBe(1)
    expect(H.state.sponsorReqs.length).toBe(1)
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 4200n]))
  })

  // Mutabakat kapisindaki `commissionRegion === 'local'` kosulu "sadelestirme" diye
  // dusurulurse, komisyonun op'a hic girmedigi DOKUZ zincirde her swap olur.
  it('spoke ( src ) bolgede mutabakat KOSMAZ — alan gelse bile op degismez', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    withCommission('4200')
    H.state.quoteCommissionOverride = '555'
    await expect(run()).resolves.toBeTruthy()
    expect(H.state.quoteCalls.length).toBe(1)
    const calls = decodeBatch(H.state.sponsorReqs[0].callData)
    expect(calls.length).toBe(2)
    expect(calls[0].target.toLowerCase()).toBe(APPROVE_CALL.to.toLowerCase())
  })

  it('bootstrap op u komisyondan ETKILENMEZ (tek approve cagrisi kalir)', async () => {
    H.state.status.mode = 'bootstrap'
    withCommission('4200')
    await run({ calls: [APPROVE_CALL, UNLISTED_CALL] })
    const boot = H.state.sponsorReqs[0].callData
    expect(isBatch(boot)).toBe(false)
    expect(EXEC_IFACE.decodeFunctionData('execute', boot)[0].toLowerCase())
      .toBe(ATS_BSC.toLowerCase())
  })

  // Bootstrap op'una hic komisyon konmaz; backend yine de isterse planli gecis KURULMAZ ve
  // is /sponsor'a VARMADAN durur — adres basina 3 olan bootstrap hakki yanmaz.
  it('bootstrap op una komisyon istenirse /sponsor a VARMADAN durur', async () => {
    H.state.status.mode = 'bootstrap'
    H.state.quoteCommissionOverride = '4200'
    withCommission('4200')
    await expect(run()).rejects.toMatchObject({ code: 'commission-missing' })
    expect(H.state.sponsorReqs.length).toBe(0)
  })

  // BOLGE KARARI TEK YERDE. Bootstrap op'una da gercek bolge gecirilmeli; gecirilmezse
  // sendOneOp'un 'local' varsayilani kosar ve SPOKE bir zincirdeki kurulum, komisyonun op'a
  // HIC girmedigi bir bolgede mutabakat kapisina takilip tumden bloke olurdu. Backend'in
  // chainId 1 icin mode:'bootstrap' donebildigi 2026-08-10'da canlida olculdu.
  it('SPOKE bootstrap komisyon kapisina takilmaz (bolge op1 e de gecirilir)', async () => {
    H.state.chainId = 42161
    H.state.status.collection = 'src'
    H.state.status.mode = 'bootstrap'
    H.state.quoteCommissionOverride = '4200'
    withCommission('4200')
    await expect(run()).resolves.toBeTruthy()
    expect(H.state.sponsorReqs.length).toBe(2)
  })
})

// UCUNCU BUTCE. /quote kaynakli duzeltme bedelsizdir (tahsilat yok, bootstrap hakki yanmaz);
// /sponsor kaynakli duzeltme BSC'de adres basina 3 olan haktan birini yakar. Tek sayacta
// birlestirmek, her komisyonlu swap'in gercek bir commission-missing payini PESINEN yakmasi
// demekti.
describe('komisyon butceleri AYRI (planli /quote gecisi vs /sponsor duzeltmesi)', () => {
  it('planli gecis, /sponsor kaynakli commission-missing hakkini TUKETMEZ', async () => {
    withCommission('4200')
    // 3. turdan itibaren backend 999 istiyor (sponsor hatasiyla tutarli).
    H.state.quoteCommissionOverride = (turn) => (turn >= 3 ? '999' : undefined)
    H.state.sponsorErrors = [{ code: 'commission-missing', message: 'beklenen 999' }]
    const r = await run({ calls: [APPROVE_CALL, UNLISTED_CALL] })
    expect(H.state.sponsorReqs.length).toBe(2)
    const calls = decodeBatch(H.state.sponsorReqs[1].callData)
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 999n]))
    expect(r.txHash).toBeTruthy()
  })

  // Planli butce de SINIRLIDIR: sunucu her turda baska bir tutar soylerse sonsuz donmeyiz.
  it('planli butce bir turla sinirlidir (sonsuz dongu yok)', async () => {
    withCommission('100')
    H.state.quoteCommissionOverride = (turn) => (turn === 1 ? '4200' : '555')
    await expect(run()).rejects.toMatchObject({ code: 'commission-missing' })
    expect(H.state.quoteCalls.length).toBe(2)
    expect(H.state.sponsorReqs.length).toBe(0)
  })

  // UI Turkce mesaja degil KODA bakar (atsBlocker). Yeniden kurma sirasindaki bir hata
  // orijinal kodu gizlerse kullanici jenerik bir karta duser.
  it('yeniden kurma firlatirsa orijinal komisyon KODU korunur', async () => {
    // Hazine alani HIC yok. (withCommission'in varsayilan parametresi undefined'i TREASURY'ye
    // cevirdigi icin budget dogrudan kuruluyor.)
    H.state.status.budget = { commissionAts: '4200' }
    H.state.quoteCommissionOverride = '4200'
    // opKind 'transfer': tohum 0 oldugu icin ilk callData kurulabilir ve hata tam da
    // yeniden kurma adiminda (hazine hala yok) dogar.
    await expect(run({ opKind: 'transfer' })).rejects.toMatchObject({ code: 'commission-missing' })
    expect(H.state.sponsorReqs.length).toBe(0)
  })
})
