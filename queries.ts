import db from "./db.js";
import { CategoryOption, Expense, NewExpense, NewUser, PublicUser, UpdateExpense, User } from "./types.js";

//monthCondition contains $2, so it only works in queries where the month is the second parameter. That’s true for both of your functions, but if you ever write a query with a different order, the numbers will point at the wrong values.
const monthCondition = "date >= date_trunc('month', $2::date)::date AND date < date_trunc('month', $2::date)::date + interval '1 month'"

export async function createUser(user: NewUser): Promise<PublicUser> {
    const result = await db.query<PublicUser>(
        "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
        [user.name, user.email.toLowerCase(), user.passwordHash]);
    const row = result.rows[0]
    if (!row) {
        throw new Error("Failed to create user");
    }
    return row;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.query<User>('SELECT id, name, email, password_hash AS "passwordHash" FROM users WHERE email = $1', [email.toLowerCase()]);
    return result.rows[0]
}

export async function createExpense(expense: NewExpense): Promise<Expense> {
    const result = await db.query<Expense>(
        'INSERT INTO expenses (user_id, amount, category, description, date) VALUES ($1, $2, $3, $4, $5) RETURNING id, user_id AS "userId", amount, category, description, date::text AS "date", created_at AS "createdAt"',
        [expense.userId, expense.amount, expense.category, expense.description, expense.date]);
    const row = result.rows[0]
    if (!row) {
        throw new Error("Failed to create expense");
    }
    return row;
}

export async function getExpensesForUser(userId: number): Promise<Expense[]> {
    const result = await db.query<Expense>(
        'SELECT id, user_id AS "userId", amount, category, description, date::text AS "date", created_at AS "createdAt" FROM expenses WHERE user_id = $1 ORDER BY date DESC, id DESC',
        [userId]);
    return result.rows;
}

export async function getExpenseById(id: number, userId: number): Promise<Expense | undefined> {
    const result = await db.query<Expense>(
        'SELECT id, user_id AS "userId", amount, category, description, date::text AS "date", created_at AS "createdAt" FROM expenses WHERE id = $1 AND user_id = $2',
        [id, userId]);
    return result.rows[0];
}

export async function updateExpense(expense: Required<UpdateExpense>, id: number, userId: number): Promise<Expense | undefined> {
    const result = await db.query<Expense>(
        'UPDATE expenses SET amount = $1, category = $2, description = $3, date = $4 WHERE id = $5 AND user_id = $6 RETURNING id, user_id AS "userId", amount, category, description, date::text AS "date", created_at AS "createdAt"',
        [expense.amount, expense.category, expense.description, expense.date, id, userId]);
    return result.rows[0];
}

export async function deleteExpense(id: number, userId: number): Promise<boolean> {
    const result = await db.query(
        "DELETE FROM expenses WHERE id = $1 AND user_id = $2",
        [id, userId])
    return (result.rowCount ?? 0) > 0
}

export async function getCategoryTotals(userId: number, monthStart: string): Promise<Record<CategoryOption, string>> {
    const totals: Record<CategoryOption, string> = {
        Emergency: "0.00",
        Utilities: "0.00",
        Food: "0.00",
        Others: "0.00"
    }
    const result = await db.query<{ category: CategoryOption, total: string }>(
        `SELECT category, SUM(amount) AS total from expenses WHERE user_id = $1 AND ${monthCondition} GROUP BY category`,
        [userId, monthStart]);
    result.rows.forEach((row) => {
        totals[row.category] = row.total
    })
    return totals
}

export async function getMonthTotal(userId: number, monthStart: string): Promise<string> {
    const result = await db.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), '0.00') AS total from expenses WHERE user_id = $1 AND ${monthCondition}`,
        [userId, monthStart]);
    if (!result.rows[0]) {
        throw new Error("the aggregate query returned no row, which shouldn’t be possible.")
    }
    return result.rows[0].total
}