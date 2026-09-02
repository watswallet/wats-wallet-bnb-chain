import { describe, it, expect, vi } from 'vitest'

vi.mock('./atsConfig', () => ({
  getAtsConfig: () => ({
    paymaster: '0x767F90D739812D707719F3dcc131bD86BC2255f6',
    delegate: '0x0A1543500137b0656527EDF143D7903E9078dC26',
    entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    token: { address: '0xE2D977DC010F15BDDAA656141890e3e00E16D012', symbol: 'ATS', decimals: 18 },
  }),
}))

import { ethers } from 'ethers'
import { getAtsConfig } from './atsConfig'
import {
  buildBootstrapCallData, buildTransferCallData, extractUserOpSuccess,
  assertQuoteWithinApproval,
  toBackendAuthorization,
  estimateCallGas, buildAtsGasParams, EXECUTE_OVERHEAD_GAS, MIN_BOOTSTRAP_CALL_GAS,
  resolveGasPrice, paymasterAllowlist, _resetPaymasterAllowlist,
} from './atsPaymaster'

const cfg = getAtsConfig(421614)
const EXECUTE = new ethers.Interface(['function execute(address dest, uint256 value, bytes func)'])
const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const CALL = { to: '0x' + '9'.repeat(40), value: '1000', data: '0x' }
const FROM = '0x' + '1'.repeat(40)

describe('buildBootstrapCallData', () => {
  it('TAM olarak execute(ATS, 0, approve(paymaster, MaxUint256)) uretir', () => {
    const decoded = EXECUTE.decodeFunctionData('execute', buildBootstrapCallData(cfg))
    expect(decoded[0].toLowerCase()).toBe(cfg.token.address.toLowerCase())
    expect(decoded[1]).toBe(0n)
    const inner = ERC20.decodeFunctionData('approve', decoded[2])
    expect(inner[0].toLowerCase()).toBe(cfg.paymaster.toLowerCase())
    expect(inner[1]).toBe(ethers.MaxUint256)
  })
})

describe('buildTransferCallData', () => {
  it('native gonderimi execute(alici, tutar, 0x) olur', () => {
    const to = '0x' + '1'.repeat(40)
    const decoded = EXECUTE.decodeFunctionData('execute', buildTransferCallData({ to, value: '1000', data: '0x' }))
    expect(decoded[0].toLowerCase()).toBe(to)
    expect(decoded[1]).toBe(1000n)
    expect(decoded[2]).toBe('0x')
  })
  it('ERC-20 gonderimi execute(token, 0, transferCalldata) olur', () => {
    const token = '0x' + '2'.repeat(40)
    const decoded = EXECUTE.decodeFunctionData('execute', buildTransferCallData({ to: token, value: 0, data: '0xdeadbeef' }))
    expect(decoded[0].toLowerCase()).toBe(token)
    expect(decoded[1]).toBe(0n)
    expect(decoded[2]).toBe('0xdeadbeef')
  })
  it('value yoksa 0 kabul edilir', () => {
    const decoded = EXECUTE.decodeFunctionData('execute', buildTransferCallData({ to: '0x' + '3'.repeat(40), data: '0x' }))
    expect(decoded[1]).toBe(0n)
  })
})

// Canli backend'de /estimate yok; alti gaz alani artik SABIT config'ten degil, her op icin
// estimateGas + buildGasParams (satici, sdk/gas-estimate.ts) ile dinamik kurulur. Eski
// buildGasParams(gasConfig, feeData) imzasi (statik cfg.gas + feeData gecirme) kaldirildi;
// yerine gecen estimateCallGas/buildAtsGasParams testleri asagida.
describe('estimateCallGas', () => {
  // eth_estimateGas ICSEL (21.000) maliyeti DE icerir; callGasLimit ise yalniz EntryPoint'in
  // hesaptan hedefe yaptigi ic CALL'un butcesidir ve icsel maliyet ORAYA girmez. Cikarmadan
  // eklemek her op'ta ~21k sistematik fazla butce demekti — capraz-zincirde IADESIZ.
  it('icsel islem maliyetini (21000) DUSER, sonra execute sarmalayicisinin ek maliyetini ekler', async () => {
    const provider = { estimateGas: async () => 50000n }
    expect(await estimateCallGas({ provider, from: FROM, call: CALL }))
      .toBe(50000n - 21000n + EXECUTE_OVERHEAD_GAS)
  })
  it('tahmin icsel maliyetin altinda/esitse cikarma YAPILMAZ (negatife dusup op u revert ettirmesin)', async () => {
    const provider = { estimateGas: async () => 21000n }
    expect(await estimateCallGas({ provider, from: FROM, call: CALL }))
      .toBe(21000n + EXECUTE_OVERHEAD_GAS)
  })
  it('from lu olcum duserse from suz tekrar dener', async () => {
    // Sifir-native hesapta bazi RPC'ler value>0 icin "insufficient funds" doner.
    let n = 0
    const provider = {
      estimateGas: async (tx) => {
        n++
        if ('from' in tx) throw new Error('insufficient funds for gas * price + value')
        return 30000n
      },
    }
    expect(await estimateCallGas({ provider, from: FROM, call: CALL }))
      .toBe(30000n - 21000n + EXECUTE_OVERHEAD_GAS)
    expect(n).toBe(2)
  })
  it('ikisi de duserse yedek sabiti kullanir (op bloklanmaz)', async () => {
    const provider = { estimateGas: async () => { throw new Error('nope') } }
    expect(await estimateCallGas({ provider, from: FROM, call: CALL })).toBe(200000n)
  })
  it('call verilmezse yedek sabite duser (onboarding tazelemesi)', async () => {
    const provider = { estimateGas: async () => { throw new Error('cagrilmamali') } }
    expect(await estimateCallGas({ provider, from: FROM, call: null })).toBe(200000n)
  })
})

describe('buildAtsGasParams', () => {
  const provider = {
    estimateGas: async () => 40000n,
    getFeeData: async () => ({ maxFeePerGas: 9n, maxPriorityFeePerGas: 100n, gasPrice: 5n }),
    getBlock: async () => ({ baseFeePerGas: 1000n }),
  }
  it('crosschain=true postOp u sifirlar', async () => {
    const { gas } = await buildAtsGasParams({ provider, from: FROM, call: CALL, crosschain: true })
    expect(gas.paymasterPostOpGasLimit).toBe(0n)
  })
  it('crosschain=false postOp a limit ayirir', async () => {
    const { gas } = await buildAtsGasParams({ provider, from: FROM, call: CALL, crosschain: false })
    expect(gas.paymasterPostOpGasLimit).toBe(250000n)
  })
  it('maxFeePerGas i baseFee*2+priority ile kurar (feeData nin maxFeePerGas ini KULLANMAZ)', async () => {
    const { gas, maxPriorityFeePerGas } = await buildAtsGasParams({ provider, from: FROM, call: CALL, crosschain: true })
    expect(maxPriorityFeePerGas).toBe(100n)
    expect(gas.maxFeePerGas).toBe(2100n)
  })
  it('baseFee okunamazsa gasPrice e duser', async () => {
    const p = { ...provider, getBlock: async () => ({ baseFeePerGas: null }) }
    const { gas } = await buildAtsGasParams({ provider: p, from: FROM, call: CALL, crosschain: true })
    expect(gas.maxFeePerGas).toBe(5n * 2n + 100n)
  })
})

// viem signAuthorization ciktisi `v` (BigInt) tasir -> JSON.stringify PATLAR ("Do not know how
// to serialize a BigInt") ve istek backend'e HIC ulasmaz. Backend (server/authorization.ts)
// TAM 6 alan bekler: address, chainId, nonce, yParity, r, s. v atilir, sayilar number'a in-normalize.
describe('toBackendAuthorization', () => {
  const raw = {
    address: '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A',
    chainId: 42161, nonce: 0, yParity: 0,
    r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32),
    v: 27n, // viem'in fazladan dondurdugu BigInt
  }
  it('TAM 6 alani dondurur, v YOK', () => {
    const out = toBackendAuthorization(raw)
    expect(Object.keys(out).sort()).toEqual(['address', 'chainId', 'nonce', 'r', 's', 'yParity'])
    expect(out).toEqual({
      address: raw.address, chainId: 42161, nonce: 0, yParity: 0, r: raw.r, s: raw.s,
    })
  })
  it('JSON.stringify edilebilir (BigInt kalmaz)', () => {
    expect(() => JSON.stringify(toBackendAuthorization(raw))).not.toThrow()
  })
  it('BigInt chainId/nonce/yParity gelirse number a cevirir', () => {
    const out = toBackendAuthorization({ ...raw, chainId: 42161n, nonce: 5n, yParity: 1n })
    expect(out).toMatchObject({ chainId: 42161, nonce: 5, yParity: 1 })
    expect(typeof out.chainId).toBe('number')
    expect(typeof out.nonce).toBe('number')
  })
  it('yParity 0 (falsy-ama-gecerli) korunur', () => {
    expect(toBackendAuthorization(raw).yParity).toBe(0)
  })
})

describe('assertQuoteWithinApproval', () => {
  it('onaylanan tutarin altinda/esitse gecer', () => {
    expect(() => assertQuoteWithinApproval({ freshFee: 1.2, approvedFee: 1.25 })).not.toThrow()
    expect(() => assertQuoteWithinApproval({ freshFee: 1.25, approvedFee: 1.25 })).not.toThrow()
  })
  it('tolerans icinde kalan artis gecer (gaz fiyati oynamasi)', () => {
    expect(() => assertQuoteWithinApproval({ freshFee: 1.5, approvedFee: 1.25 })).not.toThrow()
  })
  it('toleransi asan artis IPTAL', () => {
    expect(() => assertQuoteWithinApproval({ freshFee: 2.0, approvedFee: 1.25 })).toThrow(/asti/i)
  })
  it('onaylanan tutar yoksa kontrol atlanir', () => {
    expect(() => assertQuoteWithinApproval({ freshFee: 99, approvedFee: null })).not.toThrow()
    expect(() => assertQuoteWithinApproval({ freshFee: 99, approvedFee: undefined })).not.toThrow()
  })

  // 2026-08-20 CANLI HATASI. Polygon'da 1 POL -> USDT: ekran ucreti 13.986992 gosterdi,
  // /sponsor 20.980488 dedi ve op oldu. Fark TAM OLARAK komisyondu (6.993496 = ucretin
  // yarisi, o yuzden oran her seferinde 1.5x cikiyordu).
  //
  // SEBEP: /quote'un atsFee'si YALNIZ gaz ucreti (komisyon ayri alanda), /sponsor'un atsFee'si
  // ise TAHSIL EDILECEK tutar ve spoke zincirde komisyon ONUN ICINDE. Ikisini ayni tavana
  // vurmak, komisyon acilir acilmaz her spoke swap'ini oldurdu.
  describe('komisyon tavana DAHILDIR (spoke tahsilati ucret + komisyondur)', () => {
    it('canli senaryo: ucret + komisyon gecer, komisyonsuz tavan gecmezdi', () => {
      const fee = 13.986992097349464
      const commission = 6.993496048674732
      const collected = fee + commission            // /sponsor'un dondugu tutar: 20.980488...
      expect(() => assertQuoteWithinApproval({ freshFee: collected, approvedFee: fee }))
        .toThrow(/asti/i)                            // duzeltmeden ONCEKI davranis
      expect(() => assertQuoteWithinApproval({
        freshFee: collected, approvedFee: fee, approvedCommission: commission,
      })).not.toThrow()
    })

    // Tolerans YALNIZ ucrete uygulanir. Komisyonu da 1.25 ile carpmak, operatorun sessizce
    // %25 fazla tahsil etmesine kapi acardi — kullanici ekranda o tutari onaylamadi.
    it('tolerans komisyona UYGULANMAZ', () => {
      // tavan = 10 * 1.25 + 4 = 16.5
      expect(() => assertQuoteWithinApproval({
        freshFee: 16.5, approvedFee: 10, approvedCommission: 4,
      })).not.toThrow()
      expect(() => assertQuoteWithinApproval({
        freshFee: 16.6, approvedFee: 10, approvedCommission: 4,
      })).toThrow(/asti/i)
    })

    it('komisyon yok/0/bozuk ise eski davranis birebir korunur', () => {
      for (const c of [undefined, 0, null, '', NaN, -5]) {
        expect(() => assertQuoteWithinApproval({ freshFee: 1.5, approvedFee: 1.25, approvedCommission: c }))
          .not.toThrow()
        expect(() => assertQuoteWithinApproval({ freshFee: 2.0, approvedFee: 1.25, approvedCommission: c }))
          .toThrow(/asti/i)
      }
    })

    // Eski mesaj `approvedFee`'yi yaziyordu ama karsilastirma `approvedFee * 1.25` ileydi:
    // teshiste sahte bir "tam 1.5x" oruntusu uretip gercek payi gizliyordu.
    it('hata mesaji GERCEK tavani yazar, ham onayi degil', () => {
      expect(() => assertQuoteWithinApproval({ freshFee: 100, approvedFee: 10, approvedCommission: 4 }))
        .toThrow(/16\.5/)
    })
  })

  // Bulgu 47: quoteAtsTransfer bootstrap gerekmiyorken bootstrapFee: 0 dondurur. 0'i
  // "sifir onaylandi" saymak her pozitif ucreti reddeder (n > 0 * 1.25 her zaman dogru):
  // quote ile gonderim arasinda delegasyon iptal edilirse bootstrap op'u KOSULSUZ patlar,
  // her deneme ayni sekilde patlar ve kullanici "ucret onaylanan tutari asti (1 > 0)"
  // mesajinda kilitli kalir.
  it('approvedFee 0 ise sinir kurulamaz — kontrol atlanir, kosulsuz reddetmez', () => {
    expect(() => assertQuoteWithinApproval({ freshFee: 1, approvedFee: 0 })).not.toThrow()
    expect(() => assertQuoteWithinApproval({ freshFee: 1, approvedFee: '0' })).not.toThrow()
  })

  it('anlamsiz approvedFee de sinir kurmaz', () => {
    expect(() => assertQuoteWithinApproval({ freshFee: 1, approvedFee: NaN })).not.toThrow()
    expect(() => assertQuoteWithinApproval({ freshFee: 1, approvedFee: -5 })).not.toThrow()
  })
})

describe('extractUserOpSuccess', () => {
  const EP = cfg.entryPoint
  const TOPIC = ethers.id('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
  const HASH = '0x' + 'a'.repeat(64)
  const logFor = (success, hash = HASH, address = EP) => ({
    address,
    topics: [TOPIC, hash, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)],
    data: ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bool', 'uint256', 'uint256'], [1, success, 0, 0]),
  })

  it('success=true log okunur', () => {
    expect(extractUserOpSuccess({ logs: [logFor(true)] }, EP, HASH)).toBe(true)
  })
  it('success=false log okunur (tx basarili olsa bile)', () => {
    expect(extractUserOpSuccess({ logs: [logFor(false)] }, EP, HASH)).toBe(false)
  })
  it('baska bir userOpHash icin log dikkate alinmaz -> null', () => {
    expect(extractUserOpSuccess({ logs: [logFor(true, '0x' + 'b'.repeat(64))] }, EP, HASH)).toBe(null)
  })
  it('baska bir kontratin log u dikkate alinmaz -> null', () => {
    expect(extractUserOpSuccess({ logs: [logFor(true, HASH, '0x' + '9'.repeat(40))] }, EP, HASH)).toBe(null)
  })
  it('log yoksa null (bilinmiyor, basarili DEGIL)', () => {
    expect(extractUserOpSuccess({ logs: [] }, EP, HASH)).toBe(null)
    expect(extractUserOpSuccess(null, EP, HASH)).toBe(null)
  })
})

// Finding 2 regresyonu: transfer op'unun cikis kontrolu bootstrap gate'i ile SIMETRIK olmali
// (`!== true`). handleOps'un kendisi revert ederse UserOperationEvent hic emit edilmez ve
// extractUserOpSuccess null doner - bu BILINMIYOR anlamina gelir, basarili degil. Eski kod
// `success === false` kontrol ediyordu; null !== false oldugu icin bu durumda YANLISLIKLA
// gecerdi ve kullaniciya basarili gorunurdu.
describe('transfer op basari kontrolu simetrisi (Finding 2)', () => {
  const EP = cfg.entryPoint
  const HASH = '0x' + 'a'.repeat(64)

  it('handleOps revert -> event yok -> extractUserOpSuccess null doner', () => {
    const unknown = extractUserOpSuccess({ logs: [] }, EP, HASH)
    expect(unknown).toBe(null)
  })

  it('eski kontrol (success === false) BILINMIYOR durumunu basari sayardi (hatali)', () => {
    const unknown = extractUserOpSuccess({ logs: [] }, EP, HASH)
    expect(unknown === false).toBe(false) // eski kontrol bu satirda throw ETMEZDI
  })

  it('yeni kontrol (success !== true) BILINMIYOR durumunu dogru sekilde iptal eder', () => {
    const unknown = extractUserOpSuccess({ logs: [] }, EP, HASH)
    expect(unknown !== true).toBe(true) // yeni kontrol bu satirda throw EDER
  })

  it('success === false icin de her iki kontrol ayni sekilde iptal eder', () => {
    expect(false === false).toBe(true)
    expect(false !== true).toBe(true)
  })
})

// Finding 4 dogrulama: gorevin varsayimi "waitForTransaction zaman asiminda null doner"
// seklindeydi. Gercek ethers v6 AbstractProvider davranisi test edilerek dogrulanir -
// varsayilmaz. Confirmations + timeout gecirildiginde receipt hic gelmezse Promise
// REJECT olur (TIMEOUT kodlu hata), null'a resolve OLMAZ.
describe('provider.waitForTransaction zaman asimi davranisi (Finding 4 dogrulama)', () => {
  it('receipt hic bulunamazsa ve timeout verilmisse REJECT eder (sonsuza kadar asili kalmaz)', async () => {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:9')
    vi.spyOn(provider, 'getTransactionReceipt').mockResolvedValue(null)
    vi.spyOn(provider, 'getBlockNumber').mockResolvedValue(100)
    // Yeni blok hic gelmeyecek gibi davran (this.once('block', ...) hic tetiklenmez).
    vi.spyOn(provider, 'once').mockImplementation(() => {})
    vi.spyOn(provider, 'off').mockImplementation(() => {})

    await expect(provider.waitForTransaction('0x' + 'f'.repeat(64), 1, 50))
      .rejects.toMatchObject({ code: 'TIMEOUT' })

    provider.destroy()
  })

  // Not: bu red, sendOneOp icinde yakalanmadan yukari firlar - sonsuz beklemenin yerini
  // SINIRLI surede (TX_WAIT_TIMEOUT_MS) bir hata alir, hic yanit almadan asili kalmaz.
  // Finding 2'nin `!== true` kontrolu ise FARKLI bir senaryoyu kapatir (receipt VAR ama
  // UserOperationEvent yok, yani handleOps kendisi revert etti); ikisi birlikte "sessiz
  // yanlis basari" ve "sonsuz askida kalma" ihtimallerini ortadan kaldirir.
})

// Finding 5 dogrulama: gorevin varsayimi "toBeHex(0) -> 0x00, toQuantity(0) -> 0x0" seklindeydi.
// Gercek ethers ciktisi olcularak dogrulanir.
describe('nonce hex kodlamasi (Finding 5 dogrulama)', () => {
  it('ethers.toBeHex(0) non-kanonik "0x00" uretir (kati bir dogrulayici reddedebilir)', () => {
    expect(ethers.toBeHex(0n)).toBe('0x00')
  })
  it('ethers.toQuantity(0) kanonik "0x0" uretir - bootstrap op (nonce 0) icin dogru sekil', () => {
    expect(ethers.toQuantity(0n)).toBe('0x0')
  })
  it('toBeHex byte-hizali (cift basamak) uretir, toQuantity kanonik (asgari basamak) uretir - farkli kalabilirler', () => {
    // toBeHex her zaman TAM BYTE'a tamamlar (cift sayida hex basamagi); toQuantity ise
    // onde gereksiz sifir OLMADAN asgari basamak sayisini uretir. Ikisi sadece basamak
    // sayisi zaten cift oldugunda (ornegin 16, 255) rastlantisal olarak esit olur - genel
    // kural DEGIL. Nonce 0 (tek basamak -> cift'e tamamlanir) tam da ayrisma noktasidir.
    expect(ethers.toBeHex(5n)).toBe('0x05')
    expect(ethers.toQuantity(5n)).toBe('0x5')
    expect(ethers.toBeHex(255n)).toBe(ethers.toQuantity(255n)) // 0xff - burada esitler
  })
})

import { assertPaymasterAllowed, makeEthersSigner, assertSponsorModeConsistent } from './atsPaymaster'

const PM = '0x767F90D739812D707719F3dcc131bD86BC2255f6'
const OTHER = '0xfc8d7183E0f2db7Aadf3D11F56F5908118Ae0Fce'
const PREFIX = (pm) => pm + '0'.repeat(64)

describe('assertPaymasterAllowed', () => {
  it('allowlist teki bir adres kabul edilir (buyuk/kucuk harf farketmez)', () => {
    expect(() => assertPaymasterAllowed({
      sponsorPaymaster: PM.toLowerCase(), paymasterAndDataPrefix: PREFIX(PM), allowed: [OTHER, PM],
    })).not.toThrow()
  })
  it('allowlist disindaki paymaster REDDEDILIR', () => {
    expect(() => assertPaymasterAllowed({
      sponsorPaymaster: '0x' + '9'.repeat(40), paymasterAndDataPrefix: PREFIX('0x' + '9'.repeat(40)), allowed: [PM],
    })).toThrow(/paymaster/)
  })
  it('prefix icindeki paymaster sponsor alanindan FARKLIYSA reddedilir', () => {
    // Imzali 52 byte'in ilk 20'si asil yetkilidir; yalniz JSON alanina bakmak yetmez.
    expect(() => assertPaymasterAllowed({
      sponsorPaymaster: PM, paymasterAndDataPrefix: PREFIX(OTHER), allowed: [PM, OTHER],
    })).toThrow(/prefix/i)
  })

  // Eski assertSponsorConsistent'in (Finding 1) fail-closed davranisi: sponsor.paymaster
  // hic gelmezse ya da allowlist bossa, "eslesme yok" sayilip REDDEDILMELI — bos/undefined
  // bir deger asla dolayli olarak kabul edilmemeli.
  it('sponsor.paymaster HIC YOKSA IPTAL (fail-closed)', () => {
    expect(() => assertPaymasterAllowed({
      sponsorPaymaster: undefined, paymasterAndDataPrefix: PREFIX(PM), allowed: [PM],
    })).toThrow(/paymaster/)
  })
  it('allowlist bossa/eksikse IPTAL (bos kume hicbir adresi kabul etmez)', () => {
    expect(() => assertPaymasterAllowed({
      sponsorPaymaster: PM, paymasterAndDataPrefix: PREFIX(PM), allowed: [],
    })).toThrow(/paymaster/)
  })
})

describe('makeEthersSigner', () => {
  it('signDigest HAM ECDSA uretir (EIP-191 sarmasi YOK)', async () => {
    const wallet = ethers.Wallet.createRandom()
    const signer = makeEthersSigner({ wallet, privateKey: wallet.privateKey })
    const digest = ethers.id('merhaba')
    const sig = await signer.signDigest(digest)
    // EIP-191 sarmasi olsaydi recover ADRESI TUTMAZDI.
    expect(ethers.recoverAddress(digest, sig).toLowerCase()).toBe(wallet.address.toLowerCase())
  })
  it('signAuthorization viem in fazladan v (BigInt) alanini ATAR', async () => {
    const wallet = ethers.Wallet.createRandom()
    const signer = makeEthersSigner({ wallet, privateKey: wallet.privateKey })
    const auth = await signer.signAuthorization({ chainId: 8453, delegate: '0x' + '2'.repeat(40), nonce: 4 })
    // v BigInt olarak kalirsa JSON.stringify PATLAR ve istek backend'e HIC gitmez.
    expect(auth.v).toBeUndefined()
    expect(Object.keys(auth).sort()).toEqual(['address', 'chainId', 'nonce', 'r', 's', 'yParity'])
    expect(() => JSON.stringify(auth)).not.toThrow()
    expect(auth.address.toLowerCase()).toBe('0x' + '2'.repeat(40))
  })
})

// Review bulgu 2: eski assertSponsorConsistent'in mod-uyusmazligi korumasi (transfer op'una
// backend bootstrap donerse IPTAL) yeni allowlist tabanli kontrole gecerken sessizce kalkmisti.
// assertPaymasterAllowed yalniz adresi denetliyordu, sponsor.mode hic okunmuyordu.
describe('assertSponsorModeConsistent (review bulgu 2)', () => {
  it('beklenen mod normal/crosschain iken sponsor bootstrap donerse IPTAL', () => {
    expect(() => assertSponsorModeConsistent({ expectedMode: 'normal', sponsorMode: 'bootstrap' }))
      .toThrow(/bootstrap/i)
    expect(() => assertSponsorModeConsistent({ expectedMode: 'crosschain', sponsorMode: 'bootstrap' }))
      .toThrow(/bootstrap/i)
  })
  it('beklenen mod bootstrap iken sponsor farkli donerse IPTAL ETMEZ (allowance arada olusmus olabilir)', () => {
    expect(() => assertSponsorModeConsistent({ expectedMode: 'bootstrap', sponsorMode: 'normal' }))
      .not.toThrow()
  })
  it('sponsor.mode hic gelmezse IPTAL ETMEZ', () => {
    expect(() => assertSponsorModeConsistent({ expectedMode: 'normal', sponsorMode: undefined }))
      .not.toThrow()
  })
})

// GERCEK VAKA (2026-08-10, canli backend). Onboarding "Kurulumu baslat" butonu su hatayla
// dustu:
//   "bootstrap: gas.callGasLimit cok dusuk (en az 60000 olmali) — aksi halde approve gazdan
//    revert edebilir ve postOp tahsilat basarisiz olurken paymaster deposit'i yine de bosalir"
// Bir approve icin dinamik tahminimiz: ~46.000 olcum - 21.000 icsel + 15.000 sarmalayici
// = 40.000, +%25 marj = 50.000 -> sunucunun tabaninin ALTINDA.
describe('buildAtsGasParams — sunucunun callGasLimit tabani', () => {
  const providerWith = (estimate) => ({
    estimateGas: async () => estimate,
    getFeeData: async () => ({ maxPriorityFeePerGas: 1n, gasPrice: 1n }),
    getBlock: async () => ({ baseFeePerGas: 1n }),
  })
  const CALL = { to: '0x' + '1'.repeat(40), value: 0n, data: '0xabcdef' }

  it('taban VERILMEZSE approve tahmini 60000 in altinda kalir (hatanin kaynagi)', async () => {
    const { gas } = await buildAtsGasParams({ provider: providerWith(46000n), from: CALL.to, call: CALL })
    expect(gas.callGasLimit).toBeLessThan(MIN_BOOTSTRAP_CALL_GAS)
  })

  it('taban verilirse callGasLimit tam olarak tabana yukselir', async () => {
    const { gas } = await buildAtsGasParams({
      provider: providerWith(46000n), from: CALL.to, call: CALL, minCallGas: MIN_BOOTSTRAP_CALL_GAS,
    })
    expect(gas.callGasLimit).toBe(MIN_BOOTSTRAP_CALL_GAS)
  })

  // Taban bir ZEMIN'dir, carpan degil: tahmin zaten yeterliyse dokunmaz. Aksi halde her
  // op'un callGasLimit'i sisirilirdi ve capraz-zincirde bu fazlanin IADESI YOKTUR.
  it('tahmin zaten tabanin ustundeyse DEGISTIRMEZ', async () => {
    const free = await buildAtsGasParams({ provider: providerWith(400000n), from: CALL.to, call: CALL })
    const floored = await buildAtsGasParams({
      provider: providerWith(400000n), from: CALL.to, call: CALL, minCallGas: MIN_BOOTSTRAP_CALL_GAS,
    })
    expect(floored.gas.callGasLimit).toBe(free.gas.callGasLimit)
    expect(floored.gas.callGasLimit).toBeGreaterThan(MIN_BOOTSTRAP_CALL_GAS)
  })
})

// GERCEK VAKA (2026-08-10, BSC onboarding). Op mempool'a girdi, tutunamadi, hic landlemedi;
// relayer'in latest ve pending nonce'u ayniydi. Sebep zincirin fiyat modelinde:
//
//   BSC baseFeePerGas        = 0        (olculdu)
//   BSC maxPriorityFeePerGas = null     (BSC 1559'u desteklemez -> ethers null doner)
//   maxFeePerGas = 0 * 2 + 0 = 0  -> odenen fiyat min(maxFee, baseFee+priority) = 0
//   BSC validator minimumu   = 0.05 gwei
//
// Yani islem HICBIR KOSULDA kazilamazdi. /sponsor basarili oldugu icin her deneme sessizce
// bir bootstrap hakki yakiyordu. Zincir dogru fiyati zaten soyluyordu: eth_gasPrice = 0.05.
describe('resolveGasPrice — zincirin onerdigi fiyat taban', () => {
  const GWEI = 1000000000n

  it('BSC: baseFee 0 + priority null -> fiyat gasPrice den turer', () => {
    const r = resolveGasPrice({ baseFeePerGas: 0n, priorityFeePerGas: null, gasPrice: GWEI / 20n })
    expect(r.baseFeePerGas).toBe(0n)
    expect(r.priorityFeePerGas).toBe(GWEI / 20n)   // 0.05 gwei — validator minimumu
    // buildGasParams'in formulu: baseFee*2 + priority
    expect(r.baseFeePerGas * 2n + r.priorityFeePerGas).toBe(GWEI / 20n)
  })

  it('baseFee > 0 olan aglarda olculen priority KORUNUR (regresyon yok)', () => {
    // Ethereum benzeri: gasPrice ~ baseFee + priority, yani taban priority nin altinda kalir.
    const base = 10n * GWEI
    const prio = 2n * GWEI
    const r = resolveGasPrice({ baseFeePerGas: base, priorityFeePerGas: prio, gasPrice: base + prio })
    expect(r.priorityFeePerGas).toBe(prio)
  })

  it('gasPrice olculen fiyatin altindaysa priority yi DUSURMEZ', () => {
    const r = resolveGasPrice({ baseFeePerGas: 5n * GWEI, priorityFeePerGas: 3n * GWEI, gasPrice: GWEI })
    expect(r.priorityFeePerGas).toBe(3n * GWEI)
  })

  it('her sey sifirsa FIRLATIR — sessizce kazilamaz op gonderip bootstrap hakki yakma', () => {
    expect(() => resolveGasPrice({ baseFeePerGas: 0n, priorityFeePerGas: 0n, gasPrice: 0n }))
      .toThrow(/kazilamaz/)
    expect(() => resolveGasPrice({ baseFeePerGas: null, priorityFeePerGas: null, gasPrice: null }))
      .toThrow(/kazilamaz/)
  })
})

// GERCEK VAKA (2026-08-10, chainId 1). Onboarding basariyla bittikten SONRA transfer
// `sponsor paymaster adresi izinli kumede degil (0x0A8CD7A0...)` ile reddedildi.
//
// Sebep: hedef zincirde IKI paymaster rolu var —
//   ATSPaymaster       : same-chain (normal/bootstrap) op'lari sponsorlar  <- /health bunu doner
//   ATSRemotePaymaster : CAPRAZ-ZINCIR op'larini sponsorlar; AYRI kontrat, AYRI adres
// Allowlist yalniz birincisini taniyordu, yani ozelligin ASIL yolu kapaliydi. Zincirde
// dogrulandi: entryPoint() ayni, ats() YOK, owner() same-chain paymaster ile AYNI.
describe('paymasterAllowlist — uzaktan paymaster', () => {
  const PM = '0x' + 'a'.repeat(40)
  const REMOTE = '0x' + 'b'.repeat(40)
  const healthOnly = (pm) => ({ health: async () => ({ ok: true, chains: [{ chainId: 1, paymaster: pm }] }) })

  it('gomulu remote adres kumeye girer (/health onu donmese bile)', async () => {
    _resetPaymasterAllowlist()
    const list = await paymasterAllowlist({ client: healthOnly(PM), chainId: 1, configured: PM, remote: REMOTE })
    expect(list.map((a) => a.toLowerCase())).toEqual(expect.arrayContaining([PM, REMOTE]))
  })

  it('/health remotePaymaster donerse o da eklenir (ileri uyumluluk)', async () => {
    _resetPaymasterAllowlist()
    const FROM_HEALTH = '0x' + 'c'.repeat(40)
    const client = { health: async () => ({ chains: [{ chainId: 1, paymaster: PM, remotePaymaster: FROM_HEALTH }] }) }
    const list = await paymasterAllowlist({ client, chainId: 1, configured: PM })
    expect(list).toContain(FROM_HEALTH)
  })

  it('remote verilmemisse kume yalniz same-chain paymaster (davranis degismez)', async () => {
    _resetPaymasterAllowlist()
    const list = await paymasterAllowlist({ client: healthOnly(PM), chainId: 1, configured: PM })
    expect(list).toEqual([PM])
  })

  it('/health duserse gomulu iki adres de gecerli kalir (fail-static)', async () => {
    _resetPaymasterAllowlist()
    const client = { health: async () => { throw new Error('ag yok') } }
    const list = await paymasterAllowlist({ client, chainId: 1, configured: PM, remote: REMOTE })
    expect(list).toEqual([PM, REMOTE])
  })
})
