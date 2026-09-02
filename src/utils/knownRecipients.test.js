import { describe, it, expect } from 'vitest'
import { Address } from '@ton/core'
import { flattenVaultAccounts, resolveRecipient, resolveRecipientLabel, accountsForChain } from './knownRecipients'

const ADDR_A = '0xAbCd000000000000000000000000000000000001'
const ADDR_B = '0xAbCd000000000000000000000000000000000002'

describe('flattenVaultAccounts', () => {
  it('tum vaultlardaki hesaplari tek listede doner', () => {
    const vaults = [
      { accounts: [{ name: 'Ana Hesap', address: ADDR_A, key: 'k1' }] },
      { accounts: [{ name: 'Import 1', address: ADDR_B, key: 'k2' }] }
    ]
    const accounts = flattenVaultAccounts(vaults)
    expect(accounts).toHaveLength(2)
    expect(accounts[0].name).toBe('Ana Hesap')
    expect(accounts[1].address).toBe(ADDR_B)
  })

  it('bozuk/eksik girdilere toleransli', () => {
    expect(flattenVaultAccounts(undefined)).toEqual([])
    expect(flattenVaultAccounts(null)).toEqual([])
    expect(flattenVaultAccounts([])).toEqual([])
    expect(flattenVaultAccounts([{}, { accounts: null }])).toEqual([])
    // adressiz hesaplar (ornegin local) listelenmez
    expect(flattenVaultAccounts([{ accounts: [{ name: 'Adressiz' }] }])).toEqual([])
  })
})

describe('resolveRecipientLabel', () => {
  const accounts = [{ name: 'Ana Hesap', address: ADDR_A, key: 'k1' }]
  const savedAddresses = [
    { label: 'Borsa', address: ADDR_B, chainId: 1 },
    { label: 'Ana (defter)', address: ADDR_A, chainId: 1 }
  ]

  it('hesap adini buyuk/kucuk harf duyarsiz cozer', () => {
    expect(resolveRecipientLabel(ADDR_A.toLowerCase(), { accounts, savedAddresses: [] })).toBe('Ana Hesap')
    expect(resolveRecipientLabel(ADDR_A.toUpperCase().replace('0X', '0x'), { accounts, savedAddresses: [] })).toBe('Ana Hesap')
  })

  it('adres defteri etiketini cozer', () => {
    expect(resolveRecipientLabel(ADDR_B, { accounts, savedAddresses })).toBe('Borsa')
  })

  it('hesap adi adres defteri etiketine gore onceliklidir', () => {
    expect(resolveRecipientLabel(ADDR_A, { accounts, savedAddresses })).toBe('Ana Hesap')
  })

  it('bilinmeyen adreste null doner', () => {
    expect(resolveRecipientLabel('0x0000000000000000000000000000000000000099', { accounts, savedAddresses })).toBe(null)
  })

  it('bos/gecersiz girdilerde null doner', () => {
    expect(resolveRecipientLabel('', { accounts, savedAddresses })).toBe(null)
    expect(resolveRecipientLabel(null, { accounts, savedAddresses })).toBe(null)
    expect(resolveRecipientLabel(ADDR_A, {})).toBe(null)
    expect(resolveRecipientLabel(ADDR_A, undefined)).toBe(null)
  })
})

describe('resolveRecipient', () => {
  const accounts = [{ name: 'Ana Hesap', address: ADDR_A, key: 'k1' }]

  it('kayittaki adresi checksum case ile doner (identicon seed tutarliligi)', () => {
    const resolved = resolveRecipient(ADDR_A.toLowerCase(), { accounts, savedAddresses: [] })
    expect(resolved).toEqual({ label: 'Ana Hesap', address: ADDR_A })
  })

  it('bilinmeyen adreste null doner', () => {
    expect(resolveRecipient(ADDR_B, { accounts, savedAddresses: [] })).toBe(null)
  })
})

// Bugun accounts/savedAddresses hep EVM tasiyor (bkz. dosya basi yorum) ama eslesme
// artik addressPoisoning.js ile AYNI paylasilan kurala (addressForm.js) dayaniyor.
// Bu yuzden Solana (base58) girdisi de dogru davraniyor olmali: kucultulmemeli.
describe('resolveRecipient / resolveRecipientLabel — Solana (base58) adresler', () => {
  const SOL_A = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  // SOL_A ile YALNIZCA bas 4 karakterin harf kasasi farkli — gerisi birebir ayni.
  const SOL_A_CASE_VARIANT = '9wzdXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  const accounts = [{ name: 'Solana Cuzdanim', address: SOL_A, key: 'k1' }]

  it('tam ayni harf kasasiyla Solana hesabini cozer', () => {
    expect(resolveRecipient(SOL_A, { accounts, savedAddresses: [] }))
      .toEqual({ label: 'Solana Cuzdanim', address: SOL_A })
  })

  // BASE58 BUYUK/KUCUK HARF DUYARLIDIR. Kucultme yapilsaydi SOL_A_CASE_VARIANT
  // kayitli SOL_A ile "ayni adres" sayilir, GERCEKTE FARKLI bir adrese kendi
  // hesabimin etiketini yapistirirdik — addressPoisoning.js'te kapatilan tuzagin
  // burada da acik olmadigini kanitlar.
  it('yalnizca harf kasasi farkli Solana adresi AYNI HESAP SANILMAZ', () => {
    expect(resolveRecipient(SOL_A_CASE_VARIANT, { accounts, savedAddresses: [] })).toBe(null)
  })

  it('EVM hesaplariyla Solana adresi KARISTIRILMAZ (bicim ayrimi burada da gecerli)', () => {
    const mixedAccounts = [{ name: 'EVM Hesabim', address: ADDR_A, key: 'k1' }]
    expect(resolveRecipient(SOL_A, { accounts: mixedAccounts, savedAddresses: [] })).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// accountsForChain — kendi hesaplarin AKTIF ZINCIRIN adresiyle.
//
// Zehirli adres kapisi hesaplari `address` uzerinden okuyordu; TON agindayken
// guvenilir listeye kullanicinin EVM adresleri giriyor, TON adresleri HIC
// girmiyordu. Modul TON adreslerini tanisa bile karsilastiracak TON adresi
// bulamiyor ve koruma TON'da SESSIZCE hicbir sey yapmiyordu.
// ---------------------------------------------------------------------------
const TON_MAIN = 'UQCQvhHtQ6MKAQ0J7OCHB3lug434uG7tBMrDgKvtylug9knE'
// TON_MAIN ile AYNI hesabin TESTNET non-bounceable bicimi - uydurma DEGIL,
// Address.parse ile uretildi ve ayristirilabilir oldugu asagida dogrulaniyor.
const TON_TEST = '0QCQvhHtQ6MKAQ0J7OCHB3lug434uG7tBMrDgKvtylug9vJO'
const EVM_ADDR = '0x' + 'a'.repeat(40)

const VAULTS = [{ accounts: [
    { name: 'Ana', address: EVM_ADDR, tonAddress: TON_MAIN, tonAddressTestnet: TON_TEST },
    { name: 'TON turetilmemis', address: '0x' + 'b'.repeat(40) },
] }]

describe('accountsForChain', () => {
    it('EVM zincirinde EVM adresini verir - davranis DEGISMEDI', () => {
        const out = accountsForChain(VAULTS, 1)
        expect(out).toHaveLength(2)
        expect(out[0].address).toBe(EVM_ADDR)
    })

    it('TON mainnet te TON adresini verir - EVM adresini DEGIL', () => {
        const out = accountsForChain(VAULTS, -239)
        expect(out.map(a => a.address)).toEqual([TON_MAIN])
    })

    // Tek bir alan hangi ag once turetirse onu kalici kazandiriyordu; testnet
    // AYRI alanda tutuluyor (ensureTonAddress ile ayni kural).
    it('TON testnet te AYRI alani okur', () => {
        expect(accountsForChain(VAULTS, -3).map(a => a.address)).toEqual([TON_TEST])
    })

    // Turetme BURADA yapilmaz (dosya saf, turetme kasa acmayi gerektirir).
    // Adresi olmayan hesap listeden DUSER - hicbir sey bozulmaz, o hesap icin
    // bir uyari uretilmez sadece.
    it('TON adresi turetilmemis hesap DUSER', () => {
        const out = accountsForChain(VAULTS, -239)
        expect(out.find(a => a.name === 'TON turetilmemis')).toBeUndefined()
    })

    it('hesap adi KORUNUR - uyari kartinda gosterilir', () => {
        expect(accountsForChain(VAULTS, -239)[0].name).toBe('Ana')
    })

    it('bos/gecersiz girdi bos dizi doner', () => {
        expect(accountsForChain(null, -239)).toEqual([])
        expect(accountsForChain([], -239)).toEqual([])
    })
})

// Fixture'lar GERCEK olmali: uydurma dize Address.parse tarafindan reddedilir ve
// bir gun bu dosyaya ayristirma eklenirse testler YANLIS SEBEPTEN duser. Ilk
// yazimda TON_TEST gercekten uydurulmustu ve bu test onu yakaladi.
describe('accountsForChain fixture bütünlügü', () => {
    it('TON fixture adresleri GERCEKTEN ayristirilabilir', () => {
        expect(() => Address.parse(TON_MAIN)).not.toThrow()
        expect(() => Address.parse(TON_TEST)).not.toThrow()
    })

    it('ikisi AYNI hesabin mainnet/testnet bicimidir', () => {
        expect(Address.parse(TON_MAIN).hash.equals(Address.parse(TON_TEST).hash)).toBe(true)
    })
})
