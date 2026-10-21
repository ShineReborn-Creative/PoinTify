import type { PipMood } from "../components/Pip";
import { tr } from "../i18n";
import { api } from "../lib/api";
import { createStore } from "../lib/store";
import { collapse, dismissPeek, islandStore, showPeek } from "../state/island";
import { settingsStore, updateSettings } from "../state/settings";

/**
 * Tour perkenalan: Pip ngenalin fitur yang nggak keliatan (gestur, Pip
 * desktop, Rak, dll) lewat kartu yang nyembul dari notch. Muncul sekali
 * pas pertama buka, bisa diulang dari Pengaturan › Umum.
 */

export type TourAction = { label: string; primary?: boolean; run: () => void };
export type TourStep = { title: string; body: string; mood: PipMood; actions?: TourAction[] };

/** Langkah ke berapa (null = tour lagi nggak jalan). */
export const tourStore = createStore<number | null>(null);

export function tourSteps(): TourStep[] {
  const petOn = settingsStore.get()?.petMode ?? false;
  return [
    {
      title: tr("Halo, gue Pip! 👋", "Hi, I'm Pip! 👋"),
      body: tr(
        "Gue maskot PoinTify. Mau gue ajak keliling bentar? Cuma semenit kok.",
        "I'm PoinTify's mascot. Want a quick tour? It only takes a minute.",
      ),
      mood: "wave",
      actions: [
        { label: tr("Nanti aja", "Maybe later"), run: () => finishTour() },
        { label: tr("Gas!", "Let's go!"), primary: true, run: () => nextStep() },
      ],
    },
    {
      title: tr("Ini notch lu", "This is your notch"),
      body: tr(
        "Abis tour ini, arahin kursor ke sini dan notch kebuka sendiri. Isinya widget, musik, chat, Rak, sama timer fokus.",
        "After this tour, hover here and the notch opens by itself. Inside: widgets, music, chat, the Shelf, and a focus timer.",
      ),
      mood: "idle",
    },
    {
      title: tr("Geser & atur sesuka lu", "Move it, arrange it"),
      body: tr(
        "Seret notch ke kanan-kiri buat mindahin. Pas kebuka, klik ikon kotak-kotak buat nambah dan nyusun widget.",
        "Drag the notch left or right to move it. When it's open, click the grid icon to add and arrange widgets.",
      ),
      mood: "happy",
    },
    {
      title: tr("Rak file", "The Shelf"),
      body: tr(
        "Seret file atau folder ke notch, nanti disimpen di Rak. Tinggal seret keluar lagi pas butuh.",
        "Drag files or folders onto the notch to keep them on the Shelf. Drag them back out when you need them.",
      ),
      mood: "listening",
    },
    {
      title: tr("Gue bisa keluar dari notch!", "I can leave the notch!"),
      body: tr(
        "Tarik gue ke bawah dari notch, gue bakal tinggal di desktop lu: jalan-jalan, nangkring di jendela, ngobrol.",
        "Drag me down out of the notch and I'll live on your desktop: wandering, perching on windows, chatting.",
      ),
      mood: "wave",
      actions: petOn
        ? undefined
        : [
            { label: tr("Lewati", "Skip"), run: () => nextStep() },
            {
              label: tr("Keluarin Pip", "Let Pip out"),
              primary: true,
              run: () => {
                updateSettings({ petMode: true });
                nextStep();
              },
            },
          ],
    },
    {
      title: tr("Ajak gue main", "Play with me"),
      body: tr(
        "Lempar gue, gosok kursor di atas gue buat ngelus, klik kanan buat menu, atau seret file ke gue buat dimakan.",
        "Throw me, rub the cursor over me to pet me, right-click for a menu, or drag a file onto me to feed me.",
      ),
      mood: "happy",
    },
    {
      title: tr("Gue ikut kegiatan lu", "I join in on what you do"),
      body: tr(
        "Joget pas lu muter lagu, ngemil popcorn pas nonton, pake ikat kepala pas fokus, buka laptop pas lu ngetik.",
        "I dance when you play music, snack on popcorn when you watch, wear a headband when you focus, and type along with you.",
      ),
      mood: "music",
    },
    {
      title: tr("Claude itu opsional", "Claude is optional"),
      body: tr(
        "Punya langganan Claude? Pasang Claude Code buat chat dan pantau sesi dari notch. Fitur lain jalan tanpa Claude.",
        "Have a Claude subscription? Install Claude Code to chat and monitor sessions from the notch. Everything else works without it.",
      ),
      mood: "thinking",
    },
    {
      title: tr("Udah, selamat nyoba! 🎉", "That's it, have fun! 🎉"),
      body: tr(
        "Pengaturan ada di ikon gerigi atau klik kanan ikon tray. Tour ini bisa diulang dari Pengaturan › Umum.",
        "Settings live behind the gear icon or the tray icon's menu. Replay this tour from Settings › General.",
      ),
      mood: "happy",
      actions: [
        {
          label: tr("Buka pengaturan", "Open settings"),
          run: () => {
            finishTour();
            void api.settingsOpen();
          },
        },
        { label: tr("Selesai", "Done"), primary: true, run: () => finishTour() },
      ],
    },
  ];
}

function showStep() {
  const i = tourStore.get();
  if (i === null) return;
  const step = tourSteps()[i];
  if (!step) return;
  showPeek({ kind: "tour", title: step.title, body: step.body, mood: step.mood }, { force: true });
}

export function startTour() {
  collapse();
  tourStore.set(0);
  showStep();
}

export function nextStep() {
  const i = tourStore.get();
  if (i === null) return;
  if (i + 1 >= tourSteps().length) return finishTour();
  tourStore.set(i + 1);
  showStep();
}

export function prevStep() {
  const i = tourStore.get();
  if (!i) return;
  tourStore.set(i - 1);
  showStep();
}

export function finishTour() {
  tourStore.set(null);
  if (islandStore.get().peek?.kind === "tour") dismissPeek();
  updateSettings({ tourDone: true });
}

// Notch sempet kebuka (atau kartu lain nyelak) pas tour jalan: begitu
// balik kecil lagi, kartu tour-nya dimunculin lagi di langkah yang sama.
let resumeTimer: number | undefined;
islandStore.subscribe(() => {
  const s = islandStore.get();
  if (tourStore.get() === null || s.mode !== "compact") return;
  window.clearTimeout(resumeTimer);
  resumeTimer = window.setTimeout(() => {
    if (tourStore.get() !== null && islandStore.get().mode === "compact") showStep();
  }, 500);
});
