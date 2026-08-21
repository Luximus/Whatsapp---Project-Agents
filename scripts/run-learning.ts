import { Pool } from "pg";
import { env } from "../src/env.js";
import { previousDateKey, runDailyLearning } from "../src/lib/learning/analyzer.js";

const flag=process.argv.find((value)=>value.startsWith("--date="));
const dateKey=flag?.slice("--date=".length)||previousDateKey();
if(!/^\d{4}-\d{2}-\d{2}$/.test(dateKey))throw new Error("invalid_date_key");
const pool=new Pool({connectionString:env.DATABASE_URL});
try{await runDailyLearning(pool,dateKey,env.defaultProject,console);}finally{await pool.end();}
