//! Lokasi PC dari layanan lokasi Windows (Wi-Fi/GPS), buat widget cuaca dan
//! jadwal sholat. Cuma diambil pas widget minta, dan nggak pernah disimpen
//! di disk oleh Rust.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoFix {
    pub lat: f64,
    pub lon: f64,
    /// Perkiraan meleset (meter).
    pub accuracy: f64,
}

#[cfg(windows)]
mod imp {
    use super::GeoFix;
    use windows::{
        Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy},
        Foundation::TimeSpan,
        Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize},
    };

    const OFF: &str =
        "Lokasi Windows mati. Nyalain di Settings › Privacy & security › Location, termasuk \"Let desktop apps access your location\".";

    fn locate_inner() -> Result<GeoFix, String> {
        // Buat app desktop ini nggak munculin dialog, cuma ngecek izinnya.
        if let Ok(op) = Geolocator::RequestAccessAsync()
            && let Ok(status) = op.join()
            && status != GeolocationAccessStatus::Allowed
        {
            return Err(OFF.into());
        }
        let g = Geolocator::new().map_err(|e| e.to_string())?;
        let _ = g.SetDesiredAccuracy(PositionAccuracy::Default);
        // Boleh pakai posisi yang umurnya sampai 10 menit; tunggu paling lama 15 detik.
        let pos =
            g.GetGeopositionAsyncWithAgeAndTimeout(TimeSpan { Duration: 10 * 60 * 10_000_000 }, TimeSpan { Duration: 15 * 10_000_000 })
                .and_then(|op| op.join())
                .map_err(|e| {
                    if e.code().0 as u32 == 0x8007_0005 { OFF.to_string() } else { format!("Lokasi nggak kebaca: {}", e.message()) }
                })?;
        let c = pos.Coordinate().map_err(|e| e.to_string())?;
        let p = c.Point().and_then(|p| p.Position()).map_err(|e| e.to_string())?;
        Ok(GeoFix { lat: p.Latitude, lon: p.Longitude, accuracy: c.Accuracy().unwrap_or(0.0) })
    }

    pub fn locate() -> Result<GeoFix, String> {
        // Thread sendiri biar urusan COM-nya nggak nyampur sama thread lain.
        std::thread::spawn(|| {
            let init = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            let r = locate_inner();
            if init.is_ok() {
                unsafe { CoUninitialize() };
            }
            r
        })
        .join()
        .map_err(|_| "Lokasi error".to_string())?
    }
}

#[cfg(not(windows))]
mod imp {
    use super::GeoFix;
    pub fn locate() -> Result<GeoFix, String> {
        Err("Lokasi otomatis cuma ada di Windows".into())
    }
}

#[tauri::command]
pub async fn geo_locate() -> Result<GeoFix, String> {
    tauri::async_runtime::spawn_blocking(imp::locate).await.map_err(|e| e.to_string())?
}
