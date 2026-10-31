import { AddExpense, Login, ValidationResult, SignUp, CATEGORY_OPTIONS, UpdateExpense } from "./types.js";
import { z } from "zod";

export function firstMessage(error: z.ZodError): string {
    return error.issues[0]?.message ?? "Invalid input";
}

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Enter a valid month" });

const loginSchema = z.object({
    email: z.string({
        error: "Please fill out all the fields"
    }).trim().toLowerCase().pipe(z.email({ error: "Please enter a valid email address." })),
    password: z.string().min(1, { error: "Please fill out all the fields" })
})

const registerSchema = z.object({
    name: z.string({
        error: "Please fill out all the fields"
    }).trim().min(2, { error: "Name must be at least 2 characters long" }).max(100, { error: "Name must be fewer than 100 characters" }),
    email: z.string({
        error: "Please fill out all the fields"
    }).trim().toLowerCase().pipe(z.email({ error: "Please enter a valid email address." })),
    password: z.string({
        error: "Please fill out all the fields"
    }).min(8, {
        error: "Password must be at least 8 characters"
    }).refine((val) => Buffer.byteLength(val, "utf8") <= 72, { error: "Password must not be too long" })
})

const expenseSchema = z.object({
    amount: z.coerce.number({ error: "Amount must be a number" }).transform((val) => Math.round(val * 100) / 100)
        .pipe(z.number().positive({ error: "Amount must be more than zero" }).max(99999999, { error: "Amount is too large" }))
        .transform((val) => val.toFixed(2)),
    category: z.enum(CATEGORY_OPTIONS, { error: "Enter a valid category option" }),
    description: z.string().trim().max(120, { error: "Description must be 120 characters or fewer" }).nullish().transform((val) => val || null),
    date: z.iso.date({ error: "Enter a valid date" })
});

export function validateLogin(loginInfo: Partial<Login>,): ValidationResult<Required<Login>> {
    const result = loginSchema.safeParse(loginInfo);
    if (!result.success) {
        return { ok: false, error: firstMessage(result.error) }
    }
    return { ok: true, data: result.data }
}

export function validateSignup(signupInfo: Partial<SignUp>,): ValidationResult<Required<SignUp>> {
    const result = registerSchema.safeParse(signupInfo);
    if (!result.success) {
        return { ok: false, error: firstMessage(result.error) }
    }
    return { ok: true, data: result.data }
}

export function validateExpense(expense: Partial<AddExpense>): ValidationResult<Required<UpdateExpense>> {
    const result = expenseSchema.safeParse(expense);
    if (!result.success) {
        return { ok: false, error: firstMessage(result.error) }
    }
    return { ok: true, data: result.data }
}