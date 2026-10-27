import { artifacts, network } from "hardhat";
import { writeFrontendConfig } from "./frontend-config.ts";

type Address = `0x${string}`;

interface TransactionReceipt {
  status: string;
  contractAddress: Address | null;
  blockNumber: string;
}

const { provider, networkName, networkConfig } = await network.create();

// Safety guard: this educational prototype is only deployed to local networks.
if (networkName !== "localhost" && networkConfig.type !== "edr-simulated") {
  throw new Error(
    `Refusing to deploy to "${networkName}". Use --network localhost or the in-process Hardhat network.`,
  );
}

const artifact = await artifacts.readArtifact("BatteryPassport");

const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
if (accounts.length === 0) {
  throw new Error(`No unlocked accounts available on network "${networkName}".`);
}
const deployer = accounts[0];

console.log(`Network:  ${networkName}`);
console.log(`Deployer: ${deployer} (becomes Admin in the constructor)`);

const txHash = (await provider.request({
  method: "eth_sendTransaction",
  params: [{ from: deployer, data: artifact.bytecode }],
})) as Address;

let receipt: TransactionReceipt | null = null;
for (let attempt = 0; attempt < 30 && receipt === null; attempt++) {
  receipt = (await provider.request({
    method: "eth_getTransactionReceipt",
    params: [txHash],
  })) as TransactionReceipt | null;
  if (receipt === null) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

if (receipt === null) {
  throw new Error(`Deployment transaction ${txHash} was not mined.`);
}
if (receipt.status !== "0x1" || receipt.contractAddress === null) {
  throw new Error(`Deployment transaction ${txHash} failed.`);
}

const code = (await provider.request({
  method: "eth_getCode",
  params: [receipt.contractAddress, "latest"],
})) as string;
if (code === "0x") {
  throw new Error(`No contract code found at ${receipt.contractAddress}.`);
}

console.log(`Tx hash:  ${txHash}`);
console.log(`Block:    ${BigInt(receipt.blockNumber)}`);
console.log("");
console.log(`BatteryPassport deployed to: ${receipt.contractAddress}`);

// Keep the dashboard and seed.ts pointed at THIS deployment (prevents stale-address mismatches).
const { destination } = await writeFrontendConfig(receipt.contractAddress);
console.log(`Frontend config updated: ${destination}`);
