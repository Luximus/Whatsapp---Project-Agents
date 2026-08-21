import cron from "node-cron";
import os from "node:os";
import { Pool } from "pg";
import { env } from "./env.js";
import { previousDateKey, runDailyLearning } from "./lib/learning/analyzer.js";
import { generateNextChange, publishNextChange, rollbackNextChange } from "./lib/learning/changeRunner.js";

const pool=new Pool({connectionString:env.DATABASE_URL});let busy=false;
const logger=console;

function enoughMemory(){return os.freemem()/1024/1024>=env.conversationLearningMinAvailableMb;}
async function tick(){if(busy||!enoughMemory())return;busy=true;try{if(await rollbackNextChange(pool,logger))return;if(await publishNextChange(pool,logger))return;await generateNextChange(pool,logger);}catch(error){logger.error("Learning worker tick failed",error);}finally{busy=false;}}

if(env.conversationLearningEnabled){
  if(!cron.validate(env.conversationLearningCron))throw new Error("invalid_conversation_learning_cron");
  cron.schedule(env.conversationLearningCron,()=>{void runDailyLearning(pool,previousDateKey(),env.defaultProject,logger);},{timezone:env.conversationLearningTimezone});
  void runDailyLearning(pool,previousDateKey(),env.defaultProject,logger).catch((error)=>logger.error("Learning catch-up failed",error));
  setInterval(()=>{void tick();},env.conversationLearningPollMs).unref();
  logger.info("Conversation learning worker started",{cron:env.conversationLearningCron,timezone:env.conversationLearningTimezone});
}else logger.info("Conversation learning worker disabled");

const shutdown=async()=>{await pool.end();process.exit(0);};process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
