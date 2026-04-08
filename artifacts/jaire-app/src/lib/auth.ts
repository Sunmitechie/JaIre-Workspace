export interface JaireUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  provider: "google" | "twitter" | "apple" | "email";
  walletAddress?: string;
}

const KEY = "jaire_user";

export function getUser(): JaireUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as JaireUser;
  } catch {
    return null;
  }
}

export function saveUser(user: JaireUser) {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearUser() {
  localStorage.removeItem(KEY);
}

export function isLoggedIn(): boolean {
  return getUser() !== null;
}
