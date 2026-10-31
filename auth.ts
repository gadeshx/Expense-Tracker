import bcrypt from "bcrypt"

export async function hashPassword(password: string): Promise<string> {
    const hashedPassword = await bcrypt.hash(password, 12);
    return hashedPassword;
}

export async function compareHash(typedPassword: string, storedHash: string) {
    const isAuthorized = await bcrypt.compare(typedPassword, storedHash);
    return isAuthorized;
}