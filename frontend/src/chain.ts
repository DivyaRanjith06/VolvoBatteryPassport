import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  UserRejectedRequestError,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type ContractFunctionReturnType,
  type EIP1193Provider,
} from "viem";
import { hardhat } from "viem/chains";
import { BATTERY_PASSPORT_ABI, BATTERY_PASSPORT_ADDRESS, CHAIN_ID } from "./contract";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

// viem's built-in `hardhat` chain: id 31337, RPC http://127.0.0.1:8545.
export const localChain = hardhat;
export const RPC_URL = hardhat.rpcUrls.default.http[0];
export { CHAIN_ID };

/** Read-only client that talks directly to the local node; works without MetaMask. */
export const publicClient = createPublicClient({ chain: localChain, transport: http(RPC_URL) });

export const contract = { address: BATTERY_PASSPORT_ADDRESS, abi: BATTERY_PASSPORT_ABI } as const;

export function makeWalletClient(account: Address, provider: EIP1193Provider) {
  return createWalletClient({ account, chain: localChain, transport: custom(provider) });
}
export type AppWalletClient = ReturnType<typeof makeWalletClient>;

export type PublicPassport = ContractFunctionReturnType<typeof BATTERY_PASSPORT_ABI, "view", "getPublicPassport">;
export type FullPassport = ContractFunctionReturnType<typeof BATTERY_PASSPORT_ABI, "view", "getFullPassport">;

// Mirror `enum Role` and `enum Stage` in contracts/BatteryPassport.sol (order matters).
export const ROLE_NAMES = ["None", "Admin", "Supplier", "Manufacturer", "Regulator", "Customer"] as const;
export const Role = { None: 0, Admin: 1, Supplier: 2, Manufacturer: 3, Regulator: 4, Customer: 5 } as const;

export const STAGE_NAMES = [
  "Unregistered",
  "Registered",
  "Refined",
  "Manufactured",
  "Distributed",
  "End of Life",
  "Recycled",
] as const;
export const Stage = {
  Unregistered: 0,
  Registered: 1,
  Refined: 2,
  Manufactured: 3,
  Distributed: 4,
  EndOfLife: 5,
  Recycled: 6,
} as const;

/** Next action needed for a batch at a given stage, and the role allowed to perform it. */
export const NEXT_STEP: Record<number, string> = {
  0: "Register battery (Supplier)",
  1: "Record refining (Supplier)",
  2: "Record manufacturing (Manufacturer)",
  3: "Record distribution (Manufacturer)",
  4: "Record end-of-life (Supplier)",
  5: "Record recycling (Supplier)",
  6: "Lifecycle complete",
};

export function roleName(role: number): string {
  return ROLE_NAMES[role] ?? `Unknown (${role})`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Turns viem / MetaMask errors into a message a user can act on. */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.shortMessage;
    }
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Request rejected in MetaMask.";
    }
    if (error.walk((e) => e instanceof ContractFunctionZeroDataError)) {
      return (
        `No contract responded at ${BATTERY_PASSPORT_ADDRESS}. If the local node was restarted, ` +
        "redeploy and re-run scripts/export-frontend.ts."
      );
    }
    if (error.walk((e) => e instanceof HttpRequestError)) {
      return `Cannot reach the local Hardhat node at ${RPC_URL}. Is \`npx hardhat node\` running?`;
    }
    return error.shortMessage;
  }
  // MetaMask often rejects with plain { code, message } objects rather than Error instances.
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as { code?: number; message?: unknown };
    if (code === 4001) return "Request rejected in MetaMask.";
    if (typeof message === "string") return message;
  }
  return String(error);
}
