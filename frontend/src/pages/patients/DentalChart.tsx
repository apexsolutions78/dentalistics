import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { formatDateTime } from '../../lib/format';
import {
  displayTooth,
  lowerTeethVisual,
  toothSide,
  upperTeeth,
  type ChartNumbering,
} from '../../lib/teeth';
import { Flash } from '../../components/Flash';
import { FormField } from '../../components/FormField';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/states';

interface ChartCondition {
  code: string;
  label: string;
  mark: string;
}

interface ChartAuthor {
  id: number;
  email: string;
}

interface ChartTooth {
  tooth: string;
  conditions: string[];
  notes: string | null;
  updatedAt: string | null;
  updatedBy: ChartAuthor | null;
}

interface ChartHistoryEntry {
  id: number;
  tooth: string;
  conditions: string[];
  notes: string | null;
  createdAt: string;
  author: ChartAuthor | null;
}

interface PlanItem {
  id: number;
  tooth: string;
  procedure: string;
  status: 'PLANNED' | 'DONE';
  estimatedFee: string | null;
  createdAt: string;
  author: ChartAuthor | null;
}

interface ChartResponse {
  numbering: ChartNumbering;
  conditions: ChartCondition[];
  teeth: ChartTooth[];
  history: ChartHistoryEntry[];
  treatmentPlan: PlanItem[];
}

function conditionLabels(codes: string[], catalog: ChartCondition[]): string {
  if (codes.length === 0) return 'No conditions';
  return codes
    .map((code) => catalog.find((item) => item.code === code)?.label ?? code)
    .join(', ');
}

function marksFor(codes: string[], catalog: ChartCondition[]): string {
  return codes
    .map((code) => catalog.find((item) => item.code === code)?.mark ?? '')
    .filter((mark) => mark !== '')
    .join(' ');
}

function ToothButton({
  fdi,
  numbering,
  catalog,
  saved,
  pressed,
  onSelect,
}: {
  fdi: string;
  numbering: ChartNumbering;
  catalog: ChartCondition[];
  saved: ChartTooth | undefined;
  pressed: boolean;
  onSelect: (fdi: string) => void;
}) {
  const conditions = saved?.conditions ?? [];
  const missing = conditions.includes('missing');
  const label = `Tooth ${displayTooth(fdi, numbering)}, ${toothSide(fdi)}, ${conditionLabels(conditions, catalog)}`;
  return (
    <button
      type="button"
      className={missing ? 'tooth is-missing' : 'tooth'}
      aria-pressed={pressed}
      aria-label={label}
      onClick={() => onSelect(fdi)}
    >
      <span className="tooth-number">{displayTooth(fdi, numbering)}</span>
      <span className="tooth-marks">{marksFor(conditions, catalog)}</span>
    </button>
  );
}

function Arch({
  label,
  teeth,
  numbering,
  catalog,
  byTooth,
  selected,
  onSelect,
}: {
  label: string;
  teeth: readonly string[];
  numbering: ChartNumbering;
  catalog: ChartCondition[];
  byTooth: Map<string, ChartTooth>;
  selected: string | null;
  onSelect: (fdi: string) => void;
}) {
  const left = teeth.slice(0, 8);
  const right = teeth.slice(8);
  return (
    <div role="group" aria-label={label} className="odontogram-arch">
      {left.map((fdi) => (
        <ToothButton
          key={fdi}
          fdi={fdi}
          numbering={numbering}
          catalog={catalog}
          saved={byTooth.get(fdi)}
          pressed={selected === fdi}
          onSelect={onSelect}
        />
      ))}
      <span className="odontogram-midline" aria-hidden="true" />
      {right.map((fdi) => (
        <ToothButton
          key={fdi}
          fdi={fdi}
          numbering={numbering}
          catalog={catalog}
          saved={byTooth.get(fdi)}
          pressed={selected === fdi}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function DentalChart({
  organizationId,
  patientId,
  canEdit,
}: {
  organizationId: number;
  patientId: number;
  canEdit: boolean;
}) {
  const path = `/api/organizations/${organizationId}/patients/${patientId}/chart`;
  const chartQuery = useApi<ChartResponse>(path);
  const chart = chartQuery.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [draftConditions, setDraftConditions] = useState<string[]>([]);
  const [draftNotes, setDraftNotes] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [planProcedure, setPlanProcedure] = useState('');
  const [planTooth, setPlanTooth] = useState('16');
  const [planFee, setPlanFee] = useState('');
  const saveTooth = useSubmit();
  const savePlan = useSubmit();

  const selectTooth = (fdi: string, source: ChartResponse | null = chart): void => {
    const saved = source?.teeth.find((tooth) => tooth.tooth === fdi);
    setSelected(fdi);
    setDraftConditions(saved?.conditions ?? []);
    setDraftNotes(saved?.notes ?? '');
  };

  if (chartQuery.status === 'loading' && chart === null) {
    return (
      <section className="card">
        <h2 className="card-title">Dental chart</h2>
        <LoadingState label="Loading dental chart…" />
      </section>
    );
  }
  if (chartQuery.status === 'error' && chart === null) {
    return (
      <section className="card">
        <h2 className="card-title">Dental chart</h2>
        <ErrorState message={chartQuery.error ?? 'The dental chart could not be loaded.'} onRetry={chartQuery.reload} />
      </section>
    );
  }
  if (chart === null) return null;

  const numbering = chart.numbering === 'UNIVERSAL' ? 'UNIVERSAL' : 'FDI';
  const byTooth = new Map(chart.teeth.map((tooth) => [tooth.tooth, tooth]));
  const marked = chart.teeth.some((tooth) => tooth.conditions.length > 0 || (tooth.notes !== null && tooth.notes !== ''));
  const selectedSaved = selected === null ? undefined : byTooth.get(selected);

  const persistTooth = async (): Promise<void> => {
    if (selected === null) return;
    setFlash(null);
    const ok = await saveTooth.submit(async () => {
      return apiFetch<{ tooth: ChartTooth }>(`${path}/teeth/${selected}`, {
        method: 'PUT',
        body: { conditions: draftConditions, notes: draftNotes },
      });
    });
    if (ok !== null) {
      setDraftConditions(ok.tooth.conditions ?? []);
      setDraftNotes(ok.tooth.notes ?? '');
      setFlash('Tooth chart saved.');
      chartQuery.reload();
    }
  };

  const addPlan = async (): Promise<void> => {
    setFlash(null);
    const ok = await savePlan.submit(async () => {
      await apiFetch(`/api/organizations/${organizationId}/patients/${patientId}/treatment-plan`, {
        method: 'POST',
        body: {
          tooth: planTooth,
          procedure: planProcedure,
          estimatedFee: planFee.trim() === '' ? null : planFee.trim(),
        },
      });
      return true;
    });
    if (ok !== null) {
      setPlanProcedure('');
      setPlanFee('');
      setFlash('Treatment plan item added.');
      chartQuery.reload();
    }
  };

  const setPlanStatus = async (item: PlanItem, status: 'PLANNED' | 'DONE'): Promise<void> => {
    setFlash(null);
    const ok = await savePlan.submit(async () => {
      await apiFetch(
        `/api/organizations/${organizationId}/patients/${patientId}/treatment-plan/${item.id}`,
        { method: 'PATCH', body: { status } },
      );
      return true;
    });
    if (ok !== null) {
      setFlash(status === 'DONE' ? 'Marked done.' : 'Moved back to planned.');
      chartQuery.reload();
    }
  };

  const removePlan = async (item: PlanItem): Promise<void> => {
    setFlash(null);
    const ok = await savePlan.submit(async () => {
      await apiFetch(
        `/api/organizations/${organizationId}/patients/${patientId}/treatment-plan/${item.id}`,
        { method: 'DELETE' },
      );
      return true;
    });
    if (ok !== null) {
      setFlash('Treatment plan item removed.');
      chartQuery.reload();
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Dental chart</h2>
      <p className="chart-numbering">
        Numbering: {numbering === 'FDI' ? 'FDI' : 'Universal (US)'}
        {canEdit ? (
          <>
            {' '}
            <Link to="/settings/clinic">Change in clinic profile</Link>
          </>
        ) : null}
      </p>
      {flash !== null ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
      {saveTooth.error !== null ? (
        <Flash kind="error" message={saveTooth.error} onDismiss={saveTooth.clearFeedback} />
      ) : null}
      {savePlan.error !== null ? (
        <Flash kind="error" message={savePlan.error} onDismiss={savePlan.clearFeedback} />
      ) : null}

      <div className="odontogram">
        <Arch
          label="Upper teeth"
          teeth={upperTeeth()}
          numbering={numbering}
          catalog={chart.conditions}
          byTooth={byTooth}
          selected={selected}
          onSelect={selectTooth}
        />
        <Arch
          label="Lower teeth"
          teeth={lowerTeethVisual()}
          numbering={numbering}
          catalog={chart.conditions}
          byTooth={byTooth}
          selected={selected}
          onSelect={selectTooth}
        />
      </div>

      {marked ? null : (
        <EmptyState
          title="No conditions recorded"
          description="Select a tooth to record caries, a filling, a crown, or another finding."
          preview={
            <p>
              <span className="badge badge-new">Sample</span> Example only — tooth 16 marked caries,
              with a note about the occlusal pit. Not saved data.
            </p>
          }
        />
      )}

      {selected === null ? (
        <p className="chart-hint">Select a tooth to see its conditions and notes.</p>
      ) : (
        <div className="tooth-editor">
          <h3 className="card-title">
            Tooth {displayTooth(selected, numbering)}
            <span className="chart-hint"> {toothSide(selected)}</span>
          </h3>
          {selectedSaved?.updatedBy !== null && selectedSaved?.updatedBy !== undefined ? (
            <p className="chart-hint">
              Last updated {formatDateTime(selectedSaved.updatedAt)} by {selectedSaved.updatedBy.email}
            </p>
          ) : null}
          <fieldset className="tooth-conditions">
            <legend>Conditions</legend>
            {chart.conditions.map((condition) => (
              <label key={condition.code} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draftConditions.includes(condition.code)}
                  disabled={!canEdit}
                  onChange={() => {
                    setDraftConditions((current) =>
                      current.includes(condition.code)
                        ? current.filter((code) => code !== condition.code)
                        : [...current, condition.code],
                    );
                  }}
                />
                {condition.label}
              </label>
            ))}
          </fieldset>
          <FormField label="Notes for this tooth">
            <textarea
              className="input"
              value={draftNotes}
              disabled={!canEdit}
              maxLength={2000}
              onChange={(event) => setDraftNotes(event.target.value)}
            />
          </FormField>
          {canEdit ? (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saveTooth.saving}
                onClick={() => void persistTooth()}
              >
                {saveTooth.saving ? 'Saving…' : 'Save tooth'}
              </button>
            </div>
          ) : (
            <p className="chart-hint">Only a clinic owner can update the chart.</p>
          )}
        </div>
      )}

      <h3 className="card-title">Chart history</h3>
      {chart.history.length === 0 ? (
        <EmptyState
          title="No chart history"
          description="Each saved change keeps the date and the person who recorded it."
          preview={
            <p>
              <span className="badge badge-new">Sample</span> Example only — 16 Mar, owner@clinic,
              tooth 36, filled and root canal. Not saved data.
            </p>
          }
        />
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Chart history">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Author</th>
                <th scope="col">Tooth</th>
                <th scope="col">Conditions</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {chart.history.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.author?.email ?? 'Unknown'}</td>
                  <td>{displayTooth(entry.tooth, numbering)}</td>
                  <td>{conditionLabels(entry.conditions, chart.conditions)}</td>
                  <td>{entry.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="card-title">Treatment plan</h3>
      {chart.treatmentPlan.length === 0 ? (
        <EmptyState
          title="No treatment plan"
          description="Add a procedure linked to a tooth, with a planned or done status and an estimated fee."
          preview={
            <p>
              <span className="badge badge-new">Sample</span> Example only — tooth 16, composite
              filling, planned, estimated fee 180. Not saved data.
            </p>
          }
        />
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Treatment plan">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Tooth</th>
                <th scope="col">Procedure</th>
                <th scope="col">Status</th>
                <th scope="col">Estimated fee</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {chart.treatmentPlan.map((item) => (
                <tr key={item.id}>
                  <td>{displayTooth(item.tooth, numbering)}</td>
                  <td>{item.procedure}</td>
                  <td>
                    <StatusBadge label={item.status} tone={item.status === 'DONE' ? 'success' : 'warn'} />
                  </td>
                  <td>{item.estimatedFee ?? '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canEdit && item.status === 'PLANNED' ? (
                      <button type="button" className="btn btn-secondary" onClick={() => void setPlanStatus(item, 'DONE')}>
                        Mark done
                      </button>
                    ) : null}{' '}
                    {canEdit && item.status === 'DONE' ? (
                      <button type="button" className="btn btn-secondary" onClick={() => void setPlanStatus(item, 'PLANNED')}>
                        Mark planned
                      </button>
                    ) : null}{' '}
                    {canEdit ? (
                      <button type="button" className="btn btn-danger" onClick={() => void removePlan(item)}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit ? (
        <form
          className="tooth-plan-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addPlan();
          }}
        >
          <h3 className="card-title">Add a planned procedure</h3>
          <div className="form-grid">
            <FormField label="Tooth">
              <select className="select" value={planTooth} onChange={(event) => setPlanTooth(event.target.value)}>
                {upperTeeth().concat(lowerTeethVisual()).map((fdi) => (
                  <option key={fdi} value={fdi}>
                    {displayTooth(fdi, numbering)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Procedure">
              <input
                className="input"
                value={planProcedure}
                onChange={(event) => setPlanProcedure(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Estimated fee" hint="Optional. Amount in the clinic's own currency.">
              <input
                className="input"
                inputMode="decimal"
                value={planFee}
                onChange={(event) => setPlanFee(event.target.value)}
              />
            </FormField>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={savePlan.saving || planProcedure.trim() === ''}>
              {savePlan.saving ? 'Adding…' : 'Add to plan'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
