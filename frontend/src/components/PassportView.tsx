import { QRCodeSVG } from "qrcode.react";
import { NEXT_STEP, STAGE_NAMES, Stage, type PublicPassport } from "../chain";

const TRACKER_STAGES = [
  Stage.Registered,
  Stage.Refined,
  Stage.Manufactured,
  Stage.Distributed,
  Stage.EndOfLife,
  Stage.Recycled,
];

export function StageTracker({ stage }: { stage: number }) {
  return (
    <ol className="tracker" aria-label="Lifecycle progress">
      {TRACKER_STAGES.map((s) => {
        const state = stage > s ? "done" : stage === s ? "current" : "todo";
        return (
          <li key={s} className={`tracker-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="tracker-dot">{state === "todo" ? s : "✓"}</span>
            <span className="tracker-label">{STAGE_NAMES[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, value, reached }: { label: string; value: string; reached: boolean }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={reached ? undefined : "muted"}>{reached ? value || "—" : "Not yet recorded"}</dd>
    </div>
  );
}

export function passportUrl(batchId: string): string {
  return `${window.location.origin}${window.location.pathname}?passport=${encodeURIComponent(batchId)}`;
}

export function PassportView({ passport }: { passport: PublicPassport }) {
  const stage = passport.currentStage;
  const url = passportUrl(passport.batchId);

  return (
    <div className="passport">
      <div className="passport-head">
        <div>
          <p className="eyebrow">Battery Passport</p>
          <h2 className="mono">{passport.batchId}</h2>
        </div>
        <div className="stage-badge">
          <span>Lifecycle status</span>
          <strong>{STAGE_NAMES[stage] ?? `Unknown (${stage})`}</strong>
        </div>
      </div>

      <StageTracker stage={stage} />
      <p className="next-step">
        Next step: <strong>{NEXT_STEP[stage] ?? "—"}</strong>
      </p>

      <div className="passport-body">
        <div className="passport-sections">
          <section>
            <h3>Material origin</h3>
            <dl>
              <Field label="Mine location" value={passport.mineLocation} reached={stage >= Stage.Registered} />
              <Field label="Material origin" value={passport.materialOrigin} reached={stage >= Stage.Registered} />
              <Field
                label="Recycled content"
                value={`${passport.recycledContentPct}%`}
                reached={stage >= Stage.Refined}
              />
            </dl>
          </section>
          <section>
            <h3>Manufacturing history</h3>
            <dl>
              <Field
                label="Manufacturing details"
                value={passport.manufacturingDetails}
                reached={stage >= Stage.Manufactured}
              />
              <Field
                label="Carbon footprint"
                value={`${passport.carbonFootprintKg.toLocaleString()} kg CO₂e (self-reported)`}
                reached={stage >= Stage.Manufactured}
              />
              <Field label="Vehicle VIN" value={passport.vehicleVIN} reached={stage >= Stage.Manufactured} />
              <Field
                label="Quality inspection"
                value={passport.qualityPassed ? "Passed" : "Failed"}
                reached={stage >= Stage.Manufactured}
              />
            </dl>
          </section>
          <section>
            <h3>Distribution &amp; end of life</h3>
            <dl>
              <Field
                label="Distribution details"
                value={passport.distributionDetails}
                reached={stage >= Stage.Distributed}
              />
              <Field
                label="End-of-life collection"
                value="Collected for recycling"
                reached={stage >= Stage.EndOfLife}
              />
              <Field
                label="Recovered materials"
                value={passport.recoveredMaterials}
                reached={stage >= Stage.Recycled}
              />
            </dl>
          </section>
        </div>

        <aside className="qr">
          <QRCodeSVG value={url} size={148} marginSize={2} title={`Passport QR code for ${passport.batchId}`} />
          <p className="qr-url mono">{url}</p>
          <p className="hint">
            Opens this public passport. Works on this computer while the local app and Hardhat node are running.
          </p>
        </aside>
      </div>
    </div>
  );
}
