export interface Overview {
  total_organizations: number;
  total_workspaces: number;
  total_bookings: number;
  total_users: number;
  active_sessions: number;
  today_checkins: number;
  total_revenue_usdc: number;
  platform_fee_usdc: number;
  total_escrow_usdc: number;
  total_revenue_ngn: number;
  vault_balance_usdc: number;
  vault_sol: number;
  vault_address: string;
  kyc_counts: { pending: number; submitted: number; verified: number; rejected: number };
}

export interface OrgRow {
  id: string;
  business_name: string;
  owner_name: string | null;
  owner_email: string;
  owner_wallet: string | null;
  kyc_status: "pending" | "submitted" | "verified" | "rejected";
  org_type: string | null;
  country: string | null;
  state: string | null;
  workspace_count: number;
  booking_count: number;
  active_sessions: number;
  revenue_usdc: number;
  revenue_ngn: number;
  created_at: string;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
}

export interface BookingRow {
  id: string;
  workspace_name: string | null;
  user_name: string;
  user_email: string | null;
  status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  planned_hours: number;
  actual_seconds: number | null;
  escrow_usdc: number | null;
  billed_usdc: number | null;
  refunded_usdc: number | null;
  payment_method: string;
  settle_tx: string | null;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  eventType: string;
  workspaceName: string | null;
  userId: string | null;
  userName: string | null;
  amountUsdc: number | null;
  amountNgn: number | null;
  createdAt: string;
}
