// Ulke kodlari: ISO 3166-1 alpha-2 (249 atanmis kod) + XK (Kosova).
//
// XK ISO'da atanmamistir ama IP veritabanlari (DB-IP dahil) Kosova icin bu kodu doner ve
// kural tablolari ve ulke adi cozumleyici Kosova'yi tanimak zorundadir; bu yuzden listeye BILEREK dahildir.
//
// BUYUK harf, alfabetik sirali, tekrarsiz. Eski / ozel kodlar YOK: AN BU CQ CS DD DY FX HV NH RH
// SU TP UK VD YD YU ZR (silinmis), AC CP DG EA EU EZ IC QO TA UN XA XB ZZ (ozel / ayrilmis).
// Ozellikle UK YOKTUR: Birlesik Krallik GB'dir. Kural tablolari (server/data/eligibility.js,
// data/eligibilityRules.js) ve ulke adi cozumleyici (utils/stockGate/countryLabel.js) bu listeyle test zamaninda kontrol edilir.
//
// Liste Node 22.17 ICU'sundan turetilip yukaridaki kodlar cikarilarak OLCULDU (250 kod).
// Guncelleme: yeni bir ISO kodu cikarsa buraya alfabetik sirayla eklenir; ayni kod
// server/test/eligibilityData.test.js tarafindan kural tablosuna karsi okunur.
//
// Bu dosya SAF VERIDIR: hicbir import yok (data/xStocks.js ile ayni kural).

const RAW = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE
BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD
CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM
DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF
GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN
KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME
MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA
NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM
PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI
SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK
TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI
VN VU WF WS XK YE YT ZA ZM ZW
`

export const COUNTRY_CODES = Object.freeze(RAW.split(/\s+/).filter(Boolean))

export const COUNTRY_CODE_SET = new Set(COUNTRY_CODES)
