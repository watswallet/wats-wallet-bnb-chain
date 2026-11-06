// Ozel anahtar ice aktarma ekraninin girdi siniflandirmasi.
//
// 'evm'          -> 32 bayt (64 hex): ice aktarilabilir EVM anahtari.
// 'tonSecretKey' -> 64 bayt (128 hex): TON anahtar ekraninin verdigi ed25519 gizli
//                   anahtari (tohum + acik anahtar). Ice AKTARILAMAZ -- ham TON
//                   anahtarini tasiyacak kasa tipi yok; ekran kullaniciyi TON
//                   kurtarma ifadesine yonlendirir.
// null           -> ikisi de degil.
//
// 64 hex'lik bir TON tohumu EVM anahtarindan AYIRT EDILEMEZ; o yuzden 'evm' sayilir.
// TON anahtar ekrani tohumu ayrica vermiyor, yani bu yoldan gelmez.
export function classifyPrivateKeyInput(input) {
    const key = String(input ?? '').trim()
    const hex = key.startsWith('0x') ? key.slice(2) : key
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null
    if (hex.length === 64) return 'evm'
    if (hex.length === 128) return 'tonSecretKey'
    return null
}
