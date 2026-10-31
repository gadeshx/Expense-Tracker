//For the database
export type User = {
    id: number,
    name: string,
    email: string,
    passwordHash: string
};
export const CATEGORY_OPTIONS = ["Emergency", "Utilities", "Food", "Others"] as const;
export type CategoryOption = (typeof CATEGORY_OPTIONS)[number];
export function isACategory(value: unknown): value is CategoryOption {
    return typeof value === "string" && (CATEGORY_OPTIONS as readonly string[]).includes(value);
}
export type Expense = {
    id: number,
    userId: number,
    amount: string,
    category: CategoryOption,
    description?: string | null,
    date: string,
    createdAt: Date
};

//For the database query
export type NewUser = Omit<User, "id">;
export type NewExpense = Omit<Expense, "createdAt" | "id">;
export type UpdateExpense = Partial<Omit<Expense, "createdAt" | "id" | "userId">>;
export type PublicUser = Omit<User, "passwordHash">;

//For the req.body
export type SignUp = {
    name: string,
    email: string,
    password: string
};
export type Login = {
    email: string,
    password: string
};
export type AddExpense = {
    amount: string,
    category: string,
    description?: string,
    date: string,
};
export type EditExpense = Partial<AddExpense>

export type ValidationResult<T> =
    { ok: true; data: T }
    | { ok: false; error: string };