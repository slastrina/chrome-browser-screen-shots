export interface DevicePreset {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  { name: "tablet", width: 820, height: 1180, deviceScaleFactor: 2, mobile: true },
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }
];
