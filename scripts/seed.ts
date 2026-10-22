/**
 * Seeds ONE fictional demo battery batch into the BatteryPassport contract
 * on the local Hardhat node and advances it through every lifecycle stage.
 *
 * Run (with `npx hardhat node` running in another terminal):
 *   npx hardhat run scripts/seed.ts --network localhost
 *
 * IMPORTANT: CONTRACT_ADDRESS is only valid for the current run of the local
 * node. Restarting `npx hardhat node` wipes the chain; after redeploying with
 * scripts/deploy.ts, update CONTRACT_ADDRESS below or set the environment
 * variable BATTERY_PASSPORT_ADDRESS to the newly printed address.
 *
 * Safe to rerun: the script reads the batch's current stage and performs only
 * the remaining stages, in order. All data below is fictional demo data.
 *
 * No ethers/viem is installed, so calls are ABI-encoded by hand. Function
 * selectors are read from Hardhat's solc build output, not hard-coded.
 */
import { readFile } from "node:fs/promises";
import { artifacts, network } from "hardhat";

type Address = `0x${string}`;

const CONTRACT_ADDRESS = (process.env.BATTERY_PASSPORT_ADDRESS ??
  "0x5fbdb2315678afecb367f032d93f642f64180aa3") as Address;

// Mirrors `enum Role` and `enum Stage` in contracts/BatteryPassport.sol.
const Role = { None: 0n, Admin: 1n, Supplier: 2n, Manufacturer: 3n, Regulator: 4n, Customer: 5n } as const;
const STAGE_NAMES = ["Unregistered", "Registered", "Refined", "Manufactured", "Distributed", "EndOfLife", "Recycled"];
const STAGE_RECYCLED = 6;

const DEMO = {
  batchId: "DEMO-BATCH-0001",
  mineLocation: "Demo Mine Site A (fictional location)",
  materialOrigin: "Cobalt, Lithium, Nickel (demo data)",
  refiningDetails: "Demo refinery: hydrometallurgical purification to 99.5% (illustrative)",
  recycledContentPct: 16n,
  manufacturingDetails: "Demo cell manufacturing and pack assembly (illustrative)",
  carbonFootprintKg: 5600n,
  vehicleVIN: "DEMOVIN0000000001",
  qualityPassed: true,
  distributionDetails: "Demo shipment to a fictional dealership, Gothenburg",
  recoveredMaterials: "Demo recovery: lithium, cobalt, nickel (illustrative)",
} as const;

// ---------------------------------------------------------------- ABI helpers

type AbiArg =
  | { type: "string"; value: string }
  | { type: "uint"; value: bigint }
  | { type: "bool"; value: boolean }
  | { type: "address"; value: Address };

const word = (n: bigint): string => n.toString(16).padStart(64, "0");

function encodeArgs(args: AbiArg[]): string {
  const heads: string[] = [];
  const tails: string[] = [];
  let tailOffset = BigInt(args.length * 32);
  for (const arg of args) {
    switch (arg.type) {
      case "uint":
        heads.push(word(arg.value));
        break;
      case "bool":
        heads.push(word(arg.value ? 1n : 0n));
        break;
      case "address":
        heads.push(arg.value.slice(2).toLowerCase().padStart(64, "0"));
        break;
      case "string": {
        const hex = Buffer.from(arg.value, "utf8").toString("hex");
        const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
        const tail = word(BigInt(hex.length / 2)) + padded;
        heads.push(word(tailOffset));
        tails.push(tail);
        tailOffset += BigInt(tail.length / 2);
        break;
      }
    }
  }
  return heads.join("") + tails.join("");
}

const str = (value: string): AbiArg => ({ type: "string", value });
const uint = (value: bigint): AbiArg => ({ type: "uint", value });
const bool = (value: boolean): AbiArg => ({ type: "bool", value });
const addr = (value: Address): AbiArg => ({ type: "address", value });

// ---------------------------------------------------------------- setup

const { provider, networkName } = await network.create();
if (networkName !== "localhost") {
  throw new Error(`This script seeds the local node only. Run it with --network localhost (got "${networkName}").`);
}

const artifact = await artifacts.readArtifact("BatteryPassport");
const buildInfoOutputPath = await artifacts.getBuildInfoOutputPath(artifact.buildInfoId ?? "");
if (buildInfoOutputPath === undefined) {
  throw new Error("Build info not found. Run `npx hardhat build` first.");
}
const buildOutput = JSON.parse(await readFile(buildInfoOutputPath, "utf8"));
const selectors: Record<string, string> =
  buildOutput.output.contracts[artifact.inputSourceName].BatteryPassport.evm.methodIdentifiers;

function calldata(signature: string, args: AbiArg[]): string {
  const selector = selectors[signature];
  if (selector === undefined) {
    throw new Error(`Function ${signature} not found in the compiled BatteryPassport ABI.`);
  }
  return `0x${selector}${encodeArgs(args)}`;
}

const code = (await provider.request({ method: "eth_getCode", params: [CONTRACT_ADDRESS, "latest"] })) as string;
if (code === "0x") {
  throw new Error(
    `No contract at ${CONTRACT_ADDRESS}. If the local node was restarted, redeploy with ` +
      `scripts/deploy.ts and set BATTERY_PASSPORT_ADDRESS (or update CONTRACT_ADDRESS).`,
  );
}

const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
if (accounts.length < 5) {
  throw new Error(`Expected at least 5 local accounts, found ${accounts.length}.`);
}
const [admin, supplier, manufacturer, regulator, customer] = accounts;

// ---------------------------------------------------------------- RPC helpers

async function call(data: string): Promise<string> {
  return (await provider.request({ method: "eth_call", params: [{ to: CONTRACT_ADDRESS, data }, "latest"] })) as string;
}

async function send(label: string, from: Address, data: string): Promise<void> {
  let txHash: string;
  try {
    txHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to: CONTRACT_ADDRESS, data }],
    })) as string;
  } catch (error) {
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] })) as {
      status: string;
    } | null;
    if (receipt !== null) {
      if (receipt.status !== "0x1") {
        throw new Error(`${label} reverted (tx ${txHash}).`);
      }
      console.log(`  OK  ${label}  (tx ${txHash})`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label}: transaction ${txHash} was not mined.`);
}

async function getRole(account: Address): Promise<bigint> {
  return BigInt(await call(calldata("getRole(address)", [addr(account)])));
}

/** Returns the batch's current Stage index, or 0 (Unregistered) if it does not exist. */
async function getStage(batchId: string): Promise<number> {
  let result: string;
  try {
    result = await call(calldata("getPublicPassport(string)", [str(batchId)]));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Battery not found")) {
      return 0;
    }
    throw error;
  }
  // Return data: [offset to struct][struct head: 11 words]...; currentStage is head word index 10.
  const hex = result.slice(2);
  const structStart = Number(BigInt(`0x${hex.slice(0, 64)}`)) * 2;
  const stageWord = hex.slice(structStart + 10 * 64, structStart + 11 * 64);
  return Number(BigInt(`0x${stageWord}`));
}

// ---------------------------------------------------------------- roles

console.log(`Network:  ${networkName}`);
console.log(`Contract: ${CONTRACT_ADDRESS}`);

if ((await getRole(admin)) !== Role.Admin) {
  throw new Error(`Account ${admin} is not Admin on this contract. Was it deployed by a different account?`);
}

console.log("\nRoles:");
const roleAssignments: Array<[string, Address, bigint]> = [
  ["Supplier", supplier, Role.Supplier],
  ["Manufacturer", manufacturer, Role.Manufacturer],
  ["Regulator", regulator, Role.Regulator],
  ["Customer", customer, Role.Customer],
];
for (const [name, account, role] of roleAssignments) {
  if ((await getRole(account)) === role) {
    console.log(`  --  ${name} already granted to ${account}`);
  } else {
    await send(`grantRole ${name} -> ${account}`, admin, calldata("grantRole(address,uint8)", [addr(account), uint(role)]));
  }
}

// ---------------------------------------------------------------- lifecycle

// Step i moves the batch from Stage i to Stage i + 1, in the order the contract enforces.
const steps: Array<{ label: string; from: Address; data: string }> = [
  {
    label: "registerBattery (Supplier)",
    from: supplier,
    data: calldata("registerBattery(string,string,string)", [
      str(DEMO.batchId),
      str(DEMO.mineLocation),
      str(DEMO.materialOrigin),
    ]),
  },
  {
    label: "recordRefining (Supplier)",
    from: supplier,
    data: calldata("recordRefining(string,string,uint8)", [
      str(DEMO.batchId),
      str(DEMO.refiningDetails),
      uint(DEMO.recycledContentPct),
    ]),
  },
  {
    label: "recordManufacturing (Manufacturer)",
    from: manufacturer,
    data: calldata("recordManufacturing(string,string,uint256,string,bool)", [
      str(DEMO.batchId),
      str(DEMO.manufacturingDetails),
      uint(DEMO.carbonFootprintKg),
      str(DEMO.vehicleVIN),
      bool(DEMO.qualityPassed),
    ]),
  },
  {
    label: "recordDistribution (Manufacturer)",
    from: manufacturer,
    data: calldata("recordDistribution(string,string)", [str(DEMO.batchId), str(DEMO.distributionDetails)]),
  },
  {
    label: "recordEndOfLife (Supplier)",
    from: supplier,
    data: calldata("recordEndOfLife(string)", [str(DEMO.batchId)]),
  },
  {
    label: "recordRecycling (Supplier)",
    from: supplier,
    data: calldata("recordRecycling(string,string)", [str(DEMO.batchId), str(DEMO.recoveredMaterials)]),
  },
];

const startStage = await getStage(DEMO.batchId);
console.log(`\nBatch ${DEMO.batchId}: current stage ${STAGE_NAMES[startStage]}`);
if (startStage > 0) {
  console.log(
    "  Batch already exists, so registration is skipped. Remaining stages are resumed in order;\n" +
      "  stored data from earlier runs is immutable and is not overwritten.",
  );
}
if (startStage === STAGE_RECYCLED) {
  console.log("  Lifecycle already complete; nothing to do.");
}

for (let stage = startStage; stage < STAGE_RECYCLED; stage++) {
  const step = steps[stage];
  await send(step.label, step.from, step.data);
  const newStage = await getStage(DEMO.batchId);
  if (newStage !== stage + 1) {
    throw new Error(
      `${step.label} succeeded but stage is ${STAGE_NAMES[newStage]} (expected ${STAGE_NAMES[stage + 1]}). ` +
        `Remaining stages not run: ${STAGE_NAMES.slice(stage + 2).join(", ") || "none"}.`,
    );
  }
}

const finalStage = await getStage(DEMO.batchId);
console.log(`\nBatch ID:    ${DEMO.batchId}`);
console.log(`Final stage: ${STAGE_NAMES[finalStage]} (${finalStage})`);
if (finalStage !== STAGE_RECYCLED) {
  console.log(`Remaining stages: ${STAGE_NAMES.slice(finalStage + 1).join(", ")}`);
  process.exitCode = 1;
}
