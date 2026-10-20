export interface Metric {
  total_workspaces: number;
  total_bookings: number;
  active_now: number;
  revenue_usdc: number;
}

export interface Booking {
  id: string;
  workspaceId: string;
  status: string;
  startTime: string;
  endTime?: string;
  billedUsdc?: number;
  escrowTxSignature?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  workspaceType: string;
  capacity: number;
  hourlyRateNgn: number;
  hourlyRateUsdc: number;
  isAvailable: boolean;
  amenities: string;
  imageUrl?: string;
}

export interface OrgUser {
  businessName?: string;
  ownerEmail?: string;
  kycStatus?: "pending" | "submitted" | "verified" | "rejected";
  token?: string;
  [key: string]: any;
}

export interface Device {
  id: string;
  orgId: string;
  workspaceId: string | null;
  deviceName: string;
  deviceType: string;
  mqttClientId: string;
  isOnline: boolean;
  powerState: boolean;
  currentWatts: number | null;
  voltage: number | null;
  currentAmps: number | null;
  todayKwh: number | null;
  temperature: number | null;
  lastSeen: string | null;
  createdAt: string;
}

export interface DeviceForm {
  deviceName: string;
  deviceType: string;
  workspaceId: string;
  mqttClientId: string;
}

export interface SimulationForm {
  watts: string;
  voltage: string;
  amps: string;
  power_state: boolean;
  temperature: string;
}

export const EMPTY_DEVICE_FORM: DeviceForm = {
  deviceName: "",
  deviceType: "smart_plug",
  workspaceId: "",
  mqttClientId: "",
};

export const DEFAULT_DEVICE_SIMULATION: SimulationForm = {
  watts: "120",
  voltage: "220",
  amps: "0.55",
  power_state: true,
  temperature: "38",
};