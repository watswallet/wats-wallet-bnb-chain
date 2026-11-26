// Solana islem onay ekrani anahtarlari (Gorev 6, D2): 12 dilde TAM ve dolu.
//
// Anahtar listesi brief'ten (Interfaces) ve Gorev 4-5 KODUNDAN (txPreview.js,
// decodeInstructions.js) birlestirilmistir. Kod ile brief ayni sey icin farkli ad
// kullaniyorsa KODDAKI ad gecerlidir; ikisi de burada listelenir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { REDFLAG_UI_TYPES } from '../../utils/solana/decodeInstructions'
import { buildTxPreview } from '../../utils/solana/txPreview'

const here = dirname(fileURLToPath(import.meta.url))
const DILLER = ['en', 'tr', 'de', 'es', 'fr', 'id', 'ja', 'ko', 'pt-BR', 'ru', 'vi', 'zh-CN']
const read = (kod) => JSON.parse(readFileSync(join(here, `${kod}.json`), 'utf8'))
const locales = Object.fromEntries(DILLER.map((k) => [k, read(k).dapps.solana]))

const OZET = [
    'balanceChangeTitle', 'balanceChangeStatic', 'balanceSimulating', 'balanceUnavailable',
    'balanceNoChange', 'balanceNoPermissionNote', 'balanceEstimateNote', 'simFailedWarning',
    'simSeparateNote', 'balanceScopeNote', 'balanceTokensUnreadable', 'balanceOutgoingTotal',
    'balanceIncomingTotal', 'simIndependentNote', 'blindAck', 'unverifiedToken', 'youLabel', 'notYourAccount',
]
// Brief listesi + koddaki adlar: initializeAccount (InitializeAccount satiri, Gorev 5),
// other (kind:'other' + titleKey:null satirlari icin genel baslik).
const IX = [
    'systemTransfer', 'transferWithSeed', 'createAccount', 'assign', 'withdrawNonce', 'tokenTransfer',
    'approve', 'approveUnlimited', 'revoke', 'setAuthority', 'closeAccount', 'mintTo', 'burn',
    'walletPrep', 'ataCreate', 'ataForOther', 'memo', 'unknownProgram', 'unknownGroup',
    'initializeAccount', 'other',
]
// fundTransfer: CreateAccount'un kira tabanini asan tutari (Gorev 5 duzeltmesi).
const F = [
    'to', 'from', 'amount', 'mint', 'owner', 'spender', 'newAuthority',
    'authorityType_0', 'authorityType_1', 'authorityType_2', 'authorityType_3',
    'rentTo', 'rent', 'space', 'program', 'memoText', 'unlimited', 'fundTransfer',
    // S9-G9-S2: CloseAccount'ta hedefe giden SOL tutari (native: tum bakiye; degilse kira; okunamadi).
    'closeSolAll', 'closeSolRent', 'closeSolUnknown',
]
const REDFLAG_BRIEF = [
    'Assign', 'AssignWithSeed', 'Allocate', 'AllocateWithSeed', 'AuthorizeNonceAccount', 'CloseAccount',
]
const UCRET = [
    'totalFeeLabel', 'feePaidBy', 'feePayerOther', 'feeAtLeast', 'feeDetails', 'feeCuLimit',
    'feeCuPrice', 'feeMaxLabel', 'priorityFeeHighWarning',
]
const EK = [
    'unknownProgramWarning', 'durableNonceWarning', 'memoUntrusted', 'token2022Note',
    'moreAddresses', 'tokenUnresolved', 'fieldUnresolved',
    // koddaki satir bayraklari icin gosterim metni (memoTruncated, removesAuthority)
    'memoTruncated', 'authorityRemoved',
    // final dalgasi (metin alani): neden-yansiz uyari, oncelik ucreti onayi, sinirli Approve
    'unreadablePartsWarning', 'priorityFeeAck', 'redFlag_ApproveLimited',
]
// Mevcut anahtarlar KORUNUR.
const KORUNAN = [
    'undecodable', 'noInstructions', 'resolving', 'baseFeeLabel', 'rentLabel', 'insufficientSol',
    'lookupUnresolved', 'priorityFeeLabel',
    'redFlag_Approve', 'redFlag_ApproveChecked', 'redFlag_SetAuthority',
]

const YOL = [
    ...OZET,
    ...IX.map((k) => `ix.${k}`),
    ...F.map((k) => `f.${k}`),
    ...REDFLAG_BRIEF.map((k) => `redFlag_${k}`),
    ...UCRET,
    ...EK,
]

const al = (obj, yol) => yol.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj)

function yapraklar(obj, onek = '') {
    return Object.entries(obj).flatMap(([k, v]) => (
        v !== null && typeof v === 'object' ? yapraklar(v, `${onek}${k}.`) : [[`${onek}${k}`, v]]
    ))
}

describe('Solana islem onay anahtarlari 12 dilde', () => {
    it('her dil dosyasi okunur ve dapps.solana vardir', () => {
        for (const kod of DILLER) expect(locales[kod], kod).toBeTypeOf('object')
    })

    it.each(DILLER)('%s: brief + kod anahtarlarinin HEPSI var ve bos degil', (kod) => {
        const eksik = []
        for (const yol of [...YOL, ...KORUNAN]) {
            const v = al(locales[kod], yol)
            if (typeof v !== 'string' || v.trim() === '') eksik.push(yol)
        }
        expect(eksik).toEqual([])
    })

    it.each(DILLER)('%s: yeni anahtarlarin yer tutucusu yalniz unknownGroup ve moreAddresses icinde {n}', (kod) => {
        const sorunlar = []
        for (const yol of YOL) {
            const v = al(locales[kod], yol)
            if (typeof v !== 'string') continue
            const yerTutucular = [...v.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
            const beklenen = (yol === 'ix.unknownGroup' || yol === 'moreAddresses') ? ['n'] : []
            if (yerTutucular.join(',') !== beklenen.join(',')) sorunlar.push(`${yol}: {${yerTutucular.join(',')}}`)
        }
        expect(sorunlar).toEqual([])
    })

    it.each(DILLER)('%s: hicbir dapps.solana dizesinde adres/alici/harcayan yer tutucusu yok (Constraint 17)', (kod) => {
        const sorunlar = yapraklar(locales[kod])
            .filter(([, v]) => /\{(to|address|spender|owner|from|mint|program|authority|newAuthority)\}/.test(v))
            .map(([k]) => k)
        expect(sorunlar).toEqual([])
    })

    it('riskOf true donebilecegi HER tip icin dapps.solana.redFlag_<type> var (en ve tr dahil 12 dil)', () => {
        expect(REDFLAG_UI_TYPES.length).toBeGreaterThan(0)
        // Assign ve AssignWithSeed kume disi ama bayrak alabilir: acikca kilitli.
        expect(REDFLAG_UI_TYPES).toEqual(expect.arrayContaining(['Assign', 'AssignWithSeed']))
        const eksik = []
        for (const kod of DILLER) {
            for (const tip of REDFLAG_UI_TYPES) {
                const v = locales[kod][`redFlag_${tip}`]
                if (typeof v !== 'string' || v.trim() === '') eksik.push(`${kod}: redFlag_${tip}`)
            }
        }
        expect(eksik).toEqual([])
    })

    it('redFlag_CloseAccount yeniden yazildi: kalan kirayi baska adrese gonderir (eski "sweeps" metni yok)', () => {
        expect(locales.en.redFlag_CloseAccount).not.toMatch(/sweeps/i)
        expect(locales.en.redFlag_CloseAccount).toMatch(/rent/i)
        expect(locales.tr.redFlag_CloseAccount).toMatch(/kira/i)
    })

    it('txPreview satirlari ekranda ham anahtar gostermeyecek: kodun urettigi her labelKey/titleKey her dilde var', () => {
        const ME = '11111111111111111111111111111112'
        const OTHER = '22222222222222222222222222222223'
        const tokAcc = '33333333333333333333333333333334'
        const decoded = [
            { index: 0, programId: '11111111111111111111111111111111', program: 'system', type: 'CreateAccount', redFlag: false, accounts: [ME, OTHER], fields: { lamports: '99999999999', space: '165', owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' } },
            { index: 1, programId: '11111111111111111111111111111111', program: 'system', type: 'Allocate', redFlag: true, accounts: [OTHER], fields: {} },
            { index: 2, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', program: 'token', type: 'SetAuthority', redFlag: true, accounts: [tokAcc, ME], fields: { authorityType: 2, newAuthority: OTHER, removesAuthority: false } },
            { index: 3, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', program: 'token', type: 'InitializeAccount', redFlag: false, accounts: [tokAcc, 'So11111111111111111111111111111111111111112', OTHER], fields: { mint: 'So11111111111111111111111111111111111111112', owner: OTHER } },
            { index: 4, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', program: 'token', type: 'FreezeAccount', redFlag: false, accounts: [tokAcc], fields: {} },
        ]
        const { rows } = buildTxPreview({ decoded, user: ME })
        const anahtarlar = new Set()
        for (const r of rows) {
            if (r.titleKey) anahtarlar.add(r.titleKey)
            for (const f of r.fields) anahtarlar.add(f.labelKey)
        }
        expect(anahtarlar.size).toBeGreaterThan(0)
        const eksik = []
        for (const kod of DILLER) {
            for (const a of anahtarlar) {
                const v = al({ dapps: { solana: locales[kod] } }, a)
                if (typeof v !== 'string' || v.trim() === '') eksik.push(`${kod}: ${a}`)
            }
        }
        expect(eksik).toEqual([])
        // kind:'other' + titleKey:null satirlari icin genel anahtar mevcut
        expect(rows.some((r) => r.kind === 'other' && r.titleKey === null)).toBe(true)
        for (const kod of DILLER) expect(locales[kod].ix.other, kod).toBeTypeOf('string')
    })
})

// S9-G9-S2: CloseAccount hedefe hesaptaki SOL'un TAMAMINI yollar (wSOL'de sarili bakiye dahil).
// Eski metin 12 dilde "yalniz kalan kira" diyordu; o izlenim geri gelmemeli.
describe('CloseAccount metni "yalniz kira" izlenimi vermez (S9-G9-S2)', () => {
    const ESKI_METIN = {
        en: 'Sends the remaining rent of this account to another address.',
        tr: 'Hesabın kalan kirasını başka bir adrese gönderir.',
        de: 'Sendet die verbleibende Miete dieses Kontos an eine andere Adresse.',
        es: 'Envía el alquiler restante de esta cuenta a otra dirección.',
        fr: 'Envoie le loyer restant de ce compte à une autre adresse.',
        id: 'Mengirim sisa sewa akun ini ke alamat lain.',
        ja: 'このアカウントに残っているレント(保証金)を別のアドレスに送ります。',
        ko: '이 계정에 남은 렌트(보증금)를 다른 주소로 보냅니다.',
        'pt-BR': 'Envia o aluguel restante desta conta para outro endereço.',
        ru: 'Отправляет оставшуюся ренту этого аккаунта на другой адрес.',
        vi: 'Gửi khoản tiền thuê còn lại của tài khoản này đến một địa chỉ khác.',
        'zh-CN': '将此账户剩余的租金发送到另一个地址。',
    }

    it.each(DILLER)('%s: redFlag_CloseAccount eski yalniz-kira metni DEGIL ve SOL kelimesini tasir', (kod) => {
        const v = locales[kod].redFlag_CloseAccount
        expect(v).not.toBe(ESKI_METIN[kod])
        expect(v).toContain('SOL')
    })

    it('en: metin "tum SOL" + sarili (wrapped) bakiyeyi acikca soyler; rentTo etiketi "Rent goes to" DEGIL', () => {
        expect(locales.en.redFlag_CloseAccount).toContain('all the SOL')
        expect(locales.en.redFlag_CloseAccount).toContain('wrapped SOL')
        expect(locales.en.f.rentTo).not.toMatch(/^Rent/)
    })

    it.each(DILLER)('%s: closeSolAll/Rent/Unknown birbirinden farkli ve adres yer tutucusu yok', (kod) => {
        const f = locales[kod].f
        expect(new Set([f.closeSolAll, f.closeSolRent, f.closeSolUnknown]).size).toBe(3)
        for (const v of [f.closeSolAll, f.closeSolRent, f.closeSolUnknown]) expect(v).not.toMatch(/\{/)
    })
})

// FINAL DUZELTME DALGASI (metin alani): metinler nedene yansiz ve guvenlik anlamini korur.
describe('final metin duzeltmeleri (SU-8, E-e, SU-18, SU-19)', () => {
    it.each(DILLER)('%s: fieldUnresolved nedene yansiz ("adres arama tablosu" parantezi yok)', (kod) => {
        const v = locales[kod].fieldUnresolved
        expect(v).not.toMatch(/[(（)）]/)
        // ALT'ye ozgu kelime YALNIZ lookupUnresolved bandinda kalir.
        expect(v).not.toMatch(/lookup|arama tablosu|Adresstabelle|tabla de b[uú]squeda|table de recherche|tabel pencarian|テーブル|조회 테이블|tabela de consulta|таблица поиска|bảng tra cứu|查找表/i)
    })

    it.each(DILLER)('%s: yeni anahtarlar birbirinden ve mevcut ilgili anahtarlardan FARKLI (uc ayri anlam)', (kod) => {
        const l = locales[kod]
        expect(l.unreadablePartsWarning).not.toBe(l.unknownProgramWarning)
        expect(l.priorityFeeAck).not.toBe(l.blindAck)
        expect(l.priorityFeeAck).not.toBe(l.priorityFeeHighWarning)
        expect(l.redFlag_ApproveLimited).not.toBe(l.redFlag_Approve)
        expect(l.redFlag_ApproveLimited).not.toBe(l.redFlag_ApproveChecked)
    })

    it.each(DILLER)('%s: yeni anahtarlar tutar/adres gommez (yer tutucu yok)', (kod) => {
        for (const k of ['unreadablePartsWarning', 'priorityFeeAck', 'redFlag_ApproveLimited', 'fieldUnresolved']) {
            expect(locales[kod][k], `${kod}.${k}`).not.toMatch(/[{}]/)
        }
    })

    it('en: genel uyari "program" kelimesini ve "not recognized" ifadesini icermez; priorityFeeAck ucreti anar', () => {
        expect(locales.en.unreadablePartsWarning).not.toMatch(/program|recognized/i)
        expect(locales.en.priorityFeeAck).toMatch(/priority fee/i)
        expect(locales.en.redFlag_ApproveLimited).toMatch(/up to the amount shown/)
    })

    it('SU-18: tr/ja/ko sinirsiz Approve metni SURE degil MIKTAR sinirsizligini anlatir', () => {
        expect(locales.tr.redFlag_Approve).not.toMatch(/süresiz/)
        expect(locales.tr.redFlag_Approve).toMatch(/sınırsız/)
        expect(locales.ja.redFlag_Approve).not.toMatch(/無期限/)
        expect(locales.ko.redFlag_Approve).not.toMatch(/무기한/)
        expect(locales.tr.redFlag_ApproveChecked).toBe(locales.tr.redFlag_Approve)
        expect(locales.ja.redFlag_ApproveChecked).toBe(locales.ja.redFlag_Approve)
        expect(locales.ko.redFlag_ApproveChecked).toBe(locales.ko.redFlag_Approve)
    })

    it('SU-19: zh-CN durableNonceWarning "无限期" der ("长期" degil); en simIndependentNote "The site" ile baslar', () => {
        expect(locales['zh-CN'].durableNonceWarning).toContain('无限期')
        expect(locales['zh-CN'].durableNonceWarning).not.toContain('长期保持')
        expect(locales.en.simIndependentNote).toMatch(/^The site /)
    })
})
