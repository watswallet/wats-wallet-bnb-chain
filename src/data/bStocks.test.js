import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { BSTOCKS, BSTOCKS_CHAIN_ID, BSTOCKS_BEACON, BSTOCKS_BEACON_SLOT, BSTOCKS_COMPLIANCE } from './bStocks'

describe('bStocks kaydi - butunluk', () => {
  it('22 kayit var', () => {
    expect(BSTOCKS).toHaveLength(22)
  })

  it('katalog sirasi: 09-18 listesi eksi BMNRB ve FLNCB, sonda TSMB ve NFLXB', () => {
    // Sayi tek basina yetmez: iki kayit cikip iki kayit eklenince uzunluk
    // yine 22. Sira da bilerek kilitli: Hisseler sekmesi bu sirayla cizilir
    // ve sunucunun listesi (server/data/bstocksAtlas.js) bu sirayi birebir
    // izler.
    expect(BSTOCKS.map((t) => t.symbol)).toEqual([
      'CRCLB', 'SPCXB', 'MSTRB', 'SNDKB', 'NVDAB', 'GOOGLB', 'SKHYB', 'TSLAB',
      'BNCB', 'SPYB', 'INTCB', 'GMEB', 'AAPLB', 'HOODB', 'BABAB', 'MSFTB',
      'AMZNB', 'QQQB', 'METAB', 'HIMSB', 'TSMB', 'NFLXB',
    ])
  })

  it('sabitler zincirde olculen degerlerle ayni', () => {
    expect(BSTOCKS_CHAIN_ID).toBe(56)
    expect(BSTOCKS_BEACON).toBe('0x156d6dce9a4f6139a3406f1f021f1a4880de93a3')
    expect(BSTOCKS_BEACON_SLOT).toBe('0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50')
    expect(BSTOCKS_COMPLIANCE).toBe('0x53dba7aabde774787a1f57236b235567da8e14f4')
  })

  it('her adres EIP-55 checksum biciminde', () => {
    // Istemcide tekillestirme DUZ string karsilastirmasiyla yapilan yerler var
    // (swapTo.vue:295). Karisik bicim ayni tokeni listede IKI KEZ gosterir.
    for (const t of BSTOCKS) {
      expect(t.address).toBe(ethers.getAddress(t.address))
    }
  })

  it('adres, sembol ve coingecko_id benzersiz', () => {
    const uniq = (key) => new Set(BSTOCKS.map((t) => t[key].toLowerCase()))
    expect(uniq('address').size).toBe(BSTOCKS.length)
    expect(uniq('symbol').size).toBe(BSTOCKS.length)
    expect(uniq('coingecko_id').size).toBe(BSTOCKS.length)
  })

  it('hepsi 18 ondalik (zincirde 22/22 dogrulandi)', () => {
    // Yanlis ondalik gosterim degil, DOGRUDAN para kaybi uretir: gonderim
    // ayni carpani kullaniyor.
    for (const t of BSTOCKS) expect(t.decimals).toBe(18)
  })

  it('image NESNE, dize degil', () => {
    // Token.vue:9 dogrudan displayToken?.image.thumb okuyor ve dize bicimini
    // COZEMEZ; detay ekraninda logo dicebear monogramina duser.
    for (const t of BSTOCKS) {
      expect(typeof t.image).toBe('object')
      expect(typeof t.image.large).toBe('string')
      expect(typeof t.image.small).toBe('string')
      expect(typeof t.image.thumb).toBe('string')
      expect(t.image.large).toMatch(/^https:\/\//)
    }
  })

  it('image uclusu AYNI CoinGecko gorselinin uc boyu', () => {
    // Uc URL elle kopyalaniyor. Iki hissenin gorselini karistirmak (large
    // TSMB, thumb NFLXB) hicbir baska testte kirmizi yakmaz ama liste ve
    // detay ekrani FARKLI logolar gosterir. Boy klasoru disinda uc URL ayni
    // olmali.
    const kok = (url) => url.replace(/\/(large|small|thumb)\//, '/<boy>/')
    for (const t of BSTOCKS) {
      expect(t.image.large).toMatch(/^https:\/\/coin-images\.coingecko\.com\/coins\/images\/\d+\/large\//)
      expect(t.image.small).toContain('/small/')
      expect(t.image.thumb).toContain('/thumb/')
      expect(kok(t.image.small)).toBe(kok(t.image.large))
      expect(kok(t.image.thumb)).toBe(kok(t.image.large))
    }
  })

  it('her kayitta ADGM ISIN kodu var', () => {
    for (const t of BSTOCKS) expect(t.isin).toMatch(/^AE000A[0-9A-Z]{6}$/)
  })

  it('coingecko_id ISIMDEN URETILMEZ - desen disi kimlikler korunur', () => {
    // 22'nin 4'u <sirket>-bstocks-tokenized-stock kalibina UYMUYOR.
    // 'nvidia-bstocks-tokenized-stock' tahmini CoinGecko'da 404 veriyor.
    const byId = Object.fromEntries(BSTOCKS.map((t) => [t.symbol, t.coingecko_id]))
    expect(byId.CRCLB).toBe('circle-internet-group-bstock')
    expect(byId.NVDAB).toBe('nvidia-bstocks')
    expect(byId.INTCB).toBe('intel-tokenized-bstocks')
    expect(byId.MSTRB).toBe('strategy-tokenized-bstocks')
  })

  it('2026-09-29 eklenenler: TSMB ve NFLXB zincirde olculen kimlikle, katalogun SONUNDA', () => {
    // Degerler zincirden (blok 124735060): symbol(), name(), decimals(),
    // identifier(); adres CoinGecko platform kaydi ve Atlas cryptoId ile ayni.
    // SONA eklenir: kalan eski kayitlarin sirasi degismez ve sunucunun
    // listesi (server/data/bstocksAtlas.js) bu sirayi birebir izler.
    const [tsmb, nflxb] = BSTOCKS.slice(-2)
    expect(tsmb).toMatchObject({
      symbol: 'TSMB',
      name: 'TSMC',
      address: '0xAB78b89B5bb00236Be0B4B20704cBfa04EfC711c',
      decimals: 18,
      coingecko_id: 'tsmc-bstocks-tokenized-stock',
      isin: 'AE000A4AVF43',
    })
    expect(nflxb).toMatchObject({
      symbol: 'NFLXB',
      name: 'Netflix',
      address: '0xD6829Ea836b6FA224d099D40E54B31262f874631',
      decimals: 18,
      coingecko_id: 'netflix-bstocks-tokenized-stock',
      isin: 'AE000A4AVSA4',
    })
  })

  it('2026-09-29 cikarilanlar: BMNRB ve FLNCB KAYITTA DEGIL (likidite kurali)', () => {
    // $10k girisinde birim fiyat sapmasi BMNRB +%3,20, FLNCB +%4,02 (blok
    // 124737683); kural <%2. 09-18'de ikisi de +%1,3'tu. Kullanici karariyla
    // cikarildilar (spec 11). Sembolun yaninda adres ve kimlik de aranir:
    // sembol zincirde degisebilir (setSymbol), adres degismez.
    const symbols = BSTOCKS.map((t) => t.symbol)
    const addresses = BSTOCKS.map((t) => t.address.toLowerCase())
    const ids = BSTOCKS.map((t) => t.coingecko_id)
    expect(symbols).not.toContain('BMNRB')
    expect(symbols).not.toContain('FLNCB')
    expect(addresses).not.toContain('0x3548da95a9effe481e8604664d75e95821e557f5')
    expect(addresses).not.toContain('0x4af1d41cd9dd950dca43984b43aaa2a8702714ac')
    expect(ids).not.toContain('bitmine-immersion-technologies-bstocks-tokenized-stock')
    expect(ids).not.toContain('fluence-energy-bstocks-tokenized-stock')
  })

  it('kaldiracli ETF, sig ve kimliksiz tokenlar KAYITTA DEGIL', () => {
    const symbols = BSTOCKS.map((t) => t.symbol)
    // Gunluk yeniden dengelenen, uzun vadede deger eriten urunler (2026-09-18
    // spec bolum 3, 2026-09-29 spec bolum 3).
    for (const s of ['SOXLB', 'TQQQB', 'SQQQB', 'SOXSB', 'SNXXB', 'KORUB', 'MUUB', 'MVLLB', 'INTWB']) {
      expect(symbols).not.toContain(s)
    }
    // 2026-09-29 olcumunde SIG: NOKB %4,2 ($15k'da %26), AMCB %3,7.
    for (const s of ['NOKB', 'AMCB']) {
      expect(symbols).not.toContain(s)
    }
    // CoinGecko kaydi yok ve Atlas MultiFeed yuvalari zincirde 0 (yalniz
    // pull modu) -> fiyat ve grafik kalici bos kalirdi.
    for (const s of ['MRNAB', 'CRWDB', 'STXB']) {
      expect(symbols).not.toContain(s)
    }
  })
})
