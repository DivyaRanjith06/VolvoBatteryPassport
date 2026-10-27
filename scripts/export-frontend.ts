/**
 * Writes the BatteryPassport ABI, local chain ID and deployed address to
 * frontend/src/contract.ts for the React frontend.
 *
 * deploy.ts already does this automatically. Run this only to refresh the ABI
 * after recompiling, keeping the address currently in contract.ts:
 *   npx hardhat run scripts/export-frontend.ts
 *
 * Or point the frontend at a specific address:
 *   $env:BATTERY_PASSPORT_ADDRESS="0x..."; npx hardhat run scripts/export-frontend.ts
 *
 * Reads the compiled artifact only. It does not connect to any network or deploy.
 */
import { CHAIN_ID, resolveContractAddress, writeFrontendConfig } from "./frontend-config.ts";

const address = await resolveContractAddress();
const { destination, abiEntries } = await writeFrontendConfig(address);

console.log(`Exported BatteryPassport ABI (${abiEntries} entries)`);
console.log(`Destination: ${destination}`);
console.log(`Address:     ${address}`);
console.log(`Chain ID:    ${CHAIN_ID}`);
