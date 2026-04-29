import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const CHAINALYSIS_ORACLE_ADDRESS = '0x40C57923924B5c5c5455c48D93317139ADDaC8fb' as const;

const SANCTIONS_ORACLE_ABI = [
  {
    name: 'isSanctioned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface ScreeningResult {
  allowed: boolean;
  source?: 'blacklist' | 'chainalysis-oracle' | 'screening-url';
}

export interface WalletScreeningConfig {
  /** Master toggle. Default: true (screening enabled). Set false to disable all checks. */
  enabled?: boolean;
  /** Use the free Chainalysis Sanctions Oracle on Ethereum mainnet (OFAC SDN). Default: true. */
  useChainalysisOracle?: boolean;
  /** URL of an integrator-provided screening endpoint. SDK sends GET ?address=0x... and expects { allowed: boolean }. */
  screeningUrl?: string;
  /** Static array of addresses or async function. Checked before Chainalysis / screeningUrl. */
  blacklist?: string[] | ((address: string) => boolean | Promise<boolean>);
  /** Optional RPC URL override for the Ethereum mainnet client used to query the Chainalysis Oracle. */
  ethereumRpcUrl?: string;
}

async function checkChainalysisOracle(
  address: string,
  rpcUrl?: string,
): Promise<boolean> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });

  try {
    const result = await client.readContract({
      address: CHAINALYSIS_ORACLE_ADDRESS,
      abi: SANCTIONS_ORACLE_ABI,
      functionName: 'isSanctioned',
      args: [address as `0x${string}`],
    });
    return Boolean(result);
  } catch {
    // Fail open on RPC errors — don't block users due to infrastructure issues.
    return false;
  }
}

async function checkScreeningUrl(
  screeningUrl: string,
  address: string,
): Promise<boolean> {
  try {
    const separator = screeningUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${screeningUrl}${separator}address=${address}`);
    if (!res.ok) return true;
    const data: { allowed?: boolean } = await res.json();
    return data.allowed !== false;
  } catch {
    return true;
  }
}

async function checkBlacklist(
  blacklist: NonNullable<WalletScreeningConfig['blacklist']>,
  address: string,
): Promise<boolean> {
  try {
    if (Array.isArray(blacklist)) {
      return blacklist.some((a) => a.toLowerCase() === address.toLowerCase());
    }
    return await blacklist(address);
  } catch {
    return false;
  }
}

/**
 * Run all configured screening checks against a wallet address.
 * Blacklist runs first, then Chainalysis Oracle, then the integrator screening URL.
 * Returns { allowed: false, source } if any check flags the address.
 */
export async function screenWallet(
  address: string,
  config?: WalletScreeningConfig,
): Promise<ScreeningResult> {
  if (config?.enabled === false) return { allowed: true };

  if (config?.blacklist) {
    const isBlacklisted = await checkBlacklist(config.blacklist, address);
    if (isBlacklisted) {
      return { allowed: false, source: 'blacklist' };
    }
  }

  if (config?.useChainalysisOracle !== false) {
    const isSanctioned = await checkChainalysisOracle(address, config?.ethereumRpcUrl);
    if (isSanctioned) {
      return { allowed: false, source: 'chainalysis-oracle' };
    }
  }

  if (config?.screeningUrl) {
    const allowed = await checkScreeningUrl(config.screeningUrl, address);
    if (!allowed) {
      return { allowed: false, source: 'screening-url' };
    }
  }

  return { allowed: true };
}
