// KATALOG DEFTERI: katalogdan cikan her token emekli listeye girmek ZORUNDA (ilk alim kapisi, K28 ve bStocks karsiligi).
//
// KOK NEDEN / KAPATILAN HATA: kapi katalog uyeligine baglidir (tokenizedStocks.stockIssuer). Bir satir katalogdan
// cikinca token zincirde ve sunucunun /getChainTokens listesinde kalir, ama kapidan DUSER: 9fb92682 (ADBEx, PYPLx,
// STRCx; K28) ve e7089f2d (BMNRB, FLNCB; 2026-11-11 bulgusu) boyle iki kez kapisiz alinabilir token biraktirdi.
// "Emekli liste katalogla kesismez" testi yalniz kesisimi yakalar, EKSIK EKLEMEYI yakalamaz; bu defter onu yakalar.
//
// NASIL CALISIR: DEFTER, bugune kadar bStocks / xStocks katalogunda bir kez olsun listelenmis her adresi sabitler
// (sembol:adres kucuk harf). Iki yonlu kilit:
//   (1) DEFTERDEKI her adres bugun katalogda YA DA emekli listede olmali -> bir satiri katalogdan cikaran, emekli
//       listeye eklemeyi unutursa kirmizi (yeni token icin de, asagidaki (2) sayesinde).
//   (2) KATALOGDAKI her adres defterde olmali -> yeni bir token ekleyen onu deftere de yazar; boylece sonradan
//       cikarilirsa (1) onu yakalar.
// GUNCELLEME TARIFI: katalog satiri EKLEMEK -> bu dosyadaki ilgili listeye `SEMBOL:adres(kucuk harf)` satiri ekle.
// Katalog satiri CIKARMAK -> data/bStocksRetired.js ya da data/xStocksRetired.js'e ekle; DEFTERDEN SILME.
// Bir adres yeniden listelenirse emekli listeden silinir, defterde kalir.
import { describe, it, expect } from 'vitest'
import { BSTOCKS } from './bStocks'
import { XSTOCKS } from './xStocks'
import { RETIRED_BSTOCKS } from './bStocksRetired'
import { RETIRED_XSTOCKS } from './xStocksRetired'

// Git gecmisinden (git log -p -- data/bStocks.js / xStocks.js) cikarildi: her biri 'address:' alaniyla kayitli tum
// adresler. bStocks 24 (katalogda 22 + emekli 2), xStocks 24 (katalogda 21 + emekli 3).
const DEFTER_BSTOCKS = [
  'CRCLB:0x80f3d493ebce97e343c53d29a137942416b4ffc0',
  'SPCXB:0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1',
  'MSTRB:0xe87afb3076aeb0f9b14e368de8145ae6a2826a14',
  'SNDKB:0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb',
  'NVDAB:0x02fca66c1d1afb4e2a7884261eb00f63598a7436',
  'GOOGLB:0x3f53de71c126bdabae20f9cd64848d317f6c3238',
  'SKHYB:0xca750ef65f295bbecd685abf54e82caf297bdb61',
  'TSLAB:0x5b1910eaad6450e50f816082aa078c41f10c292f',
  'BNCB:0x4902c5ebc598265ed2212b559b042de8a5eeec3f',
  'SPYB:0x7138b48df7d98d7e3cc221bfe7192d0a178182d8',
  'INTCB:0xe614e2fc6c787035ff51f452e8e826bfd32d5283',
  'GMEB:0x46ceefda28dd7207059ed19b0acdc026955bb15c',
  'AAPLB:0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a',
  'HOODB:0xa394dcea3fd3847fd793afbfd163e2e3858b7c65',
  'BABAB:0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec',
  'MSFTB:0x80106cb3ead06659a5ad19df39d9b4733863b9b0',
  'AMZNB:0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00',
  'QQQB:0x205812cdbed920aff76c6580abd681a46d11efc7',
  'METAB:0x7425889fe94f9d693e8daefe88bcced6acfef4c0',
  'HIMSB:0xee6f4bcc88c2c8583d5a65c7d0c877b464100711',
  'TSMB:0xab78b89b5bb00236be0b4b20704cbfa04efc711c',
  'NFLXB:0xd6829ea836b6fa224d099d40e54b31262f874631',
  'BMNRB:0x3548da95a9effe481e8604664d75e95821e557f5',
  'FLNCB:0x4af1d41cd9dd950dca43984b43aaa2a8702714ac',
]

const DEFTER_XSTOCKS = [
  'TSLAx:0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0',
  'NVDAx:0xc845b2894dbddd03858fd2d643b4ef725fe0849d',
  'SPYx:0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48',
  'AAPLx:0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a',
  'QQQx:0xa753a7395cae905cd615da0b82a53e0560f250af',
  'GOOGLx:0xe92f673ca36c5e2efd2de7628f815f84807e803f',
  'MSTRx:0xae2f842ef90c0d5213259ab82639d5bbf649b08e',
  'COINx:0x364f210f430ec2448fc68a49203040f6124096f0',
  'AMZNx:0x3557ba345b01efa20a1bddc61f573bfd87195081',
  'MSFTx:0x5621737f42dae558b81269fcb9e9e70c19aa6b35',
  'AVGOx:0x38bac69cbbd28156796e4163b2b6dcb81e336565',
  'Vx:0x2363fd1235c1b6d3a5088ddf8df3a0b3a30c5293',
  'KOx:0xdcc1a2699441079da889b1f49e12b69cc791129b',
  'MUx:0xf6a873bae4ba1b304e45df52a4b7d176e1c6a8c4',
  'MRNAx:0xefd30445a4ec1f4b3e0a6f4d9bdbd215f805047f',
  'CRCLx:0xfebded1b0986a8ee107f5ab1a1c5a813491deceb',
  'GLXYx:0xf7f4fac56f012de7dd6adff54c761986b9e0655a',
  'BSPx:0x7796f4e23a62ef3653829c21032a9e24beaf4cf5',
  'VTx:0x6d5edeebbc6a4099eb8bb289eb3b80d799f7b28c',
  'VTIx:0xbd730e618bcd88c82ddee52e10275cf2f88a4777',
  'COPXx:0x89bab39d627a9e34f0dc782c53457e80ee8fb9d9',
  'ADBEx:0x16e0b579be45baae54ceddd52e742b6457a7fe12',
  'PYPLx:0xf706585e7e8900be0267bee3b9a2f70835ec6628',
  'STRCx:0x1aad217b8f78dba5e6693460e8470f8b1a3977f3',
]

const lower = (rows) => rows.map((r) => r.address.toLowerCase())
const adresiOf = (satir) => satir.split(':')[1]

describe.each([
  ['bStocks', DEFTER_BSTOCKS, BSTOCKS, RETIRED_BSTOCKS, 'data/bStocksRetired.js'],
  ['xStocks', DEFTER_XSTOCKS, XSTOCKS, RETIRED_XSTOCKS, 'data/xStocksRetired.js'],
])('katalog defteri: %s', (_ad, defter, katalog, emekli, emekliDosya) => {
  it('defter tekil ve her satir sembol:adres(kucuk harf) bicimli', () => {
    for (const satir of defter) expect(satir, satir).toMatch(/^[A-Za-z]+:0x[0-9a-f]{40}$/)
    expect(new Set(defter.map(adresiOf)).size).toBe(defter.length)
  })

  it(`(1) defterdeki her adres katalogda YA DA ${emekliDosya}'de: katalogdan cikaran emekli listeye ekler`, () => {
    const canli = new Set([...lower(katalog), ...lower(emekli)])
    const eksik = defter.filter((satir) => !canli.has(adresiOf(satir)))
    expect(eksik, `KAPISIZ KALAN TOKEN: katalogdan cikti ama ${emekliDosya}'e eklenmedi`).toEqual([])
  })

  it('(2) katalogdaki ve emekli listedeki her adres defterde: yeni token deftere yazilir', () => {
    const kayitli = new Set(defter.map(adresiOf))
    const yok = [...lower(katalog), ...lower(emekli)].filter((adres) => !kayitli.has(adres))
    expect(yok, 'deftere yazilmamis katalog / emekli adresi').toEqual([])
  })

  it('katalog ile emekli liste kesismez (yeniden listelenen adres emekli listeden silinir)', () => {
    const emekliAdresler = new Set(lower(emekli))
    expect(lower(katalog).filter((adres) => emekliAdresler.has(adres))).toEqual([])
  })
})
