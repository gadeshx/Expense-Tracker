import "dotenv/config";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { compareHash, hashPassword } from "./auth.js";
import { createExpense, createUser, findUserByEmail, getExpensesForUser, getExpenseById, updateExpense, deleteExpense, getCategoryTotals, getMonthTotal } from "./queries.js";
import { NewExpense } from "./types.js";
import { validateExpense, validateLogin, validateSignup, monthSchema, firstMessage } from "./validation.js";
import { parseId, currentMonth, sessionUserId, EMAIL_TAKEN, INVALID_LOGIN } from "./helper.js";

export const apiRouter = Router();

// Same idea as requireLogin, but answers with JSON instead of redirecting
export function requireApiLogin(req: Request, res: Response, next: NextFunction) {
    if (req.session.userId === undefined) {
        res.status(401).json({ ok: false, error: "Please log in first" });
        return;
    }
    next();
}
//API Version
apiRouter.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
    const validatedInfo = validateLogin(req.body);
    if (!validatedInfo.ok) {
        res.status(400).json({
            ok: false,
            error: validatedInfo.error
        });
        return;
    }
    const result = await findUserByEmail(validatedInfo.data.email)
    if (!result) {
        res.status(401).json({
            ok: false,
            error: INVALID_LOGIN,
        });
        return;
    }
    if (!await compareHash(validatedInfo.data.password, result.passwordHash)) {
        res.status(401).json({
            ok: false,
            error: INVALID_LOGIN,
        });
        return;
    }
    const id = result.id
    const name = result.name
    req.session.regenerate((err) => {
        if (err) {
            return next(err);
        }
        req.session.userId = id
        req.session.name = name
        res.status(200).json({ ok: true, data: { id, name } })
    })
});

apiRouter.post("/auth/register", async (req: Request, res: Response, next: NextFunction) => {
    const validatedInfo = validateSignup(req.body);
    if (!validatedInfo.ok) {
        res.status(400).json({ ok: false, error: validatedInfo.error })
        return;
    }
    if (await findUserByEmail(validatedInfo.data.email)) {
        res.status(409).json({
            ok: false,
            error: EMAIL_TAKEN
        });
        return;
    }
    const passwordHash = await hashPassword(validatedInfo.data.password);
    let user;
    try {
        user = await createUser({ name: validatedInfo.data.name, email: validatedInfo.data.email, passwordHash });
    } catch (err) {
        if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
            res.status(409).json({ ok: false, error: EMAIL_TAKEN });
            return;
        }
        next(err);
        return;
    }
    const id = user.id
    const name = user.name
    req.session.regenerate((err) => {
        if (err) {
            return next(err);
        }
        req.session.userId = id
        req.session.name = name
        res.status(201).json({ ok: true, data: { id, name } })
    })
});

apiRouter.post("/auth/logout", (req: Request, res: Response, next: NextFunction) => {
    req.session.destroy((err) => {
        if (err) {
            return next(err);
        }
        res.clearCookie("connect.sid")
        res.json({ ok: true });
    });
});

apiRouter.get("/auth/me", requireApiLogin, (req: Request, res: Response) => {
    const id = req.session.userId;
    const name = req.session.name;
    res.status(200).json({ ok: true, data: { id, name } });
});

apiRouter.get("/expenses", requireApiLogin, async (req, res) => {
    const expenses = await getExpensesForUser(sessionUserId(req));
    res.status(200).json({ ok: true, data: expenses });
});

apiRouter.get("/expenses/:id", requireApiLogin, async (req, res) => {
    const expenseId = parseId(req.params.id);
    if (expenseId === null) {
        res.status(400).json({ ok: false, error: "Invalid expense id" });
        return;
    }
    const result = await getExpenseById(expenseId, sessionUserId(req))
    if (!result) {
        res.status(404).json({
            ok: false,
            error: "Expense not found, please try again"
        });
        return;
    }
    res.status(200).json({ ok: true, data: result })
});

apiRouter.get("/summary", requireApiLogin, async (req, res) => {
    const raw = req.query.month;
    let month: string;
    if (raw === undefined || raw === "") {
        month = currentMonth();
    }
    else {
        const parsed = monthSchema.safeParse(raw);
        if (!parsed.success) {
            res.status(400).json({ ok: false, error: firstMessage(parsed.error) });
            return;
        }
        month = parsed.data;
    }

    const monthStart = `${month}-01`;
    const [categoryTotals, monthTotal] = await Promise.all([
        getCategoryTotals(sessionUserId(req), monthStart),
        getMonthTotal(sessionUserId(req), monthStart)
    ])
    res.status(200).json({
        ok: true, data: { categoryTotals, monthTotal, monthStart }
    })
});

apiRouter.post("/expenses", requireApiLogin, async (req, res) => {
    const body = req.body ?? {}
    const validatedInfo = validateExpense(body);

    if (!validatedInfo.ok) {
        res.status(400).json({ ok: false, error: validatedInfo.error });
        return;
    }
    const expense: NewExpense = {
        userId: sessionUserId(req),
        amount: validatedInfo.data.amount,
        category: validatedInfo.data.category,
        description: validatedInfo.data.description,
        date: validatedInfo.data.date
    }
    const createdExpense = await createExpense(expense)
    res.status(201).json({ ok: true, data: createdExpense });
});

apiRouter.put("/expenses/:id", requireApiLogin, async (req, res) => {
    const body = req.body ?? {}
    const validatedInfo = validateExpense(body);
    const expenseId = parseId(req.params.id);
    if (!validatedInfo.ok) {
        res.status(400).json({ ok: false, error: validatedInfo.error });
        return;
    }
    if (expenseId === null) {
        res.status(400).json({ ok: false, error: "Invalid expense id" });
        return;
    }
    const updatedExpense = await updateExpense({
        amount: validatedInfo.data.amount,
        category: validatedInfo.data.category,
        description: validatedInfo.data.description,
        date: validatedInfo.data.date
    }, expenseId, sessionUserId(req))

    if (updatedExpense === undefined) {
        res.status(404).json({ ok: false, error: "The Expense you are trying to edit is not found" });
        return;
    }
    res.status(200).json({ ok: true, data: updatedExpense });
});

apiRouter.delete("/expenses/:id", requireApiLogin, async (req, res) => {
    const expenseId = parseId(req.params.id);
    if (expenseId === null) {
        res.status(400).json({ ok: false, error: "Invalid expense id" });
        return;
    }
    const deleted = await deleteExpense(expenseId, sessionUserId(req))
    if (!deleted) {
        res.status(404).json({ ok: false, error: "The Expense you are trying to delete is not found" });
        return;
    }
    res.status(204).end();
});
