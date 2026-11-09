import { useState } from 'react';
import { Radio, RefreshCw, Users } from 'lucide-react';

import { useAsyncData } from '@/hooks/useAsyncData';
import { useNuiEvent } from '@/hooks/useNuiEvent';
import { EmptyState } from '@/ui/EmptyState';
import { Scroller } from '@/ui/Scroller';
import type { RadioOfficer } from './data';
import { mdtRadioList, mdtRadioMove } from './mdtApi';
import { mdtRowMeta, mdtRowTitle } from './mdtTheme';
import { MdtButton } from './ui/MdtButton';

export function RadioPane() {
    const { data, loading, settled, refetch } = useAsyncData(mdtRadioList, []);
    const [targetChannels, setTargetChannels] = useState<Record<number, number>>({});
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState('');

    useNuiEvent('sd-phone:mdt:radio', refetch);

    async function move(officer: RadioOfficer) {
        const channel = targetChannels[officer.source] ?? 1;
        if (busy !== null) return;
        setBusy(officer.source);
        setError('');
        const ok = await mdtRadioMove(officer.source, channel);
        setBusy(null);
        if (!ok) { setError('Officer konnte nicht umgesetzt werden. Berechtigung und Funkverbindung prüfen.'); return; }
        refetch();
    }

    const channels = data?.channels ?? [];
    const total = channels.reduce((sum, channel) => sum + channel.officers.length, 0);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-4">
                <div className="flex-1">
                    <h2 className="text-[17px] font-semibold text-black dark:text-white">Funkübersicht</h2>
                    <p className={mdtRowMeta}>pma-voice · Kanäle 1–100 · {total} verbundene Officers</p>
                </div>
                <MdtButton size="sm" variant="text" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Aktualisieren</MdtButton>
            </div>
            {error && <p className="px-4 pb-2 text-[12px] text-ios-red">{error}</p>}
            {!data?.enabled && settled ? (
                <EmptyState center icon={Radio} title="pma-voice nicht verfügbar" subtitle="Starte pma-voice, damit die Funkkanäle angezeigt werden können." />
            ) : loading && !settled ? (
                <div className="py-10 text-center text-[13px] text-ios-gray">Funkkanäle werden geladen …</div>
            ) : (
                <Scroller className="min-h-0 flex-1 px-4 pb-5">
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                        {channels.map(channel => (
                            <section key={channel.channel} className="rounded-xl border border-black/[0.08] bg-white/75 p-3 dark:border-white/[0.09] dark:bg-white/[0.04]">
                                <div className="mb-2 flex items-center gap-2">
                                    <Radio className="h-4 w-4 text-ios-blue" />
                                    <h3 className={mdtRowTitle}>Kanal {channel.channel}</h3>
                                    <span className="ml-auto flex items-center gap-1 text-[11px] text-ios-gray"><Users className="h-3.5 w-3.5" />{channel.officers.length}</span>
                                </div>
                                {channel.officers.length === 0 ? (
                                    <p className="py-1 text-[12px] text-ios-gray">Keine Officers verbunden</p>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {channel.officers.map(officer => (
                                            <div key={officer.source} className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-2 dark:border-white/[0.07]">
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-[13px] font-medium text-black dark:text-white">{officer.callsign ? officer.callsign + ' · ' : ''}{officer.name}</p>
                                                    <p className={mdtRowMeta}>{officer.job.toUpperCase()} · ID {officer.source}</p>
                                                </div>
                                                {data?.canManage && (
                                                    <>
                                                        <select aria-label="Zielkanal" value={targetChannels[officer.source] ?? channel.channel}
                                                            onChange={e => setTargetChannels(old => ({ ...old, [officer.source]: Number(e.target.value) }))}
                                                            className="h-9 rounded-lg border border-black/10 bg-white px-2 text-[12px] text-black dark:border-white/10 dark:bg-white/5 dark:text-white">
                                                            {channels.map(item => <option key={item.channel} value={item.channel}>Kanal {item.channel}</option>)}
                                                        </select>
                                                        <MdtButton size="sm" disabled={busy !== null || (targetChannels[officer.source] ?? channel.channel) === channel.channel}
                                                            onClick={() => void move(officer)}>Umsetzen</MdtButton>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        ))}
                    </div>
                </Scroller>
            )}
        </div>
    );
}
