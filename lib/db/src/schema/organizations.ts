import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const kycStatusEnum = pgEnum("kyc_status", [
  "pending",
  "submitted",
  "verified",
  "rejected",
]);

export const orgTypeEnum = pgEnum("org_type", [
  "coworking_space",
  "accelerator",
  "corporate_hub",
  "community_hub",
  "other",
]);

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerEmail: text("owner_email").notNull().unique(),
  ownerName: text("owner_name"),
  ownerWalletAddress: text("owner_wallet_address"),
  ownerVerifierId: text("owner_verifier_id"),

  // KYC fields
  businessName: text("business_name"),
  orgType: orgTypeEnum("org_type").default("coworking_space"),
  registrationNumber: text("registration_number"),
  country: text("country").default("Nigeria"),
  state: text("state"),
  address: text("address"),
  website: text("website"),
  description: text("description"),
  logoUrl: text("logo_url"),
  phone: text("phone"),

  qrSecret: text("qr_secret"),
  kycStatus: kycStatusEnum("kyc_status").notNull().default("pending"),
  kycSubmittedAt: timestamp("kyc_submitted_at"),
  kycVerifiedAt: timestamp("kyc_verified_at"),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
