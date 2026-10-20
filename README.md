<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="112" alt="Ikon PoinTify: Pip, huruf P dengan mata dan titik bercahaya">

# PoinTify

**Asisten kecil yang tinggal di atas layar Windows.**
Notch ala Dynamic Island dengan musik dan lirik sinkron, timer fokus, pengingat minum, rak file, dan chat langsung sama Claude buat ngerjain project.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

</div>

---

## Kenalan sama Pip

Maskot PoinTify namanya **Pip**: huruf P yang hidup. Titik bercahaya di sampingnya itu unsur **"point"**, dan pas ada yang perlu lu tahu, titik itu berubah jadi badge notifikasi yang lompat-lompat, itu unsur **"tify"**.

Pip digerakin mesin animasi kecil buatan sendiri ([`src/pip/engine.ts`](src/pip/engine.ts)), tanpa gambar, Lottie, atau library animasi. Tiap bagian badannya (gepeng, miring, lompat, arah mata, kelopak, posisi titik) pakai simulasi pegas, jadi gerakannya mantul dan nyambung, bukan animasi yang diulang-ulang.

- **Ngikutin kursor.** Rust ngirim posisi kursor global, jadi mata Pip ngelirik ke mana pun kursor lu di layar, badannya ikut condong dikit.
- **Bisa diajak main.** Klik sekali dia kesel, klik dua kali dia dadah, klik tiga kali cepet dia pusing. Tahan kursor di atasnya dua detik, matanya jadi hati.
- **Hidup sendiri.** Ngedip di waktu acak, lirik kanan-kiri, ngulet, mainin titiknya sendiri, dan nguap kalau lama didiemin.
- **Ekspresi per keadaan.** Santai, nyapa, mikir (titiknya muter), kerja, ngasih tahu, senang pas tugas beres, nunggu file, goyang ngikutin ketukan pas musik diputer, error, dan tidur.

## Fitur

| Fitur | Yang terjadi |
|---|---|
| **Notch** | Pil hitam di tengah atas layar. Arahin kursor ke sana, dia melebar. Klik di luar atau tekan `Esc` buat nutup. Area di sekitarnya tembus klik, jadi nggak ngalangin app lain. |
| **Musik + lirik** | Baca lagu dari kontrol media Windows (Spotify, YouTube di browser, dll): cover, judul, artis, progress yang bisa diklik buat lompat, tombol putar. Lirik sinkron dari [LRCLIB](https://lrclib.net) jalan ngikutin lagu. |
| **Chat dengan Claude** | Ngobrol sama Claude langsung dari notch lewat Claude Code, pakai login langganan Claude lu. Mode **Ngobrol** (cuma baca, buat brainstorm) dan **Kerjain** (boleh ngedit file di folder project). Pilih Opus, Sonnet, atau Haiku. Sesi bisa dilanjutin di Claude Desktop. |
| **Sesi Claude Code** | Sesi `claude` yang lu jalanin di terminal mana aja muncul di tab Sesi: prompt, file yang dibaca dan diedit (+baris −baris), perintah yang dijalanin. Pas Claude minta izin, kartu nyembul dari notch dengan pilihan Izinin, Selalu, Tolak, atau jawab di terminal. Pertanyaan pilihan ganda dari Claude juga bisa dijawab dari notch. Pas sesi beres, Pip lompat senang. |
| **Progres chat Claude** | Kerjaan yang lagi dikerjain Claude di app Claude (chat yang nyambung ke PC) ikut kepantau: judul tugas, langkah ke berapa, dan notif pas Claude beres atau butuh jawaban. Claude nulis kabar kecil ke `~/.pointify/feed`, PoinTify mantau folder itu. |
| **Rak file** | Drag file ke notch buat disimpan sementara, drag keluar lagi ke app lain, atau lampirin ke chat Claude. |
| **Timer fokus** | Pomodoro lengkap: fokus, istirahat pendek, istirahat panjang, statistik harian. Hitung mundurnya keliatan di notch kecil. |
| **Pengingat minum** | Pip nyembul dari notch tiap sekian menit, ngitung gelas harian, cuma di jam aktif yang lu atur. |
| **Lain-lain** | Sembunyi otomatis pas ada app fullscreen, ikon di system tray, shortcut global `Ctrl+Alt+P` buat buka chat, jalan otomatis pas Windows nyala, suara orisinal yang dibikin pakai Web Audio. |

## Arsitektur

```
src/                      React + TypeScript (tampilan)
├── island/               Notch: keadaan kecil, peek, kebuka + tab
│   └── tabs/             Beranda, Chat, Sesi, Rak, Fokus
├── settings/             Jendela pengaturan
├── pip/                  Mesin animasi Pip (pegas, ekspresi, partikel)
├── components/           Pembungkus React buat Pip, ikon, ring progres
├── state/                Store kecil per fitur (tanpa library state)
└── lib/                  Pembungkus command Tauri, suara, markdown

src-tauri/src/            Rust (backend)
├── island.rs             Posisi notch, click-through, deteksi hover & app fullscreen
├── media.rs              Kontrol media Windows (SMTC) lewat crate `windows`
├── lyrics.rs             Lirik LRCLIB + parser LRC + cache
├── claude.rs             Menjalankan `claude -p` dan meneruskan aliran JSON-nya
├── agents.rs             Server lokal buat hooks: sesi terminal, izin, pertanyaan
├── hook_relay.rs         `pointify.exe --hook`: oper kejadian hook ke PoinTify
├── claude_hooks.rs       Pasang/copot hooks di ~/.claude/settings.json
├── feed.rs               Pantau ~/.pointify/feed buat progres chat Claude
├── shelf.rs              Rak file (disimpan sebagai JSON)
├── settings.rs           Pengaturan, autostart, shortcut global
└── tray.rs               Menu system tray
```

Beberapa keputusan teknis yang menarik:

- **Click-through yang tetap bisa di-hover.** Jendela notch selalu tembus klik. Thread Rust ngecek posisi kursor tiap 30 ms dan baru "nangkep" mouse kalau kursor masuk area pulau. Frontend ngirim ukuran pulau terbaru tiap bentuknya berubah.
- **Posisi lagu tanpa polling berat.** Windows cuma ngasih posisi lagu pas ada kejadian (play, pause, seek). PoinTify nyimpen posisi terakhir plus kapan diambil, lalu ngitung sendiri posisi sekarang di frontend.
- **Chat lewat Claude Code, bukan API key.** `claude -p --output-format stream-json` dijalankan di folder project. Prompt dikirim lewat stdin biar aman dari urusan tanda kutip, dan proses dihentikan pakai `taskkill /T` supaya anak prosesnya ikut berhenti.

- **Hooks yang nggak pernah ngeganggu.** Claude Code menjalankan `pointify.exe --hook` di tiap kejadian. Exe yang sama dipakai sebagai relay: dia keluar sebelum aplikasi Tauri dibikin, ngoper datanya lewat socket lokal (127.0.0.1 plus token acak), dan selalu keluar dengan kode 0. Kalau PoinTify lagi mati, relay langsung keluar tanpa output, jadi Claude Code jalan seperti biasa. Permintaan izin ditahan sampai dijawab di notch, dan kalau prosesnya dibatalin dari terminal, kartunya ikut hilang.

## Menjalankan

Yang dibutuhkan: [Node.js](https://nodejs.org), [Rust](https://rustup.rs), dan Microsoft C++ Build Tools (workload *Desktop development with C++*).

```powershell
npm install
npm run tauri dev
```

Bikin installer:

```powershell
npm run tauri build
```

### Chat dengan Claude

Fitur chat butuh [Claude Code](https://code.claude.com/docs/en/setup) dan langganan Claude (Pro, Max, Team, atau Enterprise):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Setelah itu buka tab Chat di PoinTify dan ikutin langkah login-nya.

## Terima kasih

- [Coucou](https://github.com/Louis-CFM/coucou) sebagai inspirasi pola notch di Windows. PoinTify nggak memakai nama, karakter, ikon, maupun suara Coucou.
- [LRCLIB](https://lrclib.net) untuk lirik sinkron.
- [Tauri](https://tauri.app) dan crate [`windows`](https://github.com/microsoft/windows-rs).
