import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import db from "./db.js";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import bodyParser from "body-parser";
import { compareHash, hashPassword } from "./auth.js";
import { createExpense, createUser, findUserByEmail, getExpensesForUser, getExpenseById, updateExpense, deleteExpense, getCategoryTotals, getMonthTotal } from "./queries.js";
import { NewUser, SignUp, Login, CATEGORY_OPTIONS, NewExpense, AddExpense, EditExpense } from "./types.js";
import { validateExpense, validateLogin, validateSignup, monthSchema, firstMessage } from "./validation.js";

const app = express();
const PgStore = connectPgSimple(session);
app.use(bodyParser.urlencoded({ extended: true }));

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

app.use((req, res, next) => {
    res.locals["isLoggedIn"] = req.session.userId !== undefined;
    res.locals["userName"] = req.session.name ?? "";
    res.locals["error"] = null;
    next();
});

app.use(express.static("public"));

function requireLogin(req: Request, res: Response, next: NextFunction) {
    if (req.session.userId === undefined) {
        return res.redirect("/login");
    }
    next();
    return true;
}

function currentMonth(): string {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`
}

app.get("/", (req, res) => {
    res.render("index.ejs")
});

app.get("/register", (req, res) => {
    res.render("register.ejs")
});

app.get("/login", (req, res) => {
    res.render("login.ejs")
});

app.get("/newexpense", requireLogin, (req, res) => {
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
        if (req.session.userId === undefined) {
            return res.redirect("/login");
        }
        const result = await getExpensesForUser(req.session.userId);
        res.render("expenses.ejs", { expenses: result });
    } catch (err) {
        console.log(err);
        res.status(500).render("index.ejs", { error: "Something went wrong, please try again." })
    }
});

app.get("/expenses/edit/:id", requireLogin, async (req: Request<{ id: string }>, res: Response) => {
    try {
        if (req.session.userId === undefined) {
            return res.redirect("/login");
        }

        const expenseId = Number(req.params.id)
        if (!Number.isInteger(expenseId) || expenseId <= 0) {
            return res.status(400).render("index.ejs", {
                error: "Please select an Expense to be edited"
            });
        }

        const result = await getExpenseById(expenseId, req.session.userId)
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
        if (req.session.userId === undefined) {
            return res.redirect("/login");
        }
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
            getCategoryTotals(req.session.userId, monthStart),
            getMonthTotal(req.session.userId, monthStart)
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
                error: "This email address is already registered.",
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
                error: "This email address is already registered.",
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
        // if (!email || !password) {
        //     return res.status(400).render("login.ejs", {
        //         error: "Please fill out all the fields",
        //         email: email
        //     })
        // }
        const validatedInfo = validateLogin(body);
        if (!validatedInfo.ok) {
            return res.status(400).render("login.ejs", { error: validatedInfo.error, email: email })
        }

        const result = await findUserByEmail(validatedInfo.data.email)
        if (!result) {
            return res.status(401).render("login.ejs", {
                error: "The credentials you entered doesn't match, please try again",
                email: email
            })
        }
        if (!await compareHash(validatedInfo.data.password, result.passwordHash)) {
            return res.status(401).render("login.ejs", {
                error: "The credentials you entered doesn't match, please try again",
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

app.post("/newexpense", requireLogin, async (req: Request<{}, {}, AddExpense>, res: Response) => {
    const body = req.body ?? {}
    const values = {
        amount: body.amount ?? "",
        category: body.category ?? "",
        description: body.description ?? "",
        date: body.date ?? "",
    };
    try {
        if (req.session.userId === undefined) {
            return res.redirect("/login");
        }

        const result = validateExpense(body);

        if (!result.ok) {
            return res.status(400).render("newexpense.ejs", { error: result.error, values: values, categories: CATEGORY_OPTIONS });
        }

        const expense: NewExpense = {
            userId: req.session.userId,
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
    const expenseId = Number(req.params.id)
    try {
        if (req.session.userId === undefined) {
            return res.redirect("/login");
        }

        if (!Number.isInteger(expenseId) || expenseId <= 0) {
            return res.status(400).render("index.ejs", { error: "Please choose an Expense to edit" });
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
        }, expenseId, req.session.userId)

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
    const expenseId = Number(req.params.id);
    try {
        if (req.session.userId === undefined) {
            return res.redirect("/login");
        }
        if (!Number.isInteger(expenseId) || expenseId <= 0) {
            return res.status(400).render("index.ejs", { error: "Please choose an Expense to delete" });
        }
        const deleted = await deleteExpense(expenseId, req.session.userId)
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

app.listen(3000, () => console.log("Listening on http://localhost:3000"));