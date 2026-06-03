# Flow Auto Prompter

**Flow Auto Prompter** adalah ekstensi Google Chrome (Manifest V3) yang dirancang khusus untuk mengotomatisasi pengiriman prompt massal (bulk prompting), konfigurasi parameter, dan pengunduhan hasil gambar secara otomatis pada platform **Google Flow** (`labs.google/fx/tools/flow`). 

Ekstensi ini menggunakan **Chrome DevTools Protocol (CDP)** untuk mensimulasikan interaksi klik dan pengetikan yang sangat presisi guna melewati batasan event handler sintetis React dan Radix UI, menjamin keandalan 100% dibandingkan dengan simulasi event JavaScript standar.

---

## 🚀 Fitur Utama

1. **Simulasi CDP Presisi Tinggi**: Clicks dan keypress dikirim langsung melalui protokol debugger Chrome ke koordinat elemen yang tepat setelah discroll ke tengah viewport. Bebas dari masalah *untracked state* pada React.
2. **Siklus Automasi End-to-End**:
   - Membuka menu pengaturan secara otomatis (menghindari overlay tombol "Agent").
   - Mengatur parameter *Aspect Ratio*, *Batch Size*, dan *Model Selection* sesuai pilihan pengguna.
   - Memasukkan prompt dari antrean ke area teks input.
   - Melakukan submit prompt dan menunggu proses rendering selesai.
   - Memantau rendering resolusi tinggi menggunakan *CSS Paint Observer* (bebas delay statis).
   - Membuka context menu Radix UI dan mengunduh gambar hasil generasi secara otomatis.
3. **Pacing / Jeda Istirahat yang Fleksibel**: Menyediakan konfigurasi jeda waktu (Rest/Delay) antar generasi untuk mensimulasikan aktivitas manusia dan menghindari rate limit. Tombol "Stop" responsif langsung membatalkan jeda tanpa hambatan.
4. **Safety Net (Jaring Pengaman)**: Jika terjadi kegagalan elemen atau timeout selama automasi, prompt yang gagal akan dipindahkan ke kotak khusus "Failed / Skipped Prompts" dan halaman akan dimuat ulang secara otomatis untuk memulihkan keadaan.
5. **UI Premium Glassmorphism**: Desain side-panel modern bergaya gelap (dark mode) dengan efek kaca buram (*glassmorphism*) yang menyatu secara visual dengan ekosistem Google Flow.

---

## 🛠️ Arsitektur Proyek

Proyek ini terdiri dari 5 berkas utama:

*   **`manifest.json`**: Berkas manifes MV3 yang menyatakan izin ekstensi (`storage`, `sidePanel`, `activeTab`, `scripting`, `debugger`) dan membatasi host-permission hanya pada Google Labs (`*://labs.google/*`).
*   **`background.js`**: Service worker yang bertindak sebagai jembatan CDP. Bertugas mengaktifkan/menonaktifkan protokol debugger versi 1.3 pada tab target, serta mengirim command `Input.dispatchMouseEvent` untuk klik koordinat dan `Input.insertText` untuk pengetikan teks.
*   **`content.js`**: Mesin otomatisasi inti yang berjalan di halaman web Google Flow. Melakukan pencarian elemen menggunakan XPath, memicu perintah CDP via background script, mengamati transisi CSS blur/opacity gambar, serta mengelola state antrean prompt di memori.
*   **`panel.html`**: Antarmuka side-panel ekstensi yang dibangun menggunakan font modern *Outfit* dari Google Fonts dengan palet warna HSL elegan, metrik realtime (Queued, Completed, Failed), dan form pengaturan.
*   **`panel.js`**: Pengendali side-panel yang mengelola sinkronisasi data dengan `chrome.storage.local`, validasi antrean teks prompt, penanganan tombol Start/Stop, dan komunikasi status realtime dengan content script.

---

## 📥 Panduan Instalasi Ekstensi

Untuk memasang ekstensi ini secara lokal di peramban Google Chrome:

1. Unduh atau salin seluruh folder proyek ini (`Flow Auto Prompter`) ke komputer Anda.
2. Buka Google Chrome dan navigasikan ke alamat `chrome://extensions/`.
3. Di sudut kanan atas halaman, aktifkan mode pengembang dengan menggeser tombol **"Developer mode"** ke posisi **On**.
4. Klik tombol **"Load unpacked"** di sudut kiri atas.
5. Pilih folder proyek `Flow Auto Prompter` yang berisi berkas `manifest.json`.
6. Ekstensi **Flow Auto Prompter** sekarang akan aktif dan muncul di daftar ekstensi Anda.

---

## 🕹️ Cara Penggunaan

1. Buka tab baru di Chrome dan masuk ke Google Flow: `https://labs.google/fx/tools/flow`.
2. Klik ikon ekstensi **Flow Auto Prompter** pada toolbar Chrome Anda (atau sematkan terlebih dahulu) untuk membuka panel samping (Side Panel).
3. Di dalam panel samping:
   - Masukkan daftar prompt Anda pada kolom **Prompts Queue** (satu prompt per baris).
   - Sesuaikan parameter *Aspect Ratio*, *Batch Size*, *Model*, dan *Rest Delay*.
4. Klik tombol **Start Automation**.
5. Sistem akan otomatis memasang debugger Chrome. Bar peringatan bawaan Chrome (*"Flow Auto Prompter started debugging this browser"*) akan muncul di bagian atas layar—ini adalah perilaku keamanan normal dari Chrome CDP.
6. Proses otomatisasi akan berjalan secara in-memory tanpa memuat ulang halaman secara paksa di setiap iterasi. Anda dapat memantau statistiknya di bagian **Execution Metrics**.
7. Jika Anda ingin menghentikan otomatisasi, klik tombol **Stop Automation** kapan saja. Kontrol debugger akan terlepas secara instan.

---

## ⚠️ Catatan Penting & Troubleshooting

*   **Peringatan Debugger Chrome**: Bar peringatan di atas layar wajib muncul karena ekstensi mengakses API debugger tingkat rendah untuk akurasi event. Jangan klik "Cancel" pada bar tersebut selama otomatisasi berjalan, atau koneksi CDP akan terputus.
*   **Kehilangan Koneksi Panel Samping**: Jika Anda tidak sengaja menutup panel samping selama otomatisasi berjalan, loop otomatisasi di halaman web tetap akan menyelesaikan antrean dengan aman tanpa menimbulkan error crash pada konsol browser.
*   **Pemulihan Otomatis**: Jika elemen Google Flow lambat dimuat atau struktur DOM berubah sementara, sistem akan menunggu hingga batas waktu tertentu (timeout). Jika tetap gagal, sistem akan mencatat prompt tersebut ke daftar *Failed*, melepaskan debugger, dan memuat ulang halaman (`window.location.reload()`) sebelum otomatis menyambung kembali dan melanjutkan prompt berikutnya.
