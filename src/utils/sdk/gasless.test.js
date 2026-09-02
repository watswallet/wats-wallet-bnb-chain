// gasless.ts SDK — entegrasyonun dayandigi dikislerin karakterizasyon/kilit testleri.
// Amac: sessiz ayrisma (server/sponsor.ts sabiti, alan sirasi, prefix uzunlugu, marker) bir
// gonderim degil BURADA yakalansin. On-chain bit-esitligi (EntryPoint v0.8) testnet'in isi.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ethers } from 'ethers'
import {
  EIP7702_INITCODE_MARKER, packAccountGasLimits, packGasFees,
  buildApproveCallData, assembleUserOp, computeUserOpHash, GaslessClient,
  buildBatchCallData, buildCommissionBatchCallData,
} from './gasless'
import { buildBootstrapCallData } from '../atsPaymaster'

const PM = '0x767F90D739812D707719F3dcc131bD86BC2255f6'
const ATS = '0xE2D977DC010F15BDDAA656141890e3e00E16D012'
const ENTRY = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const DELEGATE = '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A'
const PREFIX = PM + '0'.repeat(64) // 52 byte

describe('EIP7702_INITCODE_MARKER', () => {
  it('tam 20 byte ve 0x7702 ile baslar, gerisi sifir', () => {
    expect(EIP7702_INITCODE_MARKER).toBe('0x7702' + '00'.repeat(18))
    expect((EIP7702_INITCODE_MARKER.length - 2) / 2).toBe(20)
  })
})

describe('paketleme alan sirasi + uzunluk', () => {
  it('accountGasLimits = verification(16) | call(16), 32 byte', () => {
    const packed = packAccountGasLimits(312457n, 198765n)
    expect((packed.length - 2) / 2).toBe(32)
    expect(packed).toBe(ethers.concat([ethers.toBeHex(312457n, 16), ethers.toBeHex(198765n, 16)]))
  })
  it('gasFees = priority(16) | max(16), 32 byte', () => {
    const packed = packGasFees(1234567890n, 7654321098n)
    expect(packed).toBe(ethers.concat([ethers.toBeHex(1234567890n, 16), ethers.toBeHex(7654321098n, 16)]))
  })
})

describe('buildApproveCallData', () => {
  const EXECUTE = new ethers.Interface(['function execute(address dest, uint256 value, bytes func)'])
  const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount)'])

  it('execute(ATS, 0, approve(paymaster, MaxUint256)) uretir', () => {
    const decoded = EXECUTE.decodeFunctionData('execute', buildApproveCallData(ATS, PM))
    expect(decoded[0].toLowerCase()).toBe(ATS.toLowerCase())
    expect(decoded[1]).toBe(0n)
    const inner = ERC20.decodeFunctionData('approve', decoded[2])
    expect(inner[0].toLowerCase()).toBe(PM.toLowerCase())
    expect(inner[1]).toBe(ethers.MaxUint256)
  })

  it('atsPaymaster.buildBootstrapCallData ile BYTE-ESIT (iki encoder ayrismaz)', () => {
    const viaSdk = buildApproveCallData(ATS, PM)
    const viaHelper = buildBootstrapCallData({ token: { address: ATS }, paymaster: PM })
    expect(viaSdk.toLowerCase()).toBe(viaHelper.toLowerCase())
  })
})

describe('assembleUserOp prefix guard', () => {
  const base = {
    sender: '0x' + '1'.repeat(40), nonce: 0n, initCode: '0x', callData: '0x',
    verificationGasLimit: 1n, callGasLimit: 1n, preVerificationGas: 1n,
    maxPriorityFeePerGas: 1n, maxFeePerGas: 1n, paymasterData: '0x', signature: '0x',
  }
  it('prefix 52 byte degilse THROW (erken, isimli hata)', () => {
    expect(() => assembleUserOp({ ...base, paymasterAndDataPrefix: PM + '00' }))
      .toThrow(/52 byte/i)
  })
  it('prefix 52 byte + paymasterData 0x -> paymasterAndData sadece prefix', () => {
    const op = assembleUserOp({ ...base, paymasterAndDataPrefix: PREFIX })
    expect(op.paymasterAndData).toBe(PREFIX)
  })
  it('paymasterData eklenince prefix + data olur', () => {
    const data = '0x' + 'ab'.repeat(77)
    const op = assembleUserOp({ ...base, paymasterAndDataPrefix: PREFIX, paymasterData: data })
    expect(op.paymasterAndData).toBe(PREFIX + data.slice(2))
  })
})

// Tarayici (extension service worker) native `fetch`'i, `this` globalThis DEGILSE
// "Illegal invocation" atar. GaslessClient fetch'i bir sinif alaninda tutup `this.fetchImpl(...)`
// ile cagirdigi icin, native fetch yanlis `this` (instance) ile cagrilir -> her istek patlar,
// "Ucret hesaplanamadi". Node/undici toleransli oldugu icin bu tarayici semantigini TAKLIT edip
// regresyonu kilitliyoruz.
describe('GaslessClient fetch this-binding (SW Illegal invocation)', () => {
  const GAS = {
    callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n,
    paymasterVerificationGasLimit: 1n, paymasterPostOpGasLimit: 1n, maxFeePerGas: 1n,
  }
  it('native fetch yanlis `this` ile cagrilsa da GaslessClient calisir', async () => {
    const calls = []
    function nativeLikeFetch(url, init) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      calls.push({ url })
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ atsFee: '1' }) })
    }
    vi.stubGlobal('fetch', nativeLikeFetch)
    try {
      const client = new GaslessClient({ baseUrl: 'https://backend.test', chainId: 42161 })
      await expect(client.quote(GAS)).resolves.toEqual({ atsFee: '1' })
      expect(calls[0].url).toBe('https://backend.test/paymaster/quote')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// Bulgu 48: post() govdeyi durum kodundan ONCE JSON'a ceviriyordu. Backend'in onundeki
// CDN/proxy 502/503/524'te HTML sayfasi dondurdugunde res.json() SyntaxError atar; niyet
// edilen `HTTP <status>` yedegi hic uretilemez ve durum kodu tamamen kaybolur. Kullanici
// "Unexpected token <" gorur; backend mesajlarina bakan hata isleme ("paymaster paused",
// "stale rate") hicbir zaman eslesemez.
describe('GaslessClient.post hata govdesi', () => {
  const GAS = {
    callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n,
    paymasterVerificationGasLimit: 1n, paymasterPostOpGasLimit: 1n, maxFeePerGas: 1n,
  }
  const client = () => new GaslessClient({ baseUrl: 'https://backend.test', chainId: 42161 })
  const respondWith = (res) => vi.stubGlobal('fetch', vi.fn(async () => res))

  afterEach(() => vi.unstubAllGlobals())

  it('HTML 502 sayfasi -> durum kodu korunur (JSON parse hatasi degil)', async () => {
    respondWith({ ok: false, status: 502, text: async () => '<html><body>Bad Gateway</body></html>' })
    await expect(client().quote(GAS)).rejects.toThrow('HTTP 502')
  })

  it('bos govdeli 500 -> durum kodu korunur', async () => {
    respondWith({ ok: false, status: 500, text: async () => '' })
    await expect(client().quote(GAS)).rejects.toThrow('HTTP 500')
  })

  it('JSON hata govdesindeki backend mesaji hala ustun gelir', async () => {
    respondWith({
      ok: false, status: 400,
      text: async () => JSON.stringify({ error: 'paymaster paused' }),
    })
    await expect(client().quote(GAS)).rejects.toThrow('paymaster paused')
  })

  it('200 ama JSON olmayan govde sessizce gecmez', async () => {
    respondWith({ ok: true, status: 200, text: async () => '<html>ok?</html>' })
    await expect(client().quote(GAS)).rejects.toThrow(/gecersiz yanit/i)
  })
})

describe('computeUserOpHash', () => {
  const mkOp = (initCode) => assembleUserOp({
    sender: '0x' + '1'.repeat(40), nonce: 0n, initCode, callData: '0xabcd',
    verificationGasLimit: 300000n, callGasLimit: 200000n, preVerificationGas: 100000n,
    maxPriorityFeePerGas: 1n, maxFeePerGas: 2n, paymasterAndDataPrefix: PREFIX,
    paymasterData: '0x', signature: '0x',
  })

  it('32 byte hex dondurur ve deterministiktir', () => {
    const op = mkOp('0x')
    const h1 = computeUserOpHash(op, { chainId: 42161n, entryPoint: ENTRY })
    const h2 = computeUserOpHash(op, { chainId: 42161n, entryPoint: ENTRY })
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/)
    expect(h1).toBe(h2)
  })

  it('chainId degisince hash degisir (EIP-712 domain)', () => {
    const op = mkOp('0x')
    const a = computeUserOpHash(op, { chainId: 42161n, entryPoint: ENTRY })
    const b = computeUserOpHash(op, { chainId: 1n, entryPoint: ENTRY })
    expect(a).not.toBe(b)
  })

  it('marker initCode + delege verilmezse THROW', () => {
    const op = mkOp(EIP7702_INITCODE_MARKER)
    expect(() => computeUserOpHash(op, { chainId: 42161n, entryPoint: ENTRY }))
      .toThrow(/eip7702Delegate/i)
  })

  it('marker initCode + delege verilirse hesaplar (0x initCode ten farkli)', () => {
    const markerOp = mkOp(EIP7702_INITCODE_MARKER)
    const plainOp = mkOp('0x')
    const marker = computeUserOpHash(markerOp, { chainId: 42161n, entryPoint: ENTRY, eip7702Delegate: DELEGATE })
    const plain = computeUserOpHash(plainOp, { chainId: 42161n, entryPoint: ENTRY })
    expect(marker).toMatch(/^0x[0-9a-f]{64}$/)
    expect(marker).not.toBe(plain)
  })
})

// --- EKLENTI FARKI regresyonlari -----------------------------------------------------------
// Bu iki hata canlida yasandi ve duzeltildi; satici SDK'si yeniden birakildiginda geri gelebilir.
describe('GaslessClient — tarayici fetch semantigi', () => {
  it('native fetch this===globalThis bekledigi halde patlamaz (Illegal invocation)', async () => {
    // Tarayici davranisinin taklidi: fetch, globalThis'e bagli DEGILSE atar.
    const realGlobal = globalThis
    const nativeLike = function (url, init) {
      if (this !== realGlobal && this !== undefined) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ atsFee: '1' }) })
    }
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(nativeLike)
    // fetchImpl VERILMEDEN kurulur -> varsayilan sarmalayici devrede olmali.
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 8453 })
    await expect(c.quote({
      callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n,
      paymasterVerificationGasLimit: 1n, paymasterPostOpGasLimit: 0n, maxFeePerGas: 1n,
    })).resolves.toEqual({ atsFee: '1' })
    spy.mockRestore()
  })
})

describe('GaslessClient — JSON olmayan govde', () => {
  const gas = {
    callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n,
    paymasterVerificationGasLimit: 1n, paymasterPostOpGasLimit: 0n, maxFeePerGas: 1n,
  }
  it('CDN 502 HTML govdesinde durum kodunu korur, SyntaxError sizdirmaz', async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' })
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 8453 }, fetchImpl)
    await expect(c.quote(gas)).rejects.toThrow('HTTP 502')
  })
  it('200 + bos govde "gecersiz yanit" olarak raporlanir', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '' })
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 8453 }, fetchImpl)
    await expect(c.quote(gas)).rejects.toThrow(/gecersiz yanit|geçersiz yanıt/)
  })
  it('400 govdesindeki code alanini GaslessError.code olarak tasir', async () => {
    const fetchImpl = async () => ({
      ok: false, status: 400,
      text: async () => JSON.stringify({ error: 'kaynak zincirde izin yok', code: 'src-allowance-missing' }),
    })
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 8453 }, fetchImpl)
    await expect(c.quote(gas)).rejects.toMatchObject({ code: 'src-allowance-missing' })
  })
  it('GET yolunda da code tasinir (status ucu)', async () => {
    const fetchImpl = async () => ({
      ok: false, status: 400, text: async () => JSON.stringify({ error: 'x', code: 'rate-stale' }),
    })
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 8453 }, fetchImpl)
    await expect(c.status('0x' + '1'.repeat(40))).rejects.toMatchObject({ code: 'rate-stale' })
  })
})

describe('GaslessClient — istek govdeleri', () => {
  const gas = {
    callGasLimit: 1n, verificationGasLimit: 2n, preVerificationGas: 3n,
    paymasterVerificationGasLimit: 4n, paymasterPostOpGasLimit: 0n, maxFeePerGas: 5n,
  }
  const capture = () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }
    }
    return { calls, fetchImpl }
  }

  it('quote sender VERILINCE gonderir, verilmeyince ALANI HIC koymaz', async () => {
    const { calls, fetchImpl } = capture()
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 8453 }, fetchImpl)
    await c.quote(gas)
    await c.quote(gas, '0x' + 'a'.repeat(40))
    expect('sender' in calls[0].body).toBe(false)
    expect(calls[1].body.sender).toBe('0x' + 'a'.repeat(40))
  })

  it('sponsor quoteId ve settlement i yalniz verilince tasir', async () => {
    const { calls, fetchImpl } = capture()
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 8453 }, fetchImpl)
    const base = { sender: '0x' + 'a'.repeat(40), nonce: 0n, callData: '0x1234', gas, maxPriorityFeePerGas: 7n }
    await c.sponsor(base)
    await c.sponsor({ ...base, quoteId: 'Q1', settlement: { id: '0xabc', atsAmount: '42' } })
    expect('quoteId' in calls[0].body).toBe(false)
    expect('settlement' in calls[0].body).toBe(false)
    expect(calls[1].body.quoteId).toBe('Q1')
    expect(calls[1].body.settlement).toEqual({ id: '0xabc', atsAmount: '42' })
  })

  it('status GET ile chainId+sender sorgusu kurar', async () => {
    const { calls, fetchImpl } = capture()
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 42161 }, fetchImpl)
    await c.status('0x' + 'b'.repeat(40))
    expect(calls[0].method).toBe('GET')
    expect(calls[0].url).toBe('https://b.example/paymaster/status?chainId=42161&sender=0x' + 'b'.repeat(40))
  })

  it('health GET /health e gider', async () => {
    const { calls, fetchImpl } = capture()
    const c = new GaslessClient({ baseUrl: 'https://b.example', chainId: 56 }, fetchImpl)
    await c.health()
    expect(calls[0].url).toBe('https://b.example/health')
  })
})

// 5xx ile 4xx ayri kararlara gider (atsBlocker). Durumu hatada tasimazsak cuzdan ikisini
// ayirt edemez; 2026-08-10'da /relay 504 verirken ekranda jenerik bir kart cikti.
describe('GaslessError HTTP durumunu tasir', () => {
  const clientWith = (status, body) => new GaslessClient(
    { baseUrl: 'http://x', chainId: 56 },
    async () => ({ status, ok: status < 400, text: async () => body }),
  )

  it('kodlu 400 hatasinda hem code hem status', async () => {
    const c = clientWith(400, JSON.stringify({ error: 'izin yok', code: 'src-allowance-missing' }))
    await expect(c.status('0x1')).rejects.toMatchObject({ code: 'src-allowance-missing', status: 400 })
  })

  it('gateway 504 (HTML govde, JSON degil) status tasir, code tasimaz', async () => {
    const c = clientWith(504, '<html><body>504 Gateway Time-out</body></html>')
    await expect(c.status('0x1')).rejects.toMatchObject({ status: 504, code: undefined })
  })
})

// --- komisyon batch'i -----------------------------------------------------------------
//
// Belge "Swap ve Bridge Komisyonu" §05: sponsor() TAM OLARAK calls[0]'a bakar ve besi de
// zorunludur (target=ATS, value=0, transfer(address,uint256), alici=treasury, tutar BIREBIR).
// Bu testler o bes alani ve SIRAYI kilitler — bir gonderimde degil BURADA yakalansin.
describe('buildCommissionBatchCallData', () => {
  const BATCH = new ethers.Interface([
    'function executeBatch((address target, uint256 value, bytes data)[] calls)',
  ])
  const ERC20 = new ethers.Interface(['function transfer(address to, uint256 amount)'])
  const TREASURY = '0x1111111111111111111111111111111111111111'
  const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
  const userCall = { to: ROUTER, value: 0n, data: '0x12345678' }

  const decode = (callData) => BATCH.decodeFunctionData('executeBatch', callData)[0]

  it('selector executeBatch((address,uint256,bytes)[]) — delegede DOGRULANAN 0x34fcd5be', () => {
    const cd = buildCommissionBatchCallData({
      ats: ATS, treasury: TREASURY, commission: 5n, calls: [userCall],
    })
    expect(cd.slice(0, 10)).toBe('0x34fcd5be')
  })

  it('calls[0] = ATS.transfer(treasury, commission), value 0, ve kullanici cagrilari SONRA', () => {
    const cd = buildCommissionBatchCallData({
      ats: ATS, treasury: TREASURY, commission: 1234n, calls: [userCall],
    })
    const calls = decode(cd)
    expect(calls.length).toBe(2)
    expect(calls[0].target.toLowerCase()).toBe(ATS.toLowerCase())
    expect(calls[0].value).toBe(0n)
    expect(calls[0].data).toBe(ERC20.encodeFunctionData('transfer', [TREASURY, 1234n]))
    expect(calls[1].target.toLowerCase()).toBe(ROUTER.toLowerCase())
    expect(calls[1].data).toBe('0x12345678')
  })

  it('kullanici cagrilarinin KENDI ICINDEKI sirasi korunur (approve, sonra swap)', () => {
    const approve = { to: '0x' + '2'.repeat(40), value: 0n, data: '0xaaaaaaaa' }
    const cd = buildCommissionBatchCallData({
      ats: ATS, treasury: TREASURY, commission: 1n, calls: [approve, userCall],
    })
    const calls = decode(cd)
    expect(calls.map((c) => c.data)).toEqual([calls[0].data, '0xaaaaaaaa', '0x12345678'])
  })

  // §04: "commission === 0n ise fonksiyon siradan bir batch uretir" — komisyon KAPALIYKEN
  // callData bugunkuyle bit-bit ayni kalmali (backend bugun commissionAts:"0" donuyor).
  it('commission 0 ise komisyon cagrisi EKLENMEZ, duz batch uretilir', () => {
    const cd = buildCommissionBatchCallData({
      ats: ATS, treasury: TREASURY, commission: 0n, calls: [userCall],
    })
    expect(cd).toBe(buildBatchCallData([userCall]))
    expect(decode(cd).length).toBe(1)
  })

  it('commission 0 ise treasury OLMASA da calisir (kapaliyken /status alani gelmiyor)', () => {
    expect(() => buildCommissionBatchCallData({ ats: ATS, commission: 0n, calls: [userCall] }))
      .not.toThrow()
  })

  // §06.2: gomulu/bayat hazine adresi her BSC komisyon op'unu commission-missing'e dusurur.
  // Eksik adresi SESSIZCE gecmek, kullaniciya sebepsiz gorunen bir hata uretir.
  it('commission > 0 iken treasury yoksa FIRLATIR', () => {
    expect(() => buildCommissionBatchCallData({ ats: ATS, commission: 1n, calls: [userCall] }))
      .toThrow(/treasury/i)
  })

  it('commission > 0 iken ats adresi yoksa FIRLATIR', () => {
    expect(() => buildCommissionBatchCallData({ treasury: TREASURY, commission: 1n, calls: [userCall] }))
      .toThrow(/ats/i)
  })

  it('negatif komisyon FIRLATIR', () => {
    expect(() => buildCommissionBatchCallData({
      ats: ATS, treasury: TREASURY, commission: -1n, calls: [userCall],
    })).toThrow()
  })

  // §05 "value: 0 neden zorunlu": komisyon cagrisina native deger ilistirmek hesabin ETH'sini
  // ATS kontratina gondermeye calismaktir. Kullanici cagrisinin value'su serbesttir.
  it('kullanici cagrisinin value degeri korunur, komisyonunki her zaman 0', () => {
    const cd = buildCommissionBatchCallData({
      ats: ATS, treasury: TREASURY, commission: 7n,
      calls: [{ to: ROUTER, value: 42n, data: '0x1234' }],
    })
    const calls = decode(cd)
    expect(calls[0].value).toBe(0n)
    expect(calls[1].value).toBe(42n)
  })
})

describe('buildBatchCallData', () => {
  it('bos calls listesi FIRLATIR — bos bir op gaz yakar, hicbir sey yapmaz', () => {
    expect(() => buildBatchCallData([])).toThrow()
  })

  it('value/data eksik cagrilari 0 ve 0x olarak normallestirir', () => {
    const BATCH = new ethers.Interface([
      'function executeBatch((address target, uint256 value, bytes data)[] calls)',
    ])
    const cd = buildBatchCallData([{ to: '0x' + '3'.repeat(40) }])
    const calls = BATCH.decodeFunctionData('executeBatch', cd)[0]
    expect(calls[0].value).toBe(0n)
    expect(calls[0].data).toBe('0x')
  })
})

// §03/§04: komisyonlu op'ta /quote callData ILE cagrilmali; aksi halde /sponsor
// commission-quote-required doner (her zincirde).
describe('GaslessClient.quote callData tasir', () => {
  const capture2 = () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null })
      return { status: 200, ok: true, text: async () => JSON.stringify({ atsFee: '1' }) }
    }
    return { calls, fetchImpl }
  }
  const GAS = {
    callGasLimit: 1n, verificationGasLimit: 2n, preVerificationGas: 3n,
    paymasterVerificationGasLimit: 4n, paymasterPostOpGasLimit: 5n, maxFeePerGas: 6n,
  }

  it('callData verilince govdeye eklenir', async () => {
    const { calls, fetchImpl } = capture2()
    const c = new GaslessClient({ baseUrl: 'http://x', chainId: 56 }, fetchImpl)
    await c.quote(GAS, '0x' + 'a'.repeat(40), '0xdeadbeef')
    expect(calls[0].body.callData).toBe('0xdeadbeef')
  })

  it('callData verilmezse alan HIC gonderilmez (bugunku govde degismez)', async () => {
    const { calls, fetchImpl } = capture2()
    const c = new GaslessClient({ baseUrl: 'http://x', chainId: 56 }, fetchImpl)
    await c.quote(GAS, '0x' + 'a'.repeat(40))
    expect('callData' in calls[0].body).toBe(false)
  })
})
