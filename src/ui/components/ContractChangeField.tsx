import { startOfMonth } from 'date-fns';
import {
  contractChanged,
  describeContract,
  removeContractPeriod,
} from '../../domain/contract-change';
import type { Employment } from '../../domain/employment';
import { formatDate, fromDateInput, toDateInput } from '../../domain/time';

/**
 * Vertrag gueltig ab (AUF-032): Aendern sich Wochenstunden oder Arbeitstage, fragt das Formular,
 * ab wann die Aenderung gilt -- oder ob sie eine Korrektur von Beginn an ist. Darunter die
 * frueheren Vertragsstaende zum Entfernen.
 */
export function ContractChangeField({
  saved,
  draft,
  ab,
  onAb,
  onDraft,
}: {
  saved: Employment | undefined;
  draft: Employment;
  ab: number | null;
  onAb: (next: number | null) => void;
  onDraft: (next: Employment) => void;
}) {
  const geaendert = saved !== undefined && contractChanged(saved, draft);
  const historie = draft.contractHistory ?? [];
  if (!geaendert && historie.length === 0) return null;
  return (
    <>
      {geaendert && (
        <>
          <p className="muted small">Wochenstunden oder Arbeitstage geaendert. Ab wann gilt das?</p>
          <label className="field">
            <span>Gilt ab</span>
            <input
              type="date"
              value={ab === null ? '' : toDateInput(ab)}
              disabled={ab === null}
              onChange={(e) => {
                const t = fromDateInput(e.target.value);
                if (!Number.isNaN(t)) onAb(t);
              }}
            />
          </label>
          <label className="field row">
            <span>Korrektur: gilt von Beginn an</span>
            <input
              type="checkbox"
              checked={ab === null}
              onChange={(e) => onAb(e.target.checked ? null : startOfMonth(Date.now()).getTime())}
            />
          </label>
        </>
      )}
      {historie.length > 0 && (
        <>
          <p className="muted small">Fruehere Vertragsstaende</p>
          <ul className="vac-list">
            {historie.map((c) => (
              <li key={c.validUntil}>
                <span>
                  bis {formatDate(c.validUntil)}: {describeContract(c)}
                </span>
                <button
                  className="link-btn danger"
                  type="button"
                  onClick={() =>
                    onDraft({
                      ...draft,
                      contractHistory: removeContractPeriod(draft.contractHistory, c.validUntil),
                    })
                  }
                >
                  entfernen
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
