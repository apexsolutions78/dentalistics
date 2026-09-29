import { Link } from 'react-router-dom';
import { FormField } from '../../components/FormField';

export function AutomationFields({
  enabled,
  channel,
  provider,
  onEnabled,
  onChannel,
  onProvider,
}: {
  enabled: boolean;
  channel: string;
  provider: string;
  onEnabled: (value: boolean) => void;
  onChannel: (value: string) => void;
  onProvider: (value: string) => void;
}) {
  return (
    <>
      <FormField label="Enabled">
        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
          This automation runs
        </label>
      </FormField>
      <div className="form-grid">
        <FormField label="Channel">
          <select className="select" value={channel} onChange={(e) => onChannel(e.target.value)}>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </FormField>
        <FormField label="Provider" hint="Delivery provider name configured for this deployment.">
          <input className="input" value={provider} onChange={(e) => onProvider(e.target.value)} />
        </FormField>
      </div>
    </>
  );
}

export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <FormField label={label} hint={hint}>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
    </FormField>
  );
}

export function TemplateLinkRow({
  to,
  slot,
  content,
}: {
  to: string;
  slot: string;
  content: string;
}) {
  return (
    <Link className="template-link" to={to}>
      <span className="slot">{slot}</span>
      <span className="snippet">{content || 'Empty template'}</span>
    </Link>
  );
}
