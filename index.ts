import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import db from "./db.js";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { compareHash, hashPassword } from "./auth.js";
import { createExpense, createUser, findUserByEmail, getExpensesForUser, getExpenseById, updateExpense, deleteExpense, getCategoryTotals, getMonthTotal } from "./queries.js";
import { NewUser, SignUp, Login, CATEGORY_OPTIONS, NewExpense, AddExpense, EditExpense } from "./types.js";
import { validateExpense, validateLogin, validateSignup, monthSchema, firstMessage } from "./validation.js";
import { apiRouter } from "./api.js";
import { parseId, currentMonth, sessionUserId, EMAIL_TAKEN, INVALID_LOGIN } from "./helper.js";

const app = express();
const PgStore = connectPgSimple(session);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    throw new Error("SESSION_SECRET is missing. Add it to your .env file.");
}

app.use(session({
    store: new PgStore({ pool: db, tableName: "session" }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 7,
    },
}));
app.use("/api", apiRouter);
app.use((req, res, next) => {
    res.locals["isLoggedIn"] = req.session.userId !== undefined;
    res.locals["userName"] = req.session.name ?? "";
    res.locals["error"] = null;
    next();
});

function requireLogin(req: Request, res: Response, next: NextFunction) {
    if (req.session.userId === undefined) {
        return res.redirect("/login");
    }
    next();
    return true;
}

//EJS version
app.get("/", (req, res) => {
    res.render("index.ejs")
});

app.get("/register", (req, res) => {
    res.render("register.ejs")
});

app.get("/login", (req, res) => {
    res.render("login.ejs")
});

app.get("/expenses/new", requireLogin, (req, res) => {
    const values = {
        amount: "",
        description: "",
        date: "",
        category: "",
    };
    res.render("newexpense.ejs", { categories: CATEGORY_OPTIONS, values: values })
});

app.get("/expenses", requireLogin, async (req, res) => {
    try {
        const userId = sessionUserId(req)
        const result = await getExpensesForUser(userId);
        res.render("expenses.ejs", { expenses: result });
    } catch (err) {
        console.log(err);
        res.status(500).render("index.ejs", { error: "Something went wrong, please try again." })
    }
});

app.get("/expenses/edit/:id", requireLogin, async (req: Request<{ id: string }>, res: Response) => {
    const expenseId = parseId(req.params.id);
    try {
        const userId = sessionUserId(req)

        if (expenseId === null) {
            res.status(400).render("index.ejs", { error: "Invalid expense id" })
            return;
        }

        const result = await getExpenseById(expenseId, userId)
        if (!result) {
            return res.status(404).render("index.ejs", {
                error: "Expense not found, please try again"
            });
        }
        const values = {
            amount: result.amount,
            category: result.category,
            description: result.description ?? "",
            date: result.date
        };
        res.render("editexpense.ejs", {
            values: values,
            expenseId: expenseId,
            categories: CATEGORY_OPTIONS
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).render("index.ejs", {
            error: "Something went wrong, please try again."
        });
    }
});

app.get("/summary", requireLogin, async (req, res) => {
    try {
        const userId = sessionUserId(req)
        const raw = req.query.month;
        let month: string;

        if (raw === undefined || raw === "") {
            month = currentMonth();
        }
        else {
            const parsed = monthSchema.safeParse(raw);
            if (!parsed.success) {
                return res.status(400).render("index.ejs", { error: firstMessage(parsed.error) })
            }
            month = parsed.data;
        }

        const monthStart = `${month}-01`;
        const [categoryTotals, monthTotal] = await Promise.all([
            getCategoryTotals(userId, monthStart),
            getMonthTotal(userId, monthStart)
        ])
        res.render("summary.ejs", {
            categoryTotals,
            monthTotal,
            month,
            categories: CATEGORY_OPTIONS
        })
    }
    catch (err) {
        console.log(err);
        res.status(500).render("index.ejs", {
            error: "Something went wrong, please try again."
        });
    }
});

app.post("/register", async (req: Request<{}, {}, SignUp>, res, next) => {
    const body: Partial<SignUp> = req.body ?? {}
    const name = body.name?.trim() || ""
    const email = body.email?.trim() || ""
    try {
        const validatedInfo = validateSignup(body);
        if (!validatedInfo.ok) {
            return res.status(400).render("register.ejs", { error: validatedInfo.error, name: name, email: email })
        }
        const newUser: NewUser = {
            name: validatedInfo.data.name,
            email: validatedInfo.data.email,
            passwordHash: await hashPassword(validatedInfo.data.password)
        }
        if (await findUserByEmail(newUser.email)) {
            return res.status(409).render("register.ejs", {
                error: EMAIL_TAKEN,
                name: name,
                email: email,
            });
        }
        const result = await createUser(newUser);
        req.session.regenerate((err) => {
            if (err) {
                return next(err);
            }
            req.session.userId = result.id
            req.session.name = result.name
            res.redirect("/")
        })
    } catch (err) {
        if (err instanceof Error && "code" in err && err.code === "23505") {
            return res.status(409).render("register.ejs", {
                error: EMAIL_TAKEN,
                name: name,
                email: email,
            })
        }
        console.log(err);
        res.status(500).render("register.ejs", {
            error: "Something went wrong, please try again.",
            name: name,
            email: email,
        });
    }
});

app.post("/login", async (req: Request<{}, {}, Login>, res, next) => {
    const body: Partial<Login> = req.body ?? {};
    const email = body.email?.trim() || "";
    try {
        const validatedInfo = validateLogin(body);
        if (!validatedInfo.ok) {
            return res.status(400).render("login.ejs", { error: validatedInfo.error, email: email })
        }

        const result = await findUserByEmail(validatedInfo.data.email)
        if (!result) {
            return res.status(401).render("login.ejs", {
                error: INVALID_LOGIN,
                email: email
            })
        }
        if (!await compareHash(validatedInfo.data.password, result.passwordHash)) {
            return res.status(401).render("login.ejs", {
                error: INVALID_LOGIN,
                email: email
            })
        }
        req.session.regenerate((err) => {
            if (err) {
                return next(err);
            }
            req.session.userId = result.id
            req.session.name = result.name
            res.redirect("/")
        })
    }
    catch (err) {
        console.log(err);
        res.status(500).render("login.ejs", {
            error: "Something went wrong, please try again.",
            email: email
        });
    }
});

app.post("/logout", (req, res, next) => {
    req.session.destroy((err) => {
        if (err) {
            return next(err);
        }
        res.clearCookie("connect.sid")
        res.redirect("/")
    });
});

app.post("/expenses/new", requireLogin, async (req: Request<{}, {}, AddExpense>, res: Response) => {
    const body = req.body ?? {}
    const values = {
        amount: body.amount ?? "",
        category: body.category ?? "",
        description: body.description ?? "",
        date: body.date ?? "",
    };
    try {
        const userId = sessionUserId(req)

        const result = validateExpense(body);

        if (!result.ok) {
            return res.status(400).render("newexpense.ejs", { error: result.error, values: values, categories: CATEGORY_OPTIONS });
        }

        const expense: NewExpense = {
            userId: userId,
            amount: result.data.amount,
            category: result.data.category,
            description: result.data.description,
            date: result.data.date
        }
        await createExpense(expense)
        res.redirect("/expenses");
    }
    catch (err) {
        console.log(err);
        res.status(500).render("newexpense.ejs", {
            error: "Something went wrong, please try again.", values: values, categories: CATEGORY_OPTIONS
        });
    }
});

app.post("/expenses/edit/:id", requireLogin, async (req: Request<{ id: string }, {}, EditExpense>, res: Response) => {
    const body = req.body ?? {}
    const values = {
        amount: body.amount ?? "",
        description: body.description ?? "",
        date: body.date ?? "",
        category: body.category ?? "",
    };
    const expenseId = parseId(req.params.id);
    try {
        const userId = sessionUserId(req)
        if (expenseId === null) {
            return res.status(400).render("index.ejs", { error: "Invalid expense id" })
        }
        const result = validateExpense(values);
        if (!result.ok) {
            return res.status(400).render("editexpense.ejs", { error: result.error, values: values, categories: CATEGORY_OPTIONS, expenseId: expenseId });
        }
        const data = await updateExpense({
            amount: result.data.amount,
            category: result.data.category,
            description: result.data.description,
            date: result.data.date
        }, expenseId, userId)

        if (data === undefined) {
            return res.status(404).render("index.ejs", { error: "The Expense you are trying to edit is not found" });
        }
        res.redirect("/expenses")
    }
    catch (err) {
        console.log(err);
        res.status(500).render("editexpense.ejs", {
            error: "Something went wrong, please try again.", values: values, categories: CATEGORY_OPTIONS, expenseId: expenseId
        });
    }
});

app.post("/expenses/delete/:id", requireLogin, async (req: Request<{ id: string }, {}, {}>, res: Response) => {
    const expenseId = parseId(req.params.id);
    try {
        const userId = sessionUserId(req)
        if (expenseId === null) {
            return res.status(400).render("index.ejs", { error: "Invalid expense id" })
        }
        const deleted = await deleteExpense(expenseId, userId)
        if (!deleted) {
            return res.status(404).render("index.ejs", { error: "The Expense you are trying to delete is not found" })
        }
        res.redirect("/expenses");
    }
    catch (err) {
        console.log(err)
        res.status(500).render("index.ejs", { error: "Something went wrong, please try again." })
    }
});

app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: "Route not found" });
});

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
        next(err);
        return;
    }
    if (typeof err === "object" && err !== null && "type" in err && err.type === "entity.parse.failed") {
        res.status(400).json({ ok: false, error: "Request body is not valid JSON" });
        return;
    }
    console.error(err);
    res.status(500).json({ ok: false, error: "Something went wrong, please try again later" });
});

app.listen(3000, () => console.log("Listening on http://localhost:3000"));