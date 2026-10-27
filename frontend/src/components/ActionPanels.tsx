import { useState, type FormEvent } from "react";
import { isAddress, type Address, type Hash } from "viem";
import {
  ROLE_NAMES,
  Role,
  STAGE_NAMES,
  Stage,
  contract,
  describeError,
  publicClient,
  type AppWalletClient,
  type FullPassport,
} from "../chain";

export interface TxContext {
  account: Address;
  wallet: AppWalletClient;
}

/**
 * Runs a write: shows pending/success/failure, waits for the receipt, then refreshes `batchId`.
 * With `expectedStage`, success is reported only if the batch is at that stage after the receipt.
 */
export type Submit = (
  label: string,
  batchId: string | null,
  write: (ctx: TxContext) => Promise<Hash>,
  expectedStage?: number,
) => Promise<boolean>;

type Values = Record<string, string | boolean>;

interface FieldSpec {
  name: string;
  label: string;
  kind?: "text" | "number" | "checkbox" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

function ActionForm({
  title,
  description,
  fields,
  initial,
  submitLabel,
  disabled,
  onSubmit,
}: {
  title: string;
  description?: string;
  fields: FieldSpec[];
  initial?: Values;
  submitLabel: string;
  disabled: boolean;
  /** Returns a validation message to block submission, or nothing to proceed. */
  onSubmit: (values: Values) => Promise<string | void>;
}) {
  const [values, setValues] = useState<Values>(() => {
    const start: Values = {};
    for (const f of fields) {
      start[f.name] = initial?.[f.name] ?? (f.kind === "checkbox" ? false : (f.options?.[0]?.value ?? ""));
    }
    return start;
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = await onSubmit(values);
    if (problem) setError(problem);
  }

  return (
    <form className="action-form" onSubmit={handleSubmit}>
      <h4>{title}</h4>
      {description && <p className="hint">{description}</p>}
      {fields.map((f) => (
        <label key={f.name} className={f.kind === "checkbox" ? "check" : undefined}>
          {f.kind === "checkbox" ? (
            <>
              <input
                type="checkbox"
                checked={values[f.name] === true}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })}
              />
              <span>{f.label}</span>
            </>
          ) : (
            <>
              <span>{f.label}</span>
              {f.kind === "select" ? (
                <select
                  value={String(values[f.name])}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.kind === "number" ? "number" : "text"}
                  inputMode={f.kind === "number" ? "numeric" : undefined}
                  min={f.min}
                  max={f.max}
                  step={f.kind === "number" ? 1 : undefined}
                  placeholder={f.placeholder}
                  value={String(values[f.name])}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                />
              )}
            </>
          )}
        </label>
      ))}
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn" disabled={disabled}>
        {submitLabel}
      </button>
    </form>
  );
}

const text = (v: Values, name: string) => String(v[name] ?? "").trim();

function requireText(v: Values, names: Record<string, string>): string | void {
  for (const [name, label] of Object.entries(names)) {
    if (!text(v, name)) return `${label} is required.`;
  }
}

interface PanelProps {
  submit: Submit;
  disabled: boolean;
  batchId: string;
}

export function AdminPanel({ submit, disabled }: PanelProps) {
  const roleOptions = ROLE_NAMES.slice(1).map((name, i) => ({ value: String(i + 1), label: name }));
  return (
    <div className="form-grid">
      <ActionForm
        title="Grant role"
        description="Assigns an on-chain role. Replaces any role the address already has."
        fields={[
          { name: "account", label: "Account address", placeholder: "0x…" },
          { name: "role", label: "Role", kind: "select", options: roleOptions },
        ]}
        submitLabel="Grant role"
        disabled={disabled}
        onSubmit={async (v) => {
          const account = text(v, "account");
          if (!isAddress(account)) return "Enter a valid 0x address.";
          const role = Number(v.role);
          await submit(`Grant ${ROLE_NAMES[role]} role`, null, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "grantRole",
              args: [account, role],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          });
        }}
      />
      <ActionForm
        title="Revoke role"
        description="Returns the address to role None."
        fields={[{ name: "account", label: "Account address", placeholder: "0x…" }]}
        submitLabel="Revoke role"
        disabled={disabled}
        onSubmit={async (v) => {
          const account = text(v, "account");
          if (!isAddress(account)) return "Enter a valid 0x address.";
          await submit("Revoke role", null, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "revokeRole",
              args: [account],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          });
        }}
      />
    </div>
  );
}

export function SupplierPanel({ submit, disabled, batchId }: PanelProps) {
  const batchField: FieldSpec = { name: "batchId", label: "Batch ID", placeholder: "e.g. BATCH-2026-001" };
  return (
    <div className="form-grid">
      <ActionForm
        title="1 · Register battery (mining)"
        fields={[
          batchField,
          { name: "mineLocation", label: "Mine location", placeholder: "Region, country" },
          { name: "materialOrigin", label: "Material origin", placeholder: "e.g. Cobalt, Lithium" },
        ]}
        submitLabel="Register battery"
        disabled={disabled}
        onSubmit={async (v) => {
          const problem = requireText(v, {
            batchId: "Batch ID",
            mineLocation: "Mine location",
            materialOrigin: "Material origin",
          });
          if (problem) return problem;
          const id = text(v, "batchId");
          await submit("Register battery", id, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "registerBattery",
              args: [id, text(v, "mineLocation"), text(v, "materialOrigin")],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          }, Stage.Registered);
        }}
      />
      <ActionForm
        title="2 · Record refining"
        initial={{ batchId }}
        fields={[
          batchField,
          { name: "refiningDetails", label: "Refining details", placeholder: "Process and purity" },
          { name: "recycledContentPct", label: "Recycled content (%)", kind: "number", min: 0, max: 100 },
        ]}
        submitLabel="Record refining"
        disabled={disabled}
        onSubmit={async (v) => {
          const problem = requireText(v, { batchId: "Batch ID", refiningDetails: "Refining details" });
          if (problem) return problem;
          const pctText = text(v, "recycledContentPct");
          if (!/^\d+$/.test(pctText) || Number(pctText) > 100) {
            return "Recycled content must be a whole number from 0 to 100.";
          }
          const id = text(v, "batchId");
          await submit("Record refining", id, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "recordRefining",
              args: [id, text(v, "refiningDetails"), Number(pctText)],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          }, Stage.Refined);
        }}
      />
      <ActionForm
        title="5 · Record end of life"
        initial={{ batchId }}
        fields={[batchField]}
        submitLabel="Record end of life"
        disabled={disabled}
        onSubmit={async (v) => {
          const problem = requireText(v, { batchId: "Batch ID" });
          if (problem) return problem;
          const id = text(v, "batchId");
          await submit("Record end of life", id, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "recordEndOfLife",
              args: [id],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          }, Stage.EndOfLife);
        }}
      />
      <ActionForm
        title="6 · Record recycling"
        initial={{ batchId }}
        fields={[batchField, { name: "recoveredMaterials", label: "Recovered materials", placeholder: "e.g. Lithium, Cobalt" }]}
        submitLabel="Record recycling"
        disabled={disabled}
        onSubmit={async (v) => {
          const problem = requireText(v, { batchId: "Batch ID", recoveredMaterials: "Recovered materials" });
          if (problem) return problem;
          const id = text(v, "batchId");
          await submit("Record recycling", id, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "recordRecycling",
              args: [id, text(v, "recoveredMaterials")],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          }, Stage.Recycled);
        }}
      />
    </div>
  );
}

export function ManufacturerPanel({ submit, disabled, batchId }: PanelProps) {
  const batchField: FieldSpec = { name: "batchId", label: "Batch ID" };
  return (
    <div className="form-grid">
      <ActionForm
        title="3 · Record manufacturing"
        initial={{ batchId, qualityPassed: true }}
        fields={[
          batchField,
          { name: "manufacturingDetails", label: "Manufacturing details", placeholder: "Cell and pack assembly" },
          { name: "carbonFootprintKg", label: "Carbon footprint (kg CO₂e)", kind: "number", min: 1 },
          { name: "vehicleVIN", label: "Vehicle VIN", placeholder: "17-character VIN" },
          { name: "qualityPassed", label: "Quality inspection passed", kind: "checkbox" },
        ]}
        submitLabel="Record manufacturing"
        disabled={disabled}
        onSubmit={async (v) => {
          const problem = requireText(v, {
            batchId: "Batch ID",
            manufacturingDetails: "Manufacturing details",
            vehicleVIN: "Vehicle VIN",
          });
          if (problem) return problem;
          const carbonText = text(v, "carbonFootprintKg");
          if (!/^\d+$/.test(carbonText) || BigInt(carbonText) === 0n) {
            return "Carbon footprint must be a whole number greater than zero.";
          }
          const id = text(v, "batchId");
          await submit("Record manufacturing", id, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "recordManufacturing",
              args: [
                id,
                text(v, "manufacturingDetails"),
                BigInt(carbonText),
                text(v, "vehicleVIN"),
                v.qualityPassed === true,
              ],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          }, Stage.Manufactured);
        }}
      />
      <ActionForm
        title="4 · Record distribution"
        initial={{ batchId }}
        fields={[batchField, { name: "distributionDetails", label: "Distribution details", placeholder: "Shipment and delivery" }]}
        submitLabel="Record distribution"
        disabled={disabled}
        onSubmit={async (v) => {
          const problem = requireText(v, { batchId: "Batch ID", distributionDetails: "Distribution details" });
          if (problem) return problem;
          const id = text(v, "batchId");
          await submit("Record distribution", id, async (ctx) => {
            const { request } = await publicClient.simulateContract({
              ...contract,
              functionName: "recordDistribution",
              args: [id, text(v, "distributionDetails")],
              account: ctx.account,
            });
            return ctx.wallet.writeContract(request);
          }, Stage.Distributed);
        }}
      />
    </div>
  );
}

/** Admin and Regulator: access-controlled reads, executed as the connected account. */
export function AuditPanel({
  account,
  batchId,
  onSelectBatch,
}: {
  account: Address;
  batchId: string;
  onSelectBatch: (batchId: string) => void;
}) {
  const [lookupId, setLookupId] = useState(batchId);
  const [full, setFull] = useState<FullPassport | null>(null);
  const [batchIds, setBatchIds] = useState<readonly string[] | null>(null);
  const [status, setStatus] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  async function run(task: () => Promise<void>) {
    setStatus({ busy: true, error: null });
    try {
      await task();
      setStatus({ busy: false, error: null });
    } catch (error) {
      setStatus({ busy: false, error: describeError(error) });
    }
  }

  const loadFull = () =>
    run(async () => {
      setFull(null);
      const id = lookupId.trim();
      if (!id) throw new Error("Enter a batch ID.");
      setFull(await publicClient.readContract({ ...contract, functionName: "getFullPassport", args: [id], account }));
    });

  const loadAll = () =>
    run(async () => {
      setBatchIds(await publicClient.readContract({ ...contract, functionName: "getAllBatchIds", account }));
    });

  return (
    <div className="audit">
      <div className="audit-controls">
        <label>
          <span>Batch ID</span>
          <input value={lookupId} onChange={(e) => setLookupId(e.target.value)} />
        </label>
        <button className="btn" onClick={loadFull} disabled={status.busy}>
          Load full passport
        </button>
        <button className="btn btn-secondary" onClick={loadAll} disabled={status.busy}>
          List all batch IDs
        </button>
      </div>
      {status.busy && <p className="hint">Reading from contract…</p>}
      {status.error && <p className="form-error">{status.error}</p>}

      {batchIds && (
        <div className="batch-list">
          <h4>Registered batches ({batchIds.length})</h4>
          {batchIds.length === 0 ? (
            <p className="hint">No batches registered yet.</p>
          ) : (
            <ul>
              {batchIds.map((id) => (
                <li key={id}>
                  <button className="link mono" onClick={() => onSelectBatch(id)}>
                    {id}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {full && (
        <div className="full-passport">
          <h4>
            Full passport · <span className="mono">{full.batchId}</span>
          </h4>
          <dl>
            <div className="field">
              <dt>Registered by</dt>
              <dd className="mono">{full.registeredBy}</dd>
            </div>
            <div className="field">
              <dt>Registered at</dt>
              <dd>{new Date(Number(full.registeredAt) * 1000).toLocaleString()}</dd>
            </div>
            <div className="field">
              <dt>Refining details</dt>
              <dd>{full.refiningDetails || "—"}</dd>
            </div>
            <div className="field">
              <dt>Recycled content</dt>
              <dd>{full.recycledContentPct}%</dd>
            </div>
            <div className="field">
              <dt>Carbon footprint</dt>
              <dd>{full.carbonFootprintKg.toLocaleString()} kg CO₂e</dd>
            </div>
            <div className="field">
              <dt>Lifecycle stage</dt>
              <dd>{STAGE_NAMES[full.currentStage]}</dd>
            </div>
          </dl>
          <p className="hint">
            These extra fields (supplier address, refining details, timestamp) are withheld from the public
            passport by the contract&apos;s function design, not by encryption. They remain readable to anyone
            with node access.
          </p>
        </div>
      )}
    </div>
  );
}

export function roleHasWrites(role: number): boolean {
  return role === Role.Admin || role === Role.Supplier || role === Role.Manufacturer;
}
