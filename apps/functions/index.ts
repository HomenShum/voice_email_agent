// Entry point to ensure all functions are loaded in Azure (worker indexing)
// Importing modules has side effects of registering functions via app.http/app.timer/app.serviceBusQueue
import { app } from "@azure/functions";

// Import all function modules to register them
import "./functions/aggregate.js";
import "./functions/backfillStart.js";
import "./functions/backfillWorker.js";
import "./functions/deleteUser.js";
import "./functions/deltaStart.js";
import "./functions/deltaTimer.js";
import "./functions/indexStats.js";
import "./functions/jobsList.js";
import "./functions/nylasWebhook.js";
import "./functions/search.js";
import "./functions/syncProgress.js";
import "./functions/updateContext.js";

// Explicitly export app for Azure Functions runtime
export { app };

