import type { Request } from "express";

export function currentMonth(): string {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`
}

export function parseId(value: unknown): number | null {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        return null;
    }
    return Number(value);
}

export function sessionUserId(req: Request): number {
    const id = req.session.userId;
    if (id === undefined) {
        throw new Error("Request reached a protected route without a session");
    }
    return id;
}

export const EMAIL_TAKEN = "This email address is already registered.";
export const INVALID_LOGIN = "The credentials you entered don't match, please try again";