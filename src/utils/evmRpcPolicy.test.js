import { describe, it, expect } from 'vitest'
import {
    classifyRpcMethod,
    rpcMethodWeight,
    unsupportedMethodError,
    FORWARD_METHODS,
} from './evmRpcPolicy'

// Spec 6 G2: ~30 salt-okuma adi, TAM eslesme. Liste burada BILEREK ikinci kez yazildi:
// politika dosyasina sessizce yeni ad eklenirse bu test dusmeli (genisletme bilincli olsun).
const EXPECTED_FORWARD = [
    'eth_blockNumber',
    'eth_gasPrice',
    'eth_maxPriorityFeePerGas',
    'eth_feeHistory',
    'eth_blobBaseFee',
    'eth_getBalance',
    'eth_getCode',
    'eth_getStorageAt',
    'eth_getTransactionCount',
    'eth_getTransactionByHash',
    'eth_getTransactionReceipt',
    'eth_getBlockByNumber',
    'eth_getBlockByHash',
    'eth_getBlockReceipts',
    'eth_getBlockTransactionCountByNumber',
    'eth_getBlockTransactionCountByHash',
    'eth_getTransactionByBlockHashAndIndex',
    'eth_getTransactionByBlockNumberAndIndex',
    'eth_getUncleCountByBlockNumber',
    'eth_getUncleCountByBlockHash',
    'eth_call',
    'eth_estimateGas',
    'eth_createAccessList',
    'eth_getLogs',
    'eth_getProof',
    'eth_syncing',
    'eth_protocolVersion',
    'net_listening',
    'web3_clientVersion',
    'web3_sha3',
]

// Spec: YASAK (fetch HIC cagrilmaz) ve digerleri.
const FORBIDDEN_METHODS = [
    'eth_sign',
    'eth_signTransaction',
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'personal_sign',
    'personal_ecRecover',
    'personal_unlockAccount',
    'eth_signTypedData',
    'eth_signTypedData_v1',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4',
    'eth_accounts',
    'eth_coinbase',
    'eth_requestAccounts',
    'eth_chainId',
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
    'wallet_getPermissions',
    'wallet_requestPermissions',
    'wallet_revokePermissions',
    'wallet_watchAsset',
    'wallet_getCapabilities',
    'wallet_sendCalls',
    'eth_subscribe',
    'eth_unsubscribe',
    'eth_newFilter',
    'eth_newBlockFilter',
    'eth_newPendingTransactionFilter',
    'eth_getFilterChanges',
    'eth_getFilterLogs',
    'eth_uninstallFilter',
    'debug_traceTransaction',
    'trace_block',
    'txpool_content',
    'admin_peers',
    'engine_newPayloadV3',
    'miner_start',
    'anvil_setBalance',
    'hardhat_setBalance',
    'eth_mining',
    'eth_hashrate',
    'net_peerCount',
]

describe('classifyRpcMethod: izinli kume', () => {
    it('izinli adlar spec listesiyle BIREBIR ayni (30 ad, tekrar yok)', () => {
        expect([...FORWARD_METHODS].sort()).toEqual([...EXPECTED_FORWARD].sort())
        expect(new Set(FORWARD_METHODS).size).toBe(30)
    })

    it.each(EXPECTED_FORWARD)('%s -> forward', (name) => {
        expect(classifyRpcMethod(name)).toBe('forward')
    })

    // net_version T14b'de (default: dalinda, siniflandirmadan ONCE) yerelde cevaplanir (boss karari).
    // Bu modulde IKINCI gerceklemesi ve 'local' sinifi YOK: dagiticiya hic dusmez, dusse 'deny'.
    it('net_version bu modulde deny (yerel cevap T14b nindir, ikinci gerceklemesi yok)', () => {
        expect(classifyRpcMethod('net_version')).toBe('deny')
    })

    it('izinli kume hicbir yasak aileye girmez (savunma)', () => {
        const bad = /^(eth_sign|eth_send|personal_|wallet_|debug_|trace_|txpool_|admin_|engine_|miner_|anvil_|hardhat_|eth_subscribe|eth_unsubscribe|eth_.*Filter|eth_accounts|eth_coinbase|eth_requestAccounts|eth_chainId)/
        for (const name of FORWARD_METHODS) expect(name).not.toMatch(bad)
        for (const name of FORWARD_METHODS) expect(name).toMatch(/^(eth|net|web3)_[A-Za-z0-9]+$/)
    })
})

describe('classifyRpcMethod: yasak ve bilinmeyen adlar', () => {
    it.each(FORBIDDEN_METHODS)('%s -> deny', (name) => {
        expect(classifyRpcMethod(name)).toBe('deny')
    })

    it('eth_sendRawTransaction KASITLI olarak disarida', () => {
        expect(classifyRpcMethod('eth_sendRawTransaction')).toBe('deny')
    })

    it.each([
        'constructor',
        '__proto__',
        'hasOwnProperty',
        'toString',
        'valueOf',
        'prototype',
        ' eth_call',
        'eth_call ',
        'ETH_CALL',
        'Eth_Call',
        'eth_call' + String.fromCharCode(0),
        'eth_call\n',
        'eth_call' + String.fromCharCode(0x200b),
        'eth_ca',
        'eth_call2',
        'eth_getBalanceX',
        'eth_',
        '',
    ])('hileli ad %j -> deny (tam, buyuk/kucuk harf duyarli eslesme)', (name) => {
        expect(classifyRpcMethod(name)).toBe('deny')
    })

    it('metin olmayan her sey deny', () => {
        for (const v of [
            undefined,
            null,
            0,
            1,
            true,
            {},
            [],
            ['eth_call'],
            { toString: () => 'eth_call' },
            { method: 'eth_call' },
            Symbol('eth_call'),
            () => 'eth_call',
            new String('eth_call'),
        ]) {
            expect(classifyRpcMethod(v)).toBe('deny')
        }
    })

    it('disari verilen listeler dondurulmustur ve degistirilince siniflandirma BOZULMAZ', () => {
        expect(Object.isFrozen(FORWARD_METHODS)).toBe(true)
        expect(() => FORWARD_METHODS.push('eth_sendTransaction')).toThrow()
        expect(classifyRpcMethod('eth_sendTransaction')).toBe('deny')
    })
})

describe('rpcMethodWeight', () => {
    it.each(['eth_getLogs', 'eth_call', 'eth_getProof', 'eth_getBlockReceipts', 'eth_createAccessList'])(
        '%s agirligi 5',
        (name) => {
            expect(rpcMethodWeight(name)).toBe(5)
        }
    )

    it('digerleri 1; bilinmeyen/metin olmayan da 1', () => {
        expect(rpcMethodWeight('eth_blockNumber')).toBe(1)
        expect(rpcMethodWeight('eth_estimateGas')).toBe(1)
        expect(rpcMethodWeight('nope')).toBe(1)
        expect(rpcMethodWeight(undefined)).toBe(1)
        expect(rpcMethodWeight({})).toBe(1)
    })

    it('agir yontemlerin hepsi izinli kumededir', () => {
        for (const name of ['eth_getLogs', 'eth_call', 'eth_getProof', 'eth_getBlockReceipts', 'eth_createAccessList']) {
            expect(classifyRpcMethod(name)).toBe('forward')
        }
    })
})

describe('unsupportedMethodError', () => {
    it('4200 ve spec mesaji', () => {
        expect(unsupportedMethodError('wallet_getCapabilities')).toEqual({
            code: 4200,
            message: 'The method wallet_getCapabilities is not supported by this wallet.',
        })
    })

    it('ad en cok 64 karakter ve kontrol karakterleri atilmis', () => {
        const e = unsupportedMethodError('a'.repeat(200))
        expect(e.message).toBe(`The method ${'a'.repeat(64)} is not supported by this wallet.`)

        const c = unsupportedMethodError('eth_' + String.fromCharCode(0) + 'ca' + String.fromCharCode(10) + 'll' + String.fromCharCode(0x7f) + String.fromCharCode(0x2028) + 'x')
        expect(c.message).toBe('The method eth_callx is not supported by this wallet.')
    })

    it('emoji gibi cift kodlu karakter ortadan BOLUNMEZ', () => {
        const e = unsupportedMethodError(String.fromCodePoint(0x1F600).repeat(100))
        expect(e.message).toBe(`The method ${String.fromCodePoint(0x1F600).repeat(64)} is not supported by this wallet.`)
    })

    it('metin olmayan veya bos ad: unknown yazilir, nesne icerigi/tip adi DEGIL', () => {
        const UNKNOWN = 'The method unknown is not supported by this wallet.'
        expect(unsupportedMethodError({ evil: 'x' }).message).toBe(UNKNOWN)
        expect(unsupportedMethodError(undefined).message).toBe(UNKNOWN)
        expect(unsupportedMethodError('').message).toBe(UNKNOWN)
        expect(unsupportedMethodError(42).code).toBe(4200)
        expect(unsupportedMethodError(42).message).toBe(UNKNOWN)
    })

    it('sifir-genislik karakter (Cf) atilir; yalniz gorunmez karakterden olusan ad unknown olur', () => {
        const zw = String.fromCharCode(0x200b)
        expect(unsupportedMethodError('eth_' + zw + 'call').message).toBe('The method eth_call is not supported by this wallet.')
        expect(unsupportedMethodError(zw + zw).message).toBe('The method unknown is not supported by this wallet.')
    })

    it('bidi gecersiz kilma karakteri (Cf) atilir', () => {
        const rlo = String.fromCharCode(0x202e)
        const lri = String.fromCharCode(0x2066)
        expect(unsupportedMethodError('eth_' + rlo + 'call' + lri).message).toBe('The method eth_call is not supported by this wallet.')
    })

    it('atma kesmeden ONCE yapilir: gorunmez karakterler 64 siniri payini yemez', () => {
        const zw = String.fromCharCode(0x200b)
        const e = unsupportedMethodError(('a' + zw).repeat(100))
        expect(e.message).toBe(`The method ${'a'.repeat(64)} is not supported by this wallet.`)
    })

    it.each(['user rejected', 'User_Denied', 'user-cancelled', 'usercanceled', 'x User Rejected y'])(
        '"user rejected" benzeri ad (%s) yansitilmaz: unknown',
        (name) => {
            expect(unsupportedMethodError(name).message).toBe('The method unknown is not supported by this wallet.')
        }
    )

    it('gorunmez karakterle bolunmus "user rejected" da atmadan SONRA yakalanir', () => {
        const zw = String.fromCharCode(0x200b)
        expect(unsupportedMethodError('user' + zw + ' rejected').message).toBe('The method unknown is not supported by this wallet.')
    })

    it('zararsiz ad "user" ile baslasa da aynen yansir', () => {
        expect(unsupportedMethodError('user_getInfo').message).toBe('The method user_getInfo is not supported by this wallet.')
    })
})

