//! Data buat widget Sistem: CPU, RAM, disk, baterai, kecepatan internet,
//! plus tombol cepat (volume, mic). Semua lewat API Windows langsung, tanpa
//! library tambahan, dan cuma dihitung pas frontend minta.

use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use tauri::State;

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub percent: u8,
    pub charging: bool,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SysStats {
    /// 0..100
    pub cpu: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_free: u64,
    pub disk_total: u64,
    pub battery: Option<Battery>,
    /// Byte per detik.
    pub net_down: u64,
    pub net_up: u64,
}

#[derive(Default)]
struct Prev {
    cpu: Option<(u64, u64)>,
    net: Option<(u64, u64, Instant)>,
}

#[derive(Default)]
pub struct SysState(Mutex<Prev>);

#[cfg(windows)]
mod imp {
    use super::{Battery, Prev, SysStats};
    use std::time::Instant;
    use windows::{
        core::w,
        Win32::{
            Foundation::FILETIME,
            NetworkManagement::{
                IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2},
                Ndis::IfOperStatusUp,
            },
            Storage::FileSystem::GetDiskFreeSpaceExW,
            System::{
                Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
                SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
                Threading::GetSystemTimes,
            },
        },
    };

    fn ft(f: FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    pub fn read(prev: &mut Prev) -> SysStats {
        let mut s = SysStats::default();
        unsafe {
            // CPU: selisih waktu idle vs total sejak panggilan sebelumnya.
            let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
            if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_ok() {
                let idle = ft(idle);
                let total = ft(kernel) + ft(user);
                if let Some((pi, pt)) = prev.cpu {
                    let dt = total.saturating_sub(pt);
                    let di = idle.saturating_sub(pi);
                    if dt > 0 {
                        s.cpu = (100.0 * (1.0 - di as f64 / dt as f64)).clamp(0.0, 100.0) as f32;
                    }
                }
                prev.cpu = Some((idle, total));
            }

            let mut mem = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
            if GlobalMemoryStatusEx(&mut mem).is_ok() {
                s.mem_total = mem.ullTotalPhys;
                s.mem_used = mem.ullTotalPhys.saturating_sub(mem.ullAvailPhys);
            }

            let (mut free, mut total) = (0u64, 0u64);
            if GetDiskFreeSpaceExW(w!("C:\\"), Some(&mut free), Some(&mut total), None).is_ok() {
                s.disk_free = free;
                s.disk_total = total;
            }

            let mut power = SYSTEM_POWER_STATUS::default();
            // 255 = nggak ada baterai (PC desktop) atau nggak diketahui.
            if GetSystemPowerStatus(&mut power).is_ok() && power.BatteryLifePercent != 255 && power.BatteryFlag != 128 {
                s.battery = Some(Battery { percent: power.BatteryLifePercent, charging: power.ACLineStatus == 1 });
            }

            // Internet: jumlahin byte semua adapter fisik yang lagi nyala.
            let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
            if GetIfTable2(&mut table).is_ok() && !table.is_null() {
                let t = &*table;
                let rows = std::slice::from_raw_parts(t.Table.as_ptr(), t.NumEntries as usize);
                let (mut down, mut up) = (0u64, 0u64);
                for r in rows {
                    // 6 = Ethernet, 71 = Wi-Fi. Loopback, VPN, dan adapter virtual dilewatin.
                    if (r.Type == 6 || r.Type == 71) && r.OperStatus == IfOperStatusUp && r.InterfaceAndOperStatusFlags._bitfield & 1 != 0 {
                        down += r.InOctets;
                        up += r.OutOctets;
                    }
                }
                FreeMibTable(table as *const _);
                let now = Instant::now();
                if let Some((pd, pu, at)) = prev.net {
                    let secs = now.duration_since(at).as_secs_f64();
                    if secs > 0.2 {
                        s.net_down = (down.saturating_sub(pd) as f64 / secs) as u64;
                        s.net_up = (up.saturating_sub(pu) as f64 / secs) as u64;
                    }
                }
                prev.net = Some((down, up, now));
            }
        }
        s
    }

    fn press(vk: u16) {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        };
        let key = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), dwFlags: flags, ..Default::default() } },
        };
        let inputs = [key(Default::default()), key(KEYEVENTF_KEYUP)];
        unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    }

    pub fn media_key(action: &str) -> Result<(), String> {
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP};
        let vk = match action {
            "volumeUp" => VK_VOLUME_UP,
            "volumeDown" => VK_VOLUME_DOWN,
            "mute" => VK_VOLUME_MUTE,
            _ => return Err("Tombol nggak dikenal".into()),
        };
        press(vk.0);
        Ok(())
    }

    /// Mic default Windows: baca atau ganti status bisu. Balikin status sekarang.
    pub fn mic(toggle: bool) -> Result<bool, String> {
        use windows::Win32::{
            Media::Audio::{eCapture, eConsole, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator},
            System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
        };
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("Audio Windows nggak kebuka: {e}"))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .map_err(|_| "Nggak ada mic yang kepasang".to_string())?;
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
            let mut muted = volume.GetMute().map_err(|e| e.to_string())?.as_bool();
            if toggle {
                muted = !muted;
                volume.SetMute(muted, std::ptr::null()).map_err(|e| e.to_string())?;
            }
            Ok(muted)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Prev, SysStats};
    pub fn read(_prev: &mut Prev) -> SysStats {
        SysStats::default()
    }
    pub fn media_key(_action: &str) -> Result<(), String> {
        Err("Cuma ada di Windows".into())
    }
    pub fn mic(_toggle: bool) -> Result<bool, String> {
        Err("Cuma ada di Windows".into())
    }
}

#[tauri::command]
pub fn sys_stats(state: State<SysState>) -> SysStats {
    imp::read(&mut state.0.lock().unwrap())
}

#[tauri::command]
pub fn sys_media_key(action: String) -> Result<(), String> {
    imp::media_key(&action)
}

/// `toggle = false` cuma baca status.
#[tauri::command]
pub async fn sys_mic(toggle: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || imp::mic(toggle)).await.map_err(|e| e.to_string())?
}
