// Every module, in mount order. createApp() mounts the routers in this order,
// and Express matches in it, so the order is behavior: the mcp module stays
// before the contacts module (server/modules/mcp/index.ts). A new feature adds
// its folder and one line here (see server/modules/module.ts).

import type { Express } from "express";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import type { JobDefinition } from "../jobs/runner.ts";
import type { Subscriber } from "../events/dispatcher.ts";
import type { ContrackModule } from "./module.ts";
import { adminModule } from "./admin/index.ts";
import { avatarModule } from "./avatar/index.ts";
import { linkPreviewModule } from "./link-preview/index.ts";
import { searchModule } from "./search/index.ts";
import { listsModule } from "./lists/index.ts";
import { mcpModule } from "./mcp/index.ts";
import { taxonomyModule } from "./taxonomy/index.ts";
import { contactsModule } from "./contacts/index.ts";
import { connectorsModule } from "./connectors/index.ts";
import { importsModule } from "./imports/index.ts";
import { interactionsModule } from "./interactions/index.ts";
import { dedupeModule } from "./dedupe/index.ts";
import { actionItemsModule } from "./action-items/index.ts";
import { dashboardModule } from "./dashboard/index.ts";
import { aiSearchModule } from "./ai-search/index.ts";
import { dataLifecycleModule } from "./data-lifecycle/index.ts";
import { aiModule } from "./ai/index.ts";
import { logosModule } from "./logos/index.ts";
import { mapModule } from "./map/index.ts";
import { oauthModule } from "./oauth/index.ts";

export const MODULES: readonly ContrackModule[] = [
  adminModule,
  avatarModule,
  linkPreviewModule,
  searchModule,
  listsModule,
  mcpModule,
  taxonomyModule,
  contactsModule,
  connectorsModule,
  importsModule,
  interactionsModule,
  dedupeModule,
  actionItemsModule,
  dashboardModule,
  aiSearchModule,
  dataLifecycleModule,
  aiModule,
  logosModule,
  mapModule,
  oauthModule,
];

/** Mount every module's routers on the app, in list order. */
export function mountModules(
  app: Express,
  modules: readonly ContrackModule[] = MODULES,
): void {
  const seen = new Set<string>();
  for (const feature of modules) {
    if (seen.has(feature.id)) {
      throw new Error(`Two modules share the id "${feature.id}".`);
    }
    seen.add(feature.id);
    for (const { path, router } of feature.routers) app.use(path, router);
  }
}

/** Every job the modules declare, in list order. */
export function moduleJobs(
  modules: readonly ContrackModule[] = MODULES,
): JobDefinition<unknown>[] {
  return modules.flatMap((feature) => feature.jobs);
}

/** Every subscriber the modules declare, in list order. */
export function moduleSubscribers(
  modules: readonly ContrackModule[] = MODULES,
): Subscriber[] {
  return modules.flatMap((feature) => feature.subscribers);
}

/**
 * Run each module's start-up work, in list order, without waiting for it.
 * A failure, thrown or rejected, is logged and stops nothing else.
 */
export function runModuleStarts(
  modules: readonly ContrackModule[] = MODULES,
): void {
  for (const feature of modules) {
    const start = feature.onStart;
    if (!start) continue;
    Promise.resolve()
      .then(start)
      .catch((err) =>
        log.warn(
          "Server",
          `Start-up of the ${feature.id} module failed: ${getErrorMessage(err)}`,
        ),
      );
  }
}
