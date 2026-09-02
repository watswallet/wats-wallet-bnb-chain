// Solana sabitleri — saf, bagimsiz.
//
// chainId METINDIR: EVM kimlikleri sayidir ve ayni uzayda cakisamamalari icin
// bilerek sayiya CEVRILEMEZ bir deger secildi.
export const SOLANA_CHAIN_ID = 'solana-mainnet'

export const LAMPORTS_PER_SOL = 1_000_000_000

export const SOL_DECIMALS = 9

// SPL token programi. ATA programinin kimligi @solana/spl-token icinde zaten
// var (getAssociatedTokenAddressSync onu kendi kullanir); burada tekrarlamak
// iki kaynak yaratir ve biri guncellenirse sessizce ayrisirlar.
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

// Native SOL'un varlik kaydindaki adresi. EVM tarafinda native varlik '0x0' /
// ZeroAddress ile temsil ediliyor; Solana'da boyle bir sozlesme adresi YOK,
// bu yuzden acik bir isaretci kullanilir.
export const SOL_NATIVE_MARKER = 'native'

export const SOLANA_EXPLORER = 'https://solscan.io'
