"use client";

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  role: string;
  confederation_id?: number;
  is_active: boolean;
}

export function getUser(): UserInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: UserInfo) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem("token");
}

export function isAdmin(): boolean {
  return getUser()?.role === "admin";
}

export function isOffice(): boolean {
  const role = getUser()?.role;
  return role === "admin" || role === "office_staff";
}
