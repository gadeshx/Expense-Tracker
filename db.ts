import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

// Set up PostgreSQL connection
const password = process.env.DB_PASSWORD;
if (!password) {
    throw new Error("DB password is missing");
}
const db = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: password,
    database: process.env.DB_DATABASE,
    port: Number(process.env.DB_PORT),
});
db.on("error", (err) => console.error("DB pool error:", err.message));

export default db