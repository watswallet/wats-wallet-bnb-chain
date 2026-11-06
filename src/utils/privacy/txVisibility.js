// Islem kartlari aktif TARAFA gore suzulur (spec 7.3): gizli modda yalniz Gizli
// Hesap'in kayitlari, normal modda yalniz digerleri. accountKey'siz eski kayitlar
// gizli moddan once yazilmistir -> yalniz normal modda gorunur.
export function isTxVisible(tx, { privateActive, privateAccountKey }) {
    if (tx?.accountKey) {
        const isPrivateTx = !!privateAccountKey && tx.accountKey === privateAccountKey
        return privateActive ? isPrivateTx : !isPrivateTx
    }
    return !privateActive
}
