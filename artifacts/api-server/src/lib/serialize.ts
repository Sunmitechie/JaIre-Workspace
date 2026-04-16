import type { Booking } from "@workspace/db";

export function serializeBooking(b: Booking, workspaceName?: string) {
  return {
    id: b.id,
    workspace_id: b.workspaceId,
    workspace_name: workspaceName ?? b.workspaceId,
    user_id: b.userId,
    user_name: b.userName,
    user_email: b.userEmail,
    status: b.status,
    check_in_time: b.checkInTime?.toISOString() ?? null,
    check_out_time: b.checkOutTime?.toISOString() ?? null,
    planned_duration_hours: b.plannedDurationHours,
    actual_duration_seconds: b.actualDurationSeconds,
    escrow_amount_usdc: b.escrowAmountUsdc,
    billed_amount_usdc: b.billedAmountUsdc,
    refunded_amount_usdc: b.refundedAmountUsdc,
    escrow_account: b.escrowAccount,
    transaction_signature: b.transactionSignature,
    escrow_tx_signature: b.escrowTxSignature,
    settlement_tx_signature: b.settlementTxSignature,
    payment_method: b.paymentMethod,
    ngn_amount_paid: b.ngnAmountPaid,
  };
}
