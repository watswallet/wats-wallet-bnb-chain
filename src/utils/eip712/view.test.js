import { describe, it, expect } from 'vitest'
import { buildTypedDataView, DEFAULT_VIEW_LIMITS } from './view.js'

const OWNER = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
const SPENDER = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const TOKEN = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
const MAX256 = (2n ** 256n - 1n).toString()

const DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]

// parse.js'in normallestirilmis bicimi: Ether Mail (Ek B).
const mail = () => ({
  domain: { name: 'Ether Mail', version: '1', chainId: '1', verifyingContract: TOKEN },
  types: {
    EIP712Domain: DOMAIN_FIELDS,
    Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
    Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
  },
  primaryType: 'Mail',
  message: {
    from: { name: 'Cow', wallet: OWNER },
    to: { name: 'Bob', wallet: SPENDER },
    contents: 'Hello, Bob!',
  },
})

// Tek yaprak alanli basit tur: satir sayisi / kisaltma testleri icin.
const simple = (type, value, extraTypes = {}) => ({
  domain: { name: 'x', chainId: '1' },
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }],
    Thing: [{ name: 'v', type: type }],
    ...extraTypes,
  },
  primaryType: 'Thing',
  message: { v: value },
})

const row = (view, path) => view.rows.find((r) => r.path === path)

describe('buildTypedDataView: Ether Mail', () => {
  it('domain satirlari once, sonra mesaj satirlari sema sirasinda (duz liste)', () => {
    const v = buildTypedDataView(mail())
    expect(v.rows.map((r) => r.path)).toEqual([
      'domain.name', 'domain.version', 'domain.chainId', 'domain.verifyingContract',
      'message.from', 'message.from.name', 'message.from.wallet',
      'message.to', 'message.to.name', 'message.to.wallet',
      'message.contents',
    ])
    expect(v.rows.slice(0, 4).every((r) => r.section === 'domain')).toBe(true)
    expect(v.rows.slice(4).every((r) => r.section === 'message')).toBe(true)
  })

  it('derinlik, tur ve grup/deger ayrimi', () => {
    const v = buildTypedDataView(mail())
    expect(row(v, 'message.from')).toMatchObject({ kind: 'group', depth: 0, type: 'Person', display: 'Person', label: 'from' })
    expect(row(v, 'message.from.name')).toMatchObject({ kind: 'value', depth: 1, type: 'string', display: 'Cow', label: 'name' })
    expect(row(v, 'message.contents')).toMatchObject({ kind: 'value', depth: 0, display: 'Hello, Bob!' })
    expect(row(v, 'domain.name').depth).toBe(0)
  })

  it('adresler KISALTILMADAN ve EIP-55 sagitmali', () => {
    const v = buildTypedDataView(mail())
    expect(row(v, 'message.to.wallet').display).toBe(SPENDER)
    expect(row(v, 'domain.verifyingContract').display).toBe(TOKEN)
    expect(row(v, 'message.to.wallet').display).toHaveLength(42)
  })

  it('temiz yukte uyari yok, kisaltma yok; chainId bildirilmis', () => {
    const v = buildTypedDataView(mail())
    expect(v.warnings).toEqual([])
    expect(v.truncated).toBe(false)
    expect(v.overLimit).toBe(false)
    expect(v.rows.every((r) => r.hiddenByDefault === false)).toBe(true)
  })
})

describe('buildTypedDataView: deger bicimleri', () => {
  it('buyuk tamsayilar BigInt ile tam (Number/ustel YOK)', () => {
    const v = buildTypedDataView(simple('uint256', MAX256))
    expect(row(v, 'message.v').display).toBe(MAX256)
    const neg = buildTypedDataView(simple('int256', '-170141183460469231731687303715884105728'))
    expect(row(neg, 'message.v').display).toBe('-170141183460469231731687303715884105728')
  })

  it('bool, bytes ve bytes32 oldugu gibi', () => {
    expect(row(buildTypedDataView(simple('bool', false)), 'message.v').display).toBe('false')
    expect(row(buildTypedDataView(simple('bytes', '0xdead')), 'message.v').display).toBe('0xdead')
    const b32 = '0x' + 'ab'.repeat(32)
    expect(row(buildTypedDataView(simple('bytes32', b32)), 'message.v').display).toBe(b32)
  })

  it('diziler: grup satiri [n] ve elemanlar [i] etiketiyle', () => {
    const v = buildTypedDataView(simple('uint8[]', ['1', '2']))
    expect(row(v, 'message.v')).toMatchObject({ kind: 'group', display: '[2]', type: 'uint8[]' })
    expect(row(v, 'message.v[0]')).toMatchObject({ kind: 'value', label: '[0]', display: '1', depth: 1, type: 'uint8' })
    expect(row(v, 'message.v[1]').display).toBe('2')
  })

  it('bos dizi tek grup satiri uretir', () => {
    const v = buildTypedDataView(simple('uint8[]', []))
    expect(row(v, 'message.v')).toMatchObject({ kind: 'group', display: '[0]' })
    expect(v.rows.filter((r) => r.section === 'message')).toHaveLength(1)
  })

  it('yapi dizisi: her eleman grup + alanlari', () => {
    const t = simple('Item[]', [{ a: '1' }, { a: '2' }], { Item: [{ name: 'a', type: 'uint256' }] })
    const v = buildTypedDataView(t)
    expect(row(v, 'message.v[0]')).toMatchObject({ kind: 'group', display: 'Item' })
    expect(row(v, 'message.v[1].a').display).toBe('2')
  })
})

describe('buildTypedDataView: gizli/benzer karakter', () => {
  it('sifir genislikli karakter etiketlenir, hiddenChars ve uyari verir', () => {
    const t = simple('string', 'Log\u200bin')
    const v = buildTypedDataView(t)
    expect(row(v, 'message.v').display).toBe('Log[U+200B]in')
    expect(row(v, 'message.v').hiddenChars).toBe(true)
    expect(v.warnings).toContainEqual({ code: 'hidden_chars' })
  })

  it('Kiril benzer harf yaninda isaretlenir', () => {
    const v = buildTypedDataView(simple('string', 'p\u0430ypal'))
    expect(row(v, 'message.v').display).toBe('p\u0430[U+0430]ypal')
    expect(row(v, 'message.v').hiddenChars).toBe(true)
  })

  it('domain.name da ayni isleme girer', () => {
    const t = mail()
    t.domain.name = 'Ev\u202eil'
    const v = buildTypedDataView(t)
    expect(row(v, 'domain.name').display).toContain('[U+202E]')
    expect(v.warnings).toContainEqual({ code: 'hidden_chars' })
  })

  it('duz metinde hiddenChars yok', () => {
    expect(row(buildTypedDataView(simple('string', 'plain text')), 'message.v').hiddenChars).toBe(false)
  })

  it('satir sonlari daraltilir: tek satir, satir sayisi artmaz', () => {
    const v = buildTypedDataView(simple('string', 'line1\nline2\r\nline3'))
    expect(row(v, 'message.v').display).toBe('line1 \u23ce line2 \u23ce line3')
    expect(row(v, 'message.v').display).not.toMatch(/[\r\n]/)
    expect(row(v, 'message.v').hiddenChars).toBe(false)
  })

  it('metin HTML olarak yorumlanmaz: etiketler oldugu gibi (cagiran v-html kullanmaz)', () => {
    expect(row(buildTypedDataView(simple('string', '<img src=x onerror=alert(1)>')), 'message.v').display).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('buildTypedDataView: kisaltma, onizleme ve tavan (GIZLEME YOK)', () => {
  it('varsayilan sinirlar', () => {
    expect(DEFAULT_VIEW_LIMITS).toEqual({ maxRows: 500, previewRows: 100, maxStringChars: 200 })
  })

  it('uzun dize kisaltilir, tam metin full`da korunur, truncated true', () => {
    const long = 'a'.repeat(500)
    const v = buildTypedDataView(simple('string', long))
    const r = row(v, 'message.v')
    expect(r.truncated).toBe(true)
    expect(r.display).toHaveLength(201)
    expect(r.display.endsWith('\u2026')).toBe(true)
    expect(r.full).toBe(long)
    expect(v.truncated).toBe(true)
  })

  it('tam sinirdaki dize kisaltilmaz', () => {
    const exact = 'b'.repeat(200)
    const r = row(buildTypedDataView(simple('string', exact)), 'message.v')
    expect(r.truncated).toBe(false)
    expect(r.display).toBe(exact)
  })

  it('kisaltma vekil ciftini ortadan bolmez (emoji)', () => {
    const emoji = '\u{1F600}'.repeat(300)
    const r = row(buildTypedDataView(simple('string', emoji)), 'message.v')
    expect(r.display).toBe('\u{1F600}'.repeat(200) + '\u2026')
  })

  it('uzun hex (bytes) kisaltilir; adres ASLA kisaltilmaz', () => {
    const hex = '0x' + 'cd'.repeat(300)
    expect(row(buildTypedDataView(simple('bytes', hex)), 'message.v').truncated).toBe(true)
    const t = simple('address', SPENDER)
    expect(row(buildTypedDataView(t, { maxStringChars: 5 }), 'message.v')).toMatchObject({ truncated: false, display: SPENDER })
  })

  it('onizleme siniri: sonraki satirlar hiddenByDefault, truncated true, overLimit false', () => {
    const values = Array.from({ length: 150 }, (_, i) => String(i))
    const v = buildTypedDataView(simple('uint16[]', values))
    expect(v.overLimit).toBe(false)
    expect(v.truncated).toBe(true)
    const hidden = v.rows.filter((r) => r.hiddenByDefault)
    expect(hidden.length).toBe(v.rows.length - DEFAULT_VIEW_LIMITS.previewRows)
    expect(v.rows[DEFAULT_VIEW_LIMITS.previewRows - 1].hiddenByDefault).toBe(false)
    expect(v.rows[DEFAULT_VIEW_LIMITS.previewRows].hiddenByDefault).toBe(true)
  })

  it('satir tavani asilirsa overLimit true ve satirlar tavanda durur', () => {
    const values = Array.from({ length: 600 }, (_, i) => String(i))
    const v = buildTypedDataView(simple('uint16[]', values))
    expect(v.overLimit).toBe(true)
    expect(v.rows).toHaveLength(500)
    expect(v.truncated).toBe(true)
  })

  it('tam tavandaki satir sayisi overLimit DEGILDIR', () => {
    // domain 2 satir + grup 1 satir + 497 eleman = 500
    const values = Array.from({ length: 497 }, (_, i) => String(i))
    const v = buildTypedDataView(simple('uint16[]', values))
    expect(v.rows).toHaveLength(500)
    expect(v.overLimit).toBe(false)
  })

  it('limits parametresi varsayilanlari ezer', () => {
    const v = buildTypedDataView(simple('string', 'abcdef'), { maxStringChars: 3 })
    expect(row(v, 'message.v').display).toBe('abc\u2026')
    const w = buildTypedDataView(simple('uint8[]', ['1', '2', '3', '4']), { maxRows: 4 })
    expect(w.overLimit).toBe(true)
    expect(w.rows).toHaveLength(4)
    const x = buildTypedDataView(simple('uint8[]', ['1', '2', '3']), { previewRows: 2 })
    expect(x.rows.filter((r) => r.hiddenByDefault).length).toBe(x.rows.length - 2)
  })

  it('cok derin ic ice yapi sonsuza gitmez: overLimit', () => {
    const types = { EIP712Domain: [{ name: 'name', type: 'string' }], N: [{ name: 'next', type: 'N' }] }
    let value = {}
    for (let i = 0; i < 60; i++) value = { next: value }
    const v = buildTypedDataView({ domain: { name: 'x' }, types, primaryType: 'N', message: value })
    expect(v.overLimit).toBe(true)
  })
})

describe('buildTypedDataView: uyarilar', () => {
  it('semada olmayan mesaj/domain alanlari unsigned_fields uyarisi (yollarla)', () => {
    const t = mail()
    t.message.stray = 'x'
    t.message.from.note = 'y'
    t.domain.salt = '0x00'
    const v = buildTypedDataView(t)
    const w = v.warnings.find((x) => x.code === 'unsigned_fields')
    expect(w.paths).toEqual(['domain.salt', 'message.stray', 'message.from.note'])
    expect(w.count).toBe(3)
    expect(v.rows.map((r) => r.path)).not.toContain('message.stray')
  })

  it('bildirilmemis ama domain`de duran chainId "imzalanmayan alan" olarak anilir, chain_missing de eklenir', () => {
    const t = mail()
    t.types.EIP712Domain = [{ name: 'name', type: 'string' }]
    t.domain = { name: 'x', chainId: 999 }
    const v = buildTypedDataView(t)
    expect(v.warnings.find((x) => x.code === 'unsigned_fields').paths).toEqual(['domain.chainId'])
    expect(v.warnings).toContainEqual({ code: 'chain_missing' })
  })

  it('EIP712Domain chainId bildiriyorsa chain_missing yok', () => {
    expect(buildTypedDataView(mail()).warnings.some((w) => w.code === 'chain_missing')).toBe(false)
  })

  it('unsigned yol listesi 20 ile sinirli, count gercek sayiyi verir', () => {
    const t = mail()
    for (let i = 0; i < 30; i++) t.message[`extra${i}`] = i
    const w = buildTypedDataView(t).warnings.find((x) => x.code === 'unsigned_fields')
    expect(w.paths).toHaveLength(20)
    expect(w.count).toBe(30)
  })

  it('ozel EIP712Domain alani genel olarak cizilir (ad, tur, deger)', () => {
    const t = mail()
    t.types.EIP712Domain = [...DOMAIN_FIELDS, { name: 'foo', type: 'uint256' }]
    t.domain.foo = '7'
    const v = buildTypedDataView(t)
    expect(row(v, 'domain.foo')).toMatchObject({ section: 'domain', type: 'uint256', display: '7', label: 'foo' })
  })
})

describe('buildTypedDataView: bozuk girdide firlatmaz', () => {
  it('eksik/bozuk yapilar', () => {
    for (const bad of [undefined, null, {}, { types: {}, primaryType: 'X', message: {} }]) {
      expect(() => buildTypedDataView(bad)).not.toThrow()
    }
    const v = buildTypedDataView({ domain: {}, types: { EIP712Domain: [] }, primaryType: 'X', message: {} })
    expect(v.rows).toEqual([])
  })

  it('dizi alani dizi degilse / yapi alani nesne degilse / bilinmeyen tur: [invalid] satiri', () => {
    expect(row(buildTypedDataView(simple('uint8[]', 'nope')), 'message.v').display).toBe('[invalid]')
    expect(row(buildTypedDataView(simple('Item', 5, { Item: [{ name: 'a', type: 'uint8' }] })), 'message.v').display).toBe('[invalid]')
    expect(row(buildTypedDataView(simple('Ghost', 5)), 'message.v').display).toBe('[invalid]')
  })

  it('bozuk tamsayi degeri satir uretir, firlatmaz', () => {
    expect(row(buildTypedDataView(simple('uint256', 'zzz')), 'message.v').display).toBe('zzz')
  })
})
