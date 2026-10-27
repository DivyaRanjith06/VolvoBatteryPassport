import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toHex, type Address, type Hash } from "viem";
import {
  CHAIN_ID,
  RPC_URL,
  Role,
  STAGE_NAMES,
  contract,
  describeError,
  makeWalletClient,
  publicClient,
  revertReason,
  roleName,
  shortAddress,
  type PublicPassport,
} from "./chain";
import {
  AdminPanel,
  AuditPanel,
  ManufacturerPanel,
  SupplierPanel,
  type Submit,
} from "./components/ActionPanels";
import { PassportView } from "./components/PassportView";

const DEMO_BATCH = "DEMO-BATCH-0001";
const initialBatch = new URLSearchParams(window.location.search).get("passport")?.trim() || DEMO_BATCH;

type TxState =
  | { label: string; phase: "signing" }
  | { label: string; phase: "mining"; hash: Hash }
  | { label: string; phase: "success"; hash: Hash; block: bigint }
  | { label: string; phase: "error"; message: string };

type LookupState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

export default function App() {
  const provider = window.ethereum;

  // ------------------------------------------------------------ wallet + role
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [role, setRole] = useState<number | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleRefresh, setRoleRefresh] = useState(0);

  useEffect(() => {
    if (!provider) return;
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => setAccount(accounts[0] ?? null))
      .catch(() => undefined);
    provider
      .request({ method: "eth_chainId" })
      .then((id) => setWalletChainId(Number(id)))
      .catch(() => undefined);

    const onAccountsChanged = (accounts: Address[]) => setAccount(accounts[0] ?? null);
    const onChainChanged = (id: string) => setWalletChainId(Number(id));
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener("accountsChanged", onAccountsChanged);
      provider.removeListener("chainChanged", onChainChanged);
    };
  }, [provider]);

  // The role always comes from the contract, never from the UI.
  useEffect(() => {
    if (!account) {
      setRole(null);
      setRoleError(null);
      return;
    }
    let cancelled = false;
    setRole(null);
    setRoleError(null);
    publicClient
      .readContract({ ...contract, functionName: "getRole", args: [account] })
      .then((r) => !cancelled && setRole(r))
      .catch((e) => !cancelled && setRoleError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [account, walletChainId, roleRefresh]);

  const wallet = useMemo(
    () => (account && provider ? makeWalletClient(account, provider) : null),
    [account, provider],
  );
  const onLocalChain = walletChainId === CHAIN_ID;

  async function connect() {
    if (!provider) return;
    setWalletMessage(null);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0] ?? null);
      setWalletChainId(Number(await provider.request({ method: "eth_chainId" })));
    } catch (error) {
      setWalletMessage(describeError(error));
    }
  }

  async function switchToLocal() {
    if (!provider) return;
    setWalletMessage(null);
    const chainId = toHex(CHAIN_ID);
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      if ((error as { code?: number }).code === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId,
                chainName: "Hardhat Local",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: [RPC_URL],
              },
            ],
          });
        } catch (addError) {
          setWalletMessage(describeError(addError));
        }
      } else {
        setWalletMessage(describeError(error));
      }
    }
  }

  // ------------------------------------------------------------ passport lookup
  const [batchInput, setBatchInput] = useState(initialBatch);
  const [passport, setPassport] = useState<PublicPassport | null>(null);
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const lookupSeq = useRef(0);

  const lookupBatch = useCallback(async (raw: string) => {
    const id = raw.trim();
    if (!id) {
      setPassport(null);
      setLookup({ status: "error", message: "Enter a batch ID." });
      return;
    }
    const seq = ++lookupSeq.current;
    setBatchInput(id);
    setLookup({ status: "loading" });
    window.history.replaceState(null, "", `?passport=${encodeURIComponent(id)}`);
    try {
      const result = await publicClient.readContract({ ...contract, functionName: "getPublicPassport", args: [id] });
      if (seq !== lookupSeq.current) return;
      setPassport(result);
      setLookup({ status: "idle" });
    } catch (error) {
      if (seq !== lookupSeq.current) return;
      setPassport(null);
      const message = describeError(error);
      setLookup({
        status: "error",
        message: message.startsWith("Battery not found")
          ? `No battery with batch ID "${id}" is registered on this contract.`
          : message,
      });
    }
  }, []);

  useEffect(() => {
    void lookupBatch(initialBatch);
  }, [lookupBatch]);

  function onLookupSubmit(event: FormEvent) {
    event.preventDefault();
    void lookupBatch(batchInput);
  }

  // ------------------------------------------------------------ transactions
  const [tx, setTx] = useState<TxState | null>(null);
  const txBusy = tx?.phase === "signing" || tx?.phase === "mining";

  const submit: Submit = async (label, batchId, write, expectedStage) => {
    if (!account || !wallet) {
      setTx({ label, phase: "error", message: "Connect MetaMask first." });
      return false;
    }
    if (!onLocalChain) {
      setTx({ label, phase: "error", message: `Switch MetaMask to the local Hardhat network (chain ID ${CHAIN_ID}).` });
      return false;
    }
    setTx({ label, phase: "signing" });
    let hash: Hash | null = null;
    try {
      hash = await write({ account, wallet });
      setTx({ label, phase: "mining", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setTx({ label, phase: "error", message: await revertReason(hash, receipt.blockNumber) });
        return false;
      }
      // A mined receipt is not enough: confirm the contract state actually changed.
      if (batchId && expectedStage !== undefined) {
        const after = await publicClient.readContract({ ...contract, functionName: "getPublicPassport", args: [batchId] });
        if (after.currentStage !== expectedStage) {
          setTx({
            label,
            phase: "error",
            message:
              `Transaction ${hash} was mined, but batch "${batchId}" is at stage ` +
              `${STAGE_NAMES[after.currentStage]} instead of ${STAGE_NAMES[expectedStage]}.`,
          });
          return false;
        }
      }
      setTx({ label, phase: "success", hash, block: receipt.blockNumber });
      setRoleRefresh((n) => n + 1);
      if (batchId) await lookupBatch(batchId);
      return true;
    } catch (error) {
      const prefix = hash ? `Transaction ${hash} was sent, but confirming it failed: ` : "";
      setTx({ label, phase: "error", message: prefix + describeError(error) });
      return false;
    }
  };

  const currentBatch = passport?.batchId ?? batchInput;
  const writesDisabled = txBusy || !onLocalChain;

  // ------------------------------------------------------------ render
  return (
    <div className="page">
      <header className="masthead">
        <div>
          <h1>Volvo Battery Passport</h1>
          <p className="subtitle">Blockchain-Based Supply Chain Transparency</p>
        </div>
        <p className="tag">Educational prototype · local Hardhat network</p>
      </header>

      <main className="layout">
        <section className="card">
          <h2 className="card-title">Wallet &amp; on-chain role</h2>
          {!provider ? (
            <p className="notice">
              MetaMask was not detected. You can still look up public passports below; they are read directly
              from the local node at <span className="mono">{RPC_URL}</span>.
            </p>
          ) : !account ? (
            <div className="row">
              <button className="btn" onClick={connect}>
                Connect MetaMask
              </button>
              <p className="hint">Not needed to view public passports.</p>
            </div>
          ) : (
            <dl className="wallet-grid">
              <div className="field">
                <dt>Connected account</dt>
                <dd className="mono" title={account}>
                  {shortAddress(account)}
                </dd>
              </div>
              <div className="field">
                <dt>Network</dt>
                <dd>
                  {onLocalChain ? (
                    <span className="ok">Hardhat Local ({CHAIN_ID})</span>
                  ) : (
                    <span className="warn">Chain ID {walletChainId ?? "unknown"}</span>
                  )}
                </dd>
              </div>
              <div className="field">
                <dt>Role (from contract)</dt>
                <dd>
                  {roleError ? (
                    <span className="warn">{roleError}</span>
                  ) : role === null ? (
                    "Reading…"
                  ) : (
                    <span className="role-badge">{roleName(role)}</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
          {provider && account && !onLocalChain && (
            <div className="notice warn-box">
              <p>
                MetaMask is not on the local Hardhat network. Transactions are disabled until you switch to{" "}
                <strong>chain ID {CHAIN_ID}</strong> (RPC <span className="mono">{RPC_URL}</span>, symbol ETH).
              </p>
              <button className="btn btn-secondary" onClick={switchToLocal}>
                Switch / add Hardhat Local
              </button>
            </div>
          )}
          {walletMessage && <p className="form-error">{walletMessage}</p>}
          <p className="hint">
            Roles are assigned on the blockchain by the Admin. To act as a different participant, switch accounts
            in MetaMask; the role shown is re-read from the contract.
          </p>
        </section>

        <section className="card">
          <h2 className="card-title">Public battery passport</h2>
          <form className="lookup" onSubmit={onLookupSubmit}>
            <label>
              <span>Batch ID</span>
              <input
                className="mono"
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder={DEMO_BATCH}
              />
            </label>
            <button className="btn" type="submit" disabled={lookup.status === "loading"}>
              {lookup.status === "loading" ? "Loading…" : "View passport"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => void lookupBatch(DEMO_BATCH)}>
              Demo batch
            </button>
          </form>
          <p className="hint">No wallet needed — read from the contract via the local RPC.</p>

          {lookup.status === "error" && <p className="notice warn-box">{lookup.message}</p>}
          {passport && <PassportView passport={passport} />}
        </section>

        <section className="card">
          <h2 className="card-title">Actions for your role</h2>
          {tx && <TxBanner tx={tx} onDismiss={() => setTx(null)} />}

          {!account ? (
            <p className="hint">Connect MetaMask to see the actions available to your on-chain role.</p>
          ) : role === null ? (
            <p className="hint">{roleError ? "Role unavailable." : "Reading role from contract…"}</p>
          ) : (
            <>
              <p className="hint">
                Forms are shown for your on-chain role, but the contract checks every transaction. Each one is
                signed in MetaMask and confirmed on-chain before the passport refreshes.
              </p>
              {role === Role.Admin && (
                <>
                  <h3 className="panel-title">Role management</h3>
                  <AdminPanel submit={submit} disabled={writesDisabled} batchId={currentBatch} />
                  <h3 className="panel-title">Audit (full passport)</h3>
                  <AuditPanel account={account} batchId={currentBatch} onSelectBatch={lookupBatch} />
                </>
              )}
              {role === Role.Supplier && (
                <SupplierPanel key={currentBatch} submit={submit} disabled={writesDisabled} batchId={currentBatch} />
              )}
              {role === Role.Manufacturer && (
                <ManufacturerPanel
                  key={currentBatch}
                  submit={submit}
                  disabled={writesDisabled}
                  batchId={currentBatch}
                />
              )}
              {role === Role.Regulator && (
                <AuditPanel key={currentBatch} account={account} batchId={currentBatch} onSelectBatch={lookupBatch} />
              )}
              {role === Role.Customer && (
                <p className="notice">Customers can view public passports and scan their QR codes. No write access.</p>
              )}
              {role === Role.None && (
                <p className="notice">
                  This account has no role on the contract. The Admin must grant one before it can record data.
                </p>
              )}
            </>
          )}
        </section>

        <section className="card limitations">
          <h2 className="card-title">About this data</h2>
          <ul>
            <li>
              <strong>Records, not proof of truth.</strong> The blockchain preserves what participants submit and
              who submitted it. It does not independently verify that the contents (origin, recycled content,
              carbon footprint) are accurate; that needs audits and external verification.
            </li>
            <li>
              <strong>Access control is not confidentiality.</strong> Role checks decide which accounts may call
              contract functions. They do not encrypt anything: all stored data is readable by anyone with access
              to the blockchain node.
            </li>
            <li>
              Educational prototype inspired by the Volvo Cars–Circulor case study. Not affiliated with either
              company. All demo data is fictional.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function TxBanner({ tx, onDismiss }: { tx: TxState; onDismiss: () => void }) {
  const text =
    tx.phase === "signing"
      ? "Checking with the contract, then confirm in MetaMask…"
      : tx.phase === "mining"
        ? "Transaction sent. Waiting for the receipt…"
        : tx.phase === "success"
          ? `Confirmed in block ${tx.block}.`
          : tx.message;
  const hash = tx.phase === "mining" || tx.phase === "success" ? tx.hash : null;
  return (
    <div className={`tx-banner tx-${tx.phase}`} role="status">
      <div>
        <strong>{tx.label}</strong> — {text}
        {hash && <div className="mono tx-hash">{hash}</div>}
      </div>
      {(tx.phase === "success" || tx.phase === "error") && (
        <button className="link" onClick={onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      )}
    </div>
  );
}
