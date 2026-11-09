import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, ShieldAlert } from 'lucide-react';

import { useAsyncData } from '@/hooks/useAsyncData';
import { useNuiEvent } from '@/hooks/useNuiEvent';
import { EmptyState } from '@/ui/EmptyState';
import { Pill } from '@/ui/Pill';
import { Scroller } from '@/ui/Scroller';
import type { KatwarnAlert, KatwarnCategory } from './data';
import { mdtKatwarnCreate, mdtKatwarnList, mdtKatwarnResolve } from './mdtApi';
import { mdtPanePad, mdtRowMeta, mdtRowTitle, mdtSectionHeader } from './mdtTheme';
import { MdtButton } from './ui/MdtButton';
import { MdtField } from './ui/MdtField';
import { useMdtSession } from './useMdtSession';

const CATEGORY_LABEL: Record<KatwarnCategory, string> = {
    police: 'Polizeiwarnung',
    traffic: 'Verkehrswarnung',
    medical: 'Medizinische Warnung',
};

function dateLabel(value: string): string {
    if (!value) return '';
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function KatwarnPane() {
    const { department } = useMdtSession();
    const { data, loading, settled, refetch } = useAsyncData(mdtKatwarnList, []);
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [location, setLocation] = useState('');
    const [category, setCategory] = useState<KatwarnCategory>('police');

    useNuiEvent('sd-phone:mdt:katwarn', refetch);

    const state = data ?? { rows: [], canCreate: false, isAdmin: false, job: department?.job ?? '' };
    const options = useMemo(() => {
        if (state.isAdmin) return Object.keys(CATEGORY_LABEL) as KatwarnCategory[];
        if (state.job === 'lsmc') return ['medical'] as KatwarnCategory[];
        return ['police', 'traffic'] as KatwarnCategory[];
    }, [state.isAdmin, state.job]);

    async function publish() {
        if (busy) return;
        setBusy(true);
        setError('');
        const ok = await mdtKatwarnCreate({ title, message, location, category });
        setBusy(false);
        if (!ok) { setError('Die Warnung konnte nicht veröffentlicht werden. Bitte Eingaben und Berechtigung prüfen.'); return; }
        setTitle(''); setMessage(''); setLocation('');
        setCreating(false);
        refetch();
    }

    async function resolve(alert: KatwarnAlert) {
        if (busy) return;
        setBusy(true);
        setError('');
        const ok = await mdtKatwarnResolve(alert.id);
        setBusy(false);
        if (!ok) { setError('Die Warnung konnte nicht aufgelöst werden.'); return; }
        refetch();
    }

    if (creating) {
        return (
            <div className={`flex min-h-0 flex-1 flex-col ${mdtPanePad}`}>
                <div className="flex items-center gap-2 pb-3">
                    <h2 className="flex-1 text-[17px] font-semibold text-black dark:text-white">Neue KATWarn-Meldung</h2>
                    <MdtButton size="sm" variant="text" onClick={() => setCreating(false)}>Abbrechen</MdtButton>
                    <MdtButton size="sm" disabled={busy || title.trim().length < 3 || message.trim().length < 5} onClick={() => void publish()}>
                        Veröffentlichen
                    </MdtButton>
                </div>
                <Scroller className="min-h-0 flex-1">
                    <div className="flex flex-col gap-3 pb-5">
                        <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ios-gray">
                            Kategorie
                            <select value={category} onChange={e => setCategory(e.target.value as KatwarnCategory)}
                                className="h-11 rounded-xl border border-black/10 bg-white px-3 text-[14px] text-black outline-none dark:border-white/10 dark:bg-white/5 dark:text-white">
                                {options.map(value => <option key={value} value={value}>{CATEGORY_LABEL[value]}</option>)}
                            </select>
                        </label>
                        <MdtField label="Titel" value={title} onChange={setTitle} maxLength={120} placeholder="Kurze, eindeutige Überschrift" />
                        <MdtField multiline rows={6} label="Meldung" value={message} onChange={setMessage} maxLength={2000} placeholder="Was ist passiert? Welche Hinweise sind wichtig?" />
                        <MdtField label="Ort (optional)" value={location} onChange={setLocation} maxLength={160} placeholder="z. B. Legion Square" />
                        {error && <p className="text-[12px] text-ios-red">{error}</p>}
                    </div>
                </Scroller>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-4">
                <div className="flex-1">
                    <h2 className="text-[17px] font-semibold text-black dark:text-white">KATWarn</h2>
                    <p className={mdtRowMeta}>Zentrale Warnmeldungen für alle Spieler</p>
                </div>
                {state.canCreate && (
                    <MdtButton size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => {
                        setCategory(options[0] ?? 'police'); setError(''); setCreating(true);
                    }}>Neue Warnung</MdtButton>
                )}
            </div>
            {error && <p className="px-4 pb-2 text-[12px] text-ios-red">{error}</p>}
            <Scroller className="min-h-0 flex-1 px-4 pb-5">
                {loading && !settled ? (
                    <div className="py-10 text-center text-[13px] text-ios-gray">Warnmeldungen werden geladen …</div>
                ) : state.rows.length === 0 ? (
                    <EmptyState center icon={ShieldAlert} title="Keine Warnmeldungen" subtitle="Aktive und erledigte KATWarn-Meldungen erscheinen hier." />
                ) : (
                    <div className="flex flex-col gap-3">
                        {state.rows.map(alert => {
                            const canResolve = state.isAdmin || alert.issuer_job === state.job;
                            return (
                                <article key={alert.id} className="rounded-2xl border border-black/[0.08] bg-white/75 p-3.5 dark:border-white/[0.09] dark:bg-white/[0.04]">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4 shrink-0 text-ios-orange" />
                                        <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-ios-gray">{CATEGORY_LABEL[alert.category]}</span>
                                        <Pill tone={alert.status === 'active' ? 'orange' : 'green'}>{alert.status === 'active' ? 'Aktiv' : 'Erledigt'}</Pill>
                                    </div>
                                    <h3 className={`mt-2 ${mdtRowTitle}`}>{alert.title}</h3>
                                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-black/80 dark:text-white/80">{alert.message}</p>
                                    {alert.location && <p className="mt-2 text-[12px] font-medium text-ios-gray">Ort: {alert.location}</p>}
                                    <div className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 ${mdtRowMeta}`}>
                                        <span>{alert.issuer_name}</span><span>·</span><span>{alert.issuer_job.toUpperCase()}</span><span>·</span><span>{dateLabel(alert.created_at)}</span>
                                    </div>
                                    {alert.status === 'resolved' && alert.resolved_by && (
                                        <div className="mt-1 text-[11px] text-ios-gray">Erledigt von {alert.resolved_by}{alert.resolved_at ? ` · ${dateLabel(alert.resolved_at)}` : ''}</div>
                                    )}
                                    {alert.status === 'active' && canResolve && (
                                        <div className="mt-3 flex justify-end">
                                            <MdtButton size="sm" variant="text" disabled={busy} icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => void resolve(alert)}>
                                                Als erledigt markieren
                                            </MdtButton>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}
            </Scroller>
        </div>
    );
}
