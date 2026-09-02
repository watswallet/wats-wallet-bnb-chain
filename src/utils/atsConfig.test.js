import { describe, it, expect } from 'vitest'
import { getAtsConfigFrom, getAtsConfig, isAtsChain, ATS_CHAINS, ATS_SRC_CHAIN_ID, ATS_COLLECTOR, getAtsSourceConfig } from './atsConfig'
import supportedChains from '../data/supported_chains.json'
import { CHAIN_ADDRESSES } from './sdk/gasless'
import { isEvm, TON_MAINNET_ID } from './chainKind'
import { ethers } from 'ethers'
import { SOLANA_CHAIN_ID } from './solana/constants'

const OK = {
  421614: {
    paymaster: '0x1111111111111111111111111111111111111111',
    delegate: '0x2222222222222222222222222222222222222222',
    entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    token: { address: '0x3333333333333333333333333333333333333333', symbol: 'ATS', decimals: 18 },
    backendBase: 'https://example.test',
  },
}
const without = (field) => {
  const c = JSON.parse(JSON.stringify(OK))
  if (field === 'token.address') c[421614].token.address = ''
  else c[421614][field] = ''
  return c
}

describe('getAtsConfigFrom', () => {
  it('tum zorunlu alanlar doluysa kaydi dondurur', () => {
    expect(getAtsConfigFrom(OK, 421614)).toEqual(OK[421614])
  })
  it('chainId string olsa da eslesir', () => {
    expect(getAtsConfigFrom(OK, '421614')).toEqual(OK[421614])
  })
  it('tanimsiz zincir icin null', () => {
    expect(getAtsConfigFrom(OK, 1)).toBe(null)
  })
  it('zorunlu alanlardan HERHANGI biri bossa null (ozellik atil kalir)', () => {
    for (const f of ['paymaster', 'delegate', 'entryPoint', 'token.address', 'backendBase']) {
      expect(getAtsConfigFrom(without(f), 421614)).toBe(null)
    }
  })
  it('bos chains nesnesi icin null', () => {
    expect(getAtsConfigFrom({}, 421614)).toBe(null)
  })
})

// Canli aktivasyon: Arbitrum One (42161) dolu -> ozellik acik.
describe('ATS_CHAINS canli - Arbitrum One (42161)', () => {
  it('42161 aktif: getAtsConfig non-null, isAtsChain true', () => {
    expect(getAtsConfig(42161)).not.toBe(null)
    expect(isAtsChain(42161)).toBe(true)
  })
  it('adresler gecerli + token 18 decimals + backendBase https', () => {
    const c = getAtsConfig(42161)
    expect(c.paymaster).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(c.delegate).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(c.entryPoint).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(c.token.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(c.token.symbol).toBe('ATS')
    expect(c.token.decimals).toBe(18)
    expect(c.backendBase).toMatch(/^https:\/\//)
  })
})

// Backend'in destekledigi zincir kumesi (kendi hata mesajindan okundu) ile cuzdanin
// listeledigi aglar AYNI olmali. Ayrisirlarsa iki sessiz ariza dogar: cuzdanda olup
// backend'de olmayan bir agda ATS ucreti "zincir desteklenmiyor" ile duser; tersinde
// ise calisir durumdaki bir zincir kullaniciya hic sunulmaz.
const BACKEND_CHAINS = [42161, 8453, 56, 137, 1, 10, 100, 42220, 5000, 25]

describe('desteklenen aglar <-> ATS zincirleri', () => {
  // TUM kayitlar: yalnizca "chainId ler benzersiz" testi bunu kullanir. Benzersizlik
  // EVM disi kayitlar icin de gecerli olmali -- Solana'nin METIN kimligi
  // ('solana-mainnet') ya da TON'un NEGATIF kimligi (-239/-3) bir EVM kimligiyle
  // cakisirsa zincir cozumlemesi her katmanda yanlis kaydi bulur.
  const walletChainIds = supportedChains.map((c) => c.chainId)

  // ATS (gasless odeme) EVM'e OZGU bir akis (7702 delege + paymaster). Ne TON'da ne
  // Solana'da bu kavramlarin karsiligi var: TON'un kendi ucret/sponsorluk yolu var,
  // Solana ise ileriki bir gorevde kendi ucret yolunu alacak. Ikisi de backend'in
  // bugunku EVM listesiyle KARSILASTIRILMAZ.
  //
  // Kapi isEvm (chainKind.js) -- tek bir alana bakan elle yazilmis bir filtre
  // otekini EVM sayardi: TON kaydi `kind:'ton'` tasir ama `vm` alani YOKTUR,
  // Solana kaydi `vm:'solana'` tasir ama `kind` alani YOKTUR.
  const evmWalletChainIds = supportedChains.filter((c) => isEvm(c)).map((c) => c.chainId)

  it('cuzdan TAM OLARAK backend in destekledigi zincirleri listeler', () => {
    expect([...evmWalletChainIds].sort((a, b) => a - b))
      .toEqual([...BACKEND_CHAINS].sort((a, b) => a - b))
  })

  it('her desteklenen EVM agin bir ATS kaydi var', () => {
    for (const id of evmWalletChainIds) expect(ATS_CHAINS[id]).toBeTruthy()
  })

  // Review Bulgu 4: yukaridaki EVM filtresi Solana'yi bu katmandan SESSIZCE
  // cikardi; bu satir olmadan bir gercek eksiklik (Solana icin ATS unutulmus)
  // kasitli bir disleme ile ayirt edilemezdi. `getAtsConfigFrom` icinde
  // `chains[Number(chainId)]` var — Number('solana-mainnet') NaN'dir, `NaN`
  // property anahtari hicbir kayda eslesmez, yani sonuc yine dogru (false) ama
  // sebebi bir Number() sans eseri kacamak — atsConfig.js'in kendisi bu gorevin
  // dosya listesinde degil, dokunulmadi.
  it('Solana icin ATS kaydi YOK (henuz baglanmadi)', () => {
    expect(isAtsChain(SOLANA_CHAIN_ID)).toBe(false)
  })

  // Ayni gerekce TON icin: yukaridaki isEvm filtresi TON'u da bu katmandan
  // SESSIZCE cikariyor. TON'un kimligi NEGATIF bir sayidir, yani Number() yolu
  // onu -239 olarak COZER (Solana'daki NaN kacamagi TON'da YOKTUR) ve
  // `ATS_CHAINS[-239]` sadece kayit olmadigi icin undefined doner. Disleme
  // KASITLI oldugundan testte durur: TON'a bir gun ATS kaydi eklenirse burasi
  // kirilir ve karar yeniden verilir.
  it('TON icin ATS kaydi YOK (kendi ucret yolu var)', () => {
    expect(isAtsChain(TON_MAINNET_ID)).toBe(false)
  })

  it('ATS tablosunda desteklenmeyen zincir YOK', () => {
    for (const id of Object.keys(ATS_CHAINS)) {
      expect(evmWalletChainIds).toContain(Number(id))
    }
  })

  it('chainId ler benzersiz', () => {
    expect(new Set(walletChainIds).size).toBe(walletChainIds.length)
  })
})

// On zincirin hepsi yapilandirildi. Bir adres bozulursa (eksik karakter, gecersiz hex
// basamak) ozellik o zincirde sessizce olmemeli: format testte kilitli.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

describe('on zincirin hepsi yapilandirilmis', () => {
  it('her zincir icin isAtsChain true', () => {
    for (const id of Object.keys(ATS_CHAINS)) {
      expect(isAtsChain(Number(id))).toBe(true)
    }
  })

  // Kaynak tablodaki paymaster'lardan biri 39 karakterdi (bir hex basamagi dusmus),
  // bir ATS adresinde de hex olmayan 'S' vardi. Ikisi de sessiz arizaya yol acardi:
  // ethers gecersiz adreste atar, hata quote akisinda yutulur ve kullanici yalnizca
  // "ucret hesaplanamadi" gorur.
  it('tum adresler tam 40 hex basamak', () => {
    for (const [id, c] of Object.entries(ATS_CHAINS)) {
      expect(c.paymaster, `paymaster ${id}`).toMatch(ADDRESS_RE)
      expect(c.delegate, `delegate ${id}`).toMatch(ADDRESS_RE)
      expect(c.entryPoint, `entryPoint ${id}`).toMatch(ADDRESS_RE)
      expect(c.token.address, `token ${id}`).toMatch(ADDRESS_RE)
    }
  })

  // GERCEK VAKA (2026-08-09, Ethereum): token adresi `...Ea857F750dEC1c8` yazilmisti,
  // dogrusu `...Ea857f750dEC1c8`. Baytlar dogru, YALNIZ HARF KASASI yanlisti — yani
  // yukaridaki "40 hex basamak" ve asagidaki toLowerCase() karsilastirmalari BU HATAYI
  // GORMEZ, gormedi de. ethers'in ABI kodlayicisi ise getAddress ile REDDEDER: cuzdan
  // tokeni listeler, bakiyesini gosterir, gonderim aninda "Invalid parameter." ile duser.
  // PM_OP_GROUP'ta (bes zincirin paymaster'i) ayni hata vardi.
  //
  // Bu yuzden kontrol toLowerCase DEGIL, BIREBIR esitlik olmali.
  it('tum adresler EIP-55 checksum-dogru (kasa dahil birebir)', () => {
    const same = (a, label) => expect(ethers.getAddress(a.toLowerCase()), label).toBe(a)
    for (const [id, c] of Object.entries(ATS_CHAINS)) {
      same(c.paymaster, `paymaster ${id}`)
      same(c.delegate, `delegate ${id}`)
      same(c.entryPoint, `entryPoint ${id}`)
      same(c.token.address, `token ${id}`)
      if (c.collector) same(c.collector, `collector ${id}`)
    }
    for (const [id, a] of Object.entries(CHAIN_ADDRESSES)) {
      same(a.paymaster, `sdk paymaster ${id}`)
      same(a.ats, `sdk ats ${id}`)
      same(a.delegate, `sdk delegate ${id}`)
      same(a.entryPoint, `sdk entryPoint ${id}`)
    }
  })

  it('token her zincirde ATS/18 ve backend https', () => {
    for (const c of Object.values(ATS_CHAINS)) {
      expect(c.token.symbol).toBe('ATS')
      expect(c.token.decimals).toBe(18)
      expect(c.backendBase).toMatch(/^https:\/\//)
    }
  })

  // Delege, kullanicinin EOA'sinin 7702 ile baglandigi kontrat. Zincir basina
  // farklilasirsa yanlis implementasyona delege edilir; on zincirde de ayni adres
  // ve ayni bytecode oldugu dogrulandi.
  it('delegate ve entryPoint tum zincirlerde ayni', () => {
    const delegates = new Set(Object.values(ATS_CHAINS).map((c) => c.delegate))
    const entryPoints = new Set(Object.values(ATS_CHAINS).map((c) => c.entryPoint))
    expect(delegates.size).toBe(1)
    expect(entryPoints.size).toBe(1)
  })

  it('paymaster ATS tokeninden FARKLI bir adres (karisma olmasin)', () => {
    for (const [id, c] of Object.entries(ATS_CHAINS)) {
      expect(c.paymaster.toLowerCase(), `chain ${id}`).not.toBe(c.token.address.toLowerCase())
    }
  })

  it('kayitlarda sabit gas blogu ARTIK yok (dinamik tahmine gecildi)', () => {
    for (const id of Object.keys(ATS_CHAINS)) expect(ATS_CHAINS[id].gas).toBeUndefined()
  })
})

describe('kaynak zincir sabitleri', () => {
  it('kaynak zincir BSC (56)', () => {
    expect(ATS_SRC_CHAIN_ID).toBe(56)
  })
  it('collector checksum-dogru bir adres', () => {
    expect(ethers.getAddress(ATS_COLLECTOR)).toBe(ATS_COLLECTOR)
  })
  it('collector YALNIZ 56 kaydinda bulunur', () => {
    expect(ATS_CHAINS[56].collector).toBe(ATS_COLLECTOR)
    for (const id of Object.keys(ATS_CHAINS)) {
      if (Number(id) !== 56) expect(ATS_CHAINS[id].collector).toBeUndefined()
    }
  })
  it('her kayit srcChainId=56 tasir', () => {
    for (const id of Object.keys(ATS_CHAINS)) expect(ATS_CHAINS[id].srcChainId).toBe(56)
  })
  it('getAtsSourceConfig BSC kaydini dondurur', () => {
    expect(getAtsSourceConfig().token.address).toBe('0x75D8BB7fBd4782a134211dc350Ba5c715197B81d')
  })
})

describe('atsConfig <-> SDK CHAIN_ADDRESSES ayrismasi', () => {
  it('ayni zincir kumesi', () => {
    expect(Object.keys(ATS_CHAINS).map(Number).sort((a, b) => a - b))
      .toEqual(Object.keys(CHAIN_ADDRESSES).map(Number).sort((a, b) => a - b))
  })
  it('paymaster/ats/delegate/entryPoint dort alanda da birebir ayni', () => {
    // Iki tablo ayrisirsa: flow.ts addressesFor'dan, orkestrasyon atsConfig'ten okur ->
    // approve BASKA bir spender'a gider, allowance hic yukselmez, her op postOp'ta revert eder.
    for (const [id, a] of Object.entries(CHAIN_ADDRESSES)) {
      const c = ATS_CHAINS[Number(id)]
      expect(c.paymaster.toLowerCase()).toBe(a.paymaster.toLowerCase())
      expect(c.token.address.toLowerCase()).toBe(a.ats.toLowerCase())
      expect(c.delegate.toLowerCase()).toBe(a.delegate.toLowerCase())
      expect(c.entryPoint.toLowerCase()).toBe(a.entryPoint.toLowerCase())
    }
  })
})

// UZAKTAN PAYMASTER (ATSRemotePaymaster): capraz-zincir op'larini hedef zincirde sponsorlar.
// Same-chain paymaster'dan AYRI kontrattir ve /health onu donmez — allowlist tanimayinca
// ozelligin ASIL yolu kapali kaliyordu (2026-08-10; once chainId 1, sonra 137).
describe('uzaktan paymaster', () => {
  // 2026-08-12: /health artik her zincir icin `remotePaymaster` donuyor (rapor 4c kapandi).
  // Dokuz adresin HEPSI zincirde dogrulandi (runtime 10236, entryPoint v0.8, owner
  // 0xb42f545b..., ats() yok) ve gomulu tabloya alindi — /health dusse de capraz-zincir
  // yolu ayakta kalir (fail-static).
  const KNOWN = [1, 10, 25, 100, 137, 5000, 8453, 42161, 42220]

  it('bilinen zincirlerde dolu ve EIP-55 checksum-dogru', () => {
    for (const id of KNOWN) {
      const a = ATS_CHAINS[id].remotePaymaster
      expect(a, `chain ${id}`).toBeTruthy()
      expect(ethers.getAddress(a.toLowerCase()), `chain ${id}`).toBe(a)
    }
  })

  // Same-chain paymaster ile KARISMAMALI: ikisi farkli kontrat, farkli rol. Ayni adresi
  // yazmak allowlist'i genisletmis gibi gorunur ama capraz-zincir op'unu yine reddeder.
  it('same-chain paymaster ile ayni adres DEGIL', () => {
    for (const id of KNOWN) {
      expect(ATS_CHAINS[id].remotePaymaster.toLowerCase())
        .not.toBe(ATS_CHAINS[id].paymaster.toLowerCase())
    }
  })

  // Adresler cogunlukla zincir basina farkli; tek istisna Mantle/Celo ikilisi. Celo'da
  // canli hata verdi (2026-08-12, "izinli kumede degil") ve backend'in dondurdugu adres
  // Mantle'inkiyle AYNI cikti — zincirde dogrulandi (runtime 10236, entryPoint/owner OK,
  // ats() yok). Yani paylasilan adres tahmin degil, olcum. Benzersizlik kontrolu bu
  // belgelenmis istisnayi disarida tutar: yeni bir zinciri korlemesine kopyalamak yine yakalanir.
  it('Mantle ve Celo ayni (zincirde dogrulanmis) adresi paylasir', () => {
    expect(ATS_CHAINS[42220].remotePaymaster).toBe(ATS_CHAINS[5000].remotePaymaster)
  })
  it('istisna disinda her zincirde benzersiz', () => {
    const seen = KNOWN.filter((id) => id !== 42220)
      .map((id) => ATS_CHAINS[id].remotePaymaster.toLowerCase())
    expect(new Set(seen).size).toBe(seen.length)
  })

  // Kaynak zincirde capraz-zincir yolu YOKTUR (belge 05): tahsilat zaten oradadir.
  it('kaynak zincirde (56) remote paymaster YOK', () => {
    expect(ATS_CHAINS[56].remotePaymaster).toBeUndefined()
  })
})
