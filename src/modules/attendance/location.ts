import { z } from "zod";

export const punchLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100000),
  capturedAt: z.iso.datetime(),
});
export type PunchLocation = z.infer<typeof punchLocationSchema>;

export function locationIsFresh(location: PunchLocation, now = Date.now()) {
  const age = now - Date.parse(location.capturedAt);
  return age >= -30_000 && age <= 120_000;
}

export function capturePunchLocation(): Promise<PunchLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location requires a supported browser and HTTPS."));
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) =>
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          capturedAt: new Date(timestamp).toISOString(),
        }),
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? "Allow location access in your browser settings, then try again."
              : "Could not get your location. Enable location services and try again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
