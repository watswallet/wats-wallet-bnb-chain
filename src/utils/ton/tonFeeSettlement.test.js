import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  tonSettlementKey,
  saveTonSettlement,
  loadAllTonSettlements,
  updateTonSettlement,
  clearTonSettlement,
  pruneTonSettlements,
  hasUnsettledTonFee,
  _setTonSettlementStore,
} from './tonFeeSettlement'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8')

// chrome.storage.local'in get/set imzasini taklit eden asgari sahte depo. Gercek depo
// { [key]: value } sarmalar - burada da ayni sarmalama uygulanir ki modulun okuma/yazma
// yolu gercek chrome.storage.local ile ayni sekilde egzersiz edilsin.
function fakeStore(initial = {}) {
  let data = { ...initial }
  return {
    async get(key) { return { [key]: data[key] } },
    async set(obj) { data = { ...data, ...obj } },
  }
}

const walletA = 'EQD4joKxbphnt0bFfsaCb-KyJaydnMiLTTltGfrQB0mjzgJ2'
const walletB = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const hashA = '0xbc7e0f3a254ff14e90eeb7591e1bc9781214a57c74416b2b897ab8deb4539f7f'
const hashB = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

describe('tonSettlementKey - actionHash a bagli, seqno ya DEGIL', () => {
  it('seqno degisince AYNI kayit bulunur', async () => {
    const store = fakeStore()
    _setTonSettlementStore(store)
    const rec = { tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }
    await saveTonSettlement(rec)

    const savedKey = tonSettlementKey({ tonWallet: walletA, actionHash: hashA })
    // Kurtarma sirasinda seqno zincirden TAZE okunur ve ilk kayittan farkli olabilir
    // (design bolum 6: "seqno artti != basarili"). Anahtar bu farktan ETKILENMEMELI.
    const lookupKeyWithDifferentSeqno = tonSettlementKey({ tonWallet: walletA, actionHash: hashA, seqno: 9 })
    expect(lookupKeyWithDifferentSeqno).toBe(savedKey)

    const all = await loadAllTonSettlements()
    expect(all[savedKey]).toBeTruthy()
    // Kayittaki seqno hala 1 - lookup'ta kullanilan 9 kayda hic karismadi.
    expect(all[savedKey].seqno).toBe(1)
  })

  it('actionHash degisince BULUNMAZ', async () => {
    const store = fakeStore()
    _setTonSettlementStore(store)
    const rec = { tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }
    await saveTonSettlement(rec)

    const otherKey = tonSettlementKey({ tonWallet: walletA, actionHash: hashB })
    const all = await loadAllTonSettlements()
    expect(all[otherKey]).toBeUndefined()
    expect(Object.keys(all)).toHaveLength(1)
  })

  it('farkli tonWallet farkli anahtar', async () => {
    const store = fakeStore()
    _setTonSettlementStore(store)
    await saveTonSettlement({ tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' })
    await saveTonSettlement({ tonWallet: walletB, actionHash: hashA, seqno: 1, phase: 'relay-inflight' })

    const keyA = tonSettlementKey({ tonWallet: walletA, actionHash: hashA })
    const keyB = tonSettlementKey({ tonWallet: walletB, actionHash: hashA })
    expect(keyA).not.toBe(keyB)

    const all = await loadAllTonSettlements()
    expect(Object.keys(all)).toHaveLength(2)
    expect(all[keyA].tonWallet).toBe(walletA)
    expect(all[keyB].tonWallet).toBe(walletB)
  })
})

describe('depo yokken cokmez', () => {
  // vitest node ortaminda `chrome` YOK. Firlatirsa ucret akisi test edilemez hale gelir
  // ve daha kotusu, eklenti disi bir baglamda (or. bir script'ten import edilirse) akis
  // patlar - bu yuzden yalniz "atmadi" degil, DONEN DEGERIN KENDISI de dogrulanir.
  //
  // Review bulgusu 4: saveTonSettlement `false` DONMELIYDI ki cagiran taraf (tonFeeRelayer)
  // "diske GERCEKTEN yazildi mi" sorusuna cevap alabilsin - yazma sessizce atlanip cagiran
  // yine de ilerlerse, ucret alinir ve KANIT hic diske inmemis olur.
  it('saveTonSettlement chrome yokken FIRLATMAZ, false doner ve depoyu degistirmez', async () => {
    _setTonSettlementStore(null)
    await expect(
      saveTonSettlement({ tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }),
    ).resolves.toBe(false)
    await expect(loadAllTonSettlements()).resolves.toEqual({})
  })

  it('loadAllTonSettlements chrome yokken FIRLATMAZ, bos harita doner', async () => {
    _setTonSettlementStore(null)
    await expect(loadAllTonSettlements()).resolves.toEqual({})
  })

  it('clearTonSettlement chrome yokken FIRLATMAZ, false doner', async () => {
    _setTonSettlementStore(null)
    await expect(clearTonSettlement(`${walletA}:${hashA}`)).resolves.toBe(false)
  })
})

describe('saveTonSettlement - yazmanin GERCEKTEN basarili olup olmadigi (review bulgusu 4)', () => {
  it('basarili yazimda true doner', async () => {
    _setTonSettlementStore(fakeStore())
    await expect(
      saveTonSettlement({ tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }),
    ).resolves.toBe(true)
  })

  it('depo set() sirasinda firlatirsa (orn. kota asimi) false doner, atilmaz', async () => {
    const throwingStore = {
      async get() { return {} },
      async set() { throw new Error('QuotaExceededError') },
    }
    _setTonSettlementStore(throwingStore)

    await expect(
      saveTonSettlement({ tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }),
    ).resolves.toBe(false)
  })
})

describe('hasUnsettledTonFee', () => {
  const NOW = 1_800_000_000 // unix saniye, feeAuth.deadline ile ayni birim

  it('deadline gecmemis relay-inflight kayit KILITLER', () => {
    const settlements = { k1: { phase: 'relay-inflight', deadline: NOW + 60 } }
    expect(hasUnsettledTonFee(settlements, NOW)).toBe(true)
  })

  it('deadline gecmis kayit KILITLEMEZ', () => {
    const settlements = { k1: { phase: 'relay-inflight', deadline: NOW - 60 } }
    expect(hasUnsettledTonFee(settlements, NOW)).toBe(false)
  })

  it('collected kayit KILITLER', () => {
    const settlements = { k1: { phase: 'collected', deadline: NOW + 60 } }
    expect(hasUnsettledTonFee(settlements, NOW)).toBe(true)
  })

  it('unresolved kayit KILITLEMEZ', () => {
    // unresolved govde zaten olu sayilir (design bolum 6); deadline HENUZ gecmemis olsa
    // bile kilit acik kalmali - aksi halde dogrulanamayan bir hayalet islem yuzunden
    // kullanici kalici kilitlenirdi.
    const settlements = { k1: { phase: 'unresolved', deadline: NOW + 60 } }
    expect(hasUnsettledTonFee(settlements, NOW)).toBe(false)
  })

  it('bos/bozuk girdide false', () => {
    expect(hasUnsettledTonFee({}, NOW)).toBe(false)
    expect(hasUnsettledTonFee(null, NOW)).toBe(false)
    expect(hasUnsettledTonFee(undefined, NOW)).toBe(false)
    expect(hasUnsettledTonFee({
      broken1: null,
      broken2: 'not-an-object',
      broken3: { phase: 'relay-inflight' }, // deadline yok
      broken4: { phase: 'relay-inflight', deadline: 'yesterday' },
    }, NOW)).toBe(false)
  })
})

describe('depo ayrimi', () => {
  // Ortak depo, EVM'in budama mantigindaki bir hatayi TON kayitlarina bulastirirdi
  // (ya da tersi) - iki anahtar dosya metninde birbirinden ayri dogrulanir.
  it('kaynak metinde ton_pending_settlements var, ats_pending_settlements YOK', () => {
    const src = read('./tonFeeSettlement.js')
    expect(src).toContain('ton_pending_settlements')
    expect(src).not.toContain('ats_pending_settlements')
  })
})

describe('TTL budama', () => {
  const NOW_MS = 1_800_000_000_000

  it('savedAt eski kayitlar dusurulur', () => {
    const map = {
      fresh: { savedAt: NOW_MS - 1000 },
      stale: { savedAt: NOW_MS - (25 * 60 * 60 * 1000) }, // 25 saat once, TTL 24 saat
    }
    const pruned = pruneTonSettlements(map, NOW_MS)
    expect(Object.keys(pruned)).toEqual(['fresh'])
  })

  it('savedAt bozuksa kayit dusurulur', () => {
    const map = {
      noField: {},
      notANumber: { savedAt: 'az-once' },
      nanValue: { savedAt: NaN },
    }
    const pruned = pruneTonSettlements(map, NOW_MS)
    expect(Object.keys(pruned)).toHaveLength(0)
  })
})

describe('updateTonSettlement', () => {
  it('var olan kaydi yamalayip digerlerine dokunmaz', async () => {
    const store = fakeStore()
    _setTonSettlementStore(store)
    const recA = { tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }
    const recB = { tonWallet: walletB, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }
    await saveTonSettlement(recA)
    await saveTonSettlement(recB)

    const keyA = tonSettlementKey(recA)
    const keyB = tonSettlementKey(recB)
    await updateTonSettlement(keyA, { phase: 'collected', settlementId: 'S-1', receipt: { ok: true } })

    const all = await loadAllTonSettlements()
    expect(all[keyA].phase).toBe('collected')
    expect(all[keyA].settlementId).toBe('S-1')
    expect(all[keyA].receipt).toEqual({ ok: true })
    // Yamalanmayan alan dokunulmamis kalmali.
    expect(all[keyA].seqno).toBe(1)
    // Diger kayit HIC etkilenmemeli.
    expect(all[keyB]).toEqual(expect.objectContaining({ phase: 'relay-inflight', seqno: 1, tonWallet: walletB }))
  })

  it('olmayan anahtarda sessizce gecer', async () => {
    const store = fakeStore()
    _setTonSettlementStore(store)
    const rec = { tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }
    await saveTonSettlement(rec)

    await expect(
      updateTonSettlement(`${walletB}:doesnotexist`, { phase: 'collected' }),
    ).resolves.toBe(false)

    const all = await loadAllTonSettlements()
    expect(Object.keys(all)).toHaveLength(1)
    expect(all[tonSettlementKey(rec)].phase).toBe('relay-inflight')
  })
})

// GOREV 10 YUKUMLULUK 3: `clearTonSettlement`/`updateTonSettlement` de
// `saveTonSettlement` gibi BOOLEAN doner. Gerekcesi tekrar edilmeye deger:
// "sildim" ile "silindi" AYNI SEY DEGIL. Depo yoksa ya da `set()` firlarsa
// (chrome.storage.local kota asimi, IO hatasi) eski davranis hatayi SESSIZCE
// yutuyordu; cagiran taraf da "yazdim" varsayip devam ediyordu. Kurtarmadaki
// `patchDurably` bu yuzden okuma-geri-dogrulamasi yapmak ZORUNDA kalmisti.
//
// Her iki yonu de olculur (eslenmis iddia): basarili yazimda `true`, DUSEN
// yazimda `false`. Yalniz `false` tarafi sinansaydi, her zaman `false` donen
// (yani hicbir sey yapmayan) bir gerileme de yesil kalirdi.
describe('depo yazmalari BOOLEAN doner (gorev 10, yukumluluk 3)', () => {
  const throwingStore = () => ({
    async get(key) { return { [key]: undefined } },
    async set() { throw new Error('QuotaExceededError') },
  })

  it('clearTonSettlement: basarili silmede true, kayit GERCEKTEN gider', async () => {
    _setTonSettlementStore(fakeStore())
    const rec = { tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }
    await saveTonSettlement(rec)

    await expect(clearTonSettlement(tonSettlementKey(rec))).resolves.toBe(true)
    await expect(loadAllTonSettlements()).resolves.toEqual({})
  })

  it('clearTonSettlement: set() firlarsa false doner, ATILMAZ', async () => {
    _setTonSettlementStore(throwingStore())
    await expect(clearTonSettlement(`${walletA}:${hashA}`)).resolves.toBe(false)
  })

  it('updateTonSettlement: basarili yamada true, yama GERCEKTEN iner', async () => {
    _setTonSettlementStore(fakeStore())
    const rec = { tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight' }
    await saveTonSettlement(rec)
    const key = tonSettlementKey(rec)

    await expect(updateTonSettlement(key, { phase: 'collected' })).resolves.toBe(true)
    const all = await loadAllTonSettlements()
    expect(all[key].phase).toBe('collected')
  })

  it('updateTonSettlement: depo YOKKEN false doner', async () => {
    _setTonSettlementStore(null)
    await expect(updateTonSettlement(`${walletA}:${hashA}`, { phase: 'collected' })).resolves.toBe(false)
  })

  it('updateTonSettlement: set() firlarsa false doner, ATILMAZ', async () => {
    // Kayit VAR (get onu doner) ama yazma duser - "yamaladim" diyen ama diske
    // inmemis yol tam olarak budur.
    const rec = { tonWallet: walletA, actionHash: hashA, seqno: 1, phase: 'relay-inflight', savedAt: Date.now() }
    const key = tonSettlementKey(rec)
    _setTonSettlementStore({
      async get(k) { return { [k]: { [key]: rec } } },
      async set() { throw new Error('QuotaExceededError') },
    })

    await expect(updateTonSettlement(key, { phase: 'collected' })).resolves.toBe(false)
  })
})
