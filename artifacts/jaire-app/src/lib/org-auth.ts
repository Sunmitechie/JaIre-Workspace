export interface OrgUser {
  id: string;
  ownerEmail: string;
  ownerName?: string;
  ownerWalletAddress?: string;
  businessName?: string;
  kycStatus: "pending" | "submitted" | "verified" | "rejected";
  token: string;
}

const ORG_KEY = "jaire_org_user";
const ORG_TOKEN_KEY = "jaire_org_token";

export function getOrgUser(): OrgUser | null {
  try {
    const raw = localStorage.getItem(ORG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OrgUser;
  } catch {
    return null;
  }
}

export function saveOrgUser(org: OrgUser) {
  localStorage.setItem(ORG_KEY, JSON.stringify(org));
  localStorage.setItem(ORG_TOKEN_KEY, org.token);
}

export function clearOrgUser() {
  localStorage.removeItem(ORG_KEY);
  localStorage.removeItem(ORG_TOKEN_KEY);
}

export function getOrgToken(): string | null {
  return localStorage.getItem(ORG_TOKEN_KEY);
}

export function isOrgLoggedIn(): boolean {
  return getOrgUser() !== null;
}
