import { useEffect } from "react";
import { Icon, type IconName } from "../components/Icon";
import { useStore } from "../lib/store";
import { useSysStats, liveStore, pipConditionStore, type LiveInfo } from "./data";
import { widgetStore } from "./layout";
import { widgetDef } from "./registry";

/**
 * Pemantau widget yang jalan terus walau notch lagi kecil: hitung mundur,
 * jadwal sholat, usage Claude, sistem. Mereka ngelapor ke liveStore, notch
 * kecil nampilin yang paling penting.
 */
export function LiveProbes() {
  const layout = useStore(widgetStore);
  return (
    <>
      {layout.items.map((item) => {
        const L = widgetDef(item.type)?.Live;
        return L ? <L key={item.id} item={item} size={item.size} /> : null;
      })}
      <PipConditions />
    </>
  );
}

/** CPU panas → Pip keringetan; baterai sekarat → Pip lemes. Cek tiap 5 detik. */
function PipConditions() {
  const sys = useSysStats(5000).data;
  const hot = !!sys && sys.cpu >= 85;
  const tired = !!sys?.battery && sys.battery.percent <= 15 && !sys.battery.charging;
  useEffect(() => {
    const c = pipConditionStore.get();
    if (c.hot !== hot || c.tired !== tired) pipConditionStore.set({ ...c, hot, tired });
  }, [hot, tired]);
  return null;
}

/** Info Live paling penting dari widget yang Live-nya dinyalain. */
export function useTopLive(): (LiveInfo & { id: string }) | null {
  const live = useStore(liveStore);
  const layout = useStore(widgetStore);
  let best: (LiveInfo & { id: string }) | null = null;
  for (const item of layout.items) {
    const info = item.live ? live[item.id] : undefined;
    if (info && (!best || info.priority > best.priority)) best = { ...info, id: item.id };
  }
  return best;
}

export function LiveActivity({ info }: { info: LiveInfo }) {
  return (
    <span className={`compact-live${info.tone ? ` ${info.tone}` : ""}`}>
      <Icon name={info.icon as IconName} size={14} />
      <span className="compact-project ellipsis">{info.label}</span>
      <b className="tabular">{info.value}</b>
    </span>
  );
}
