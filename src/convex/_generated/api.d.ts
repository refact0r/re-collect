/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as collections from "../collections.js";
import type * as crons from "../crons.js";
import type * as discovery from "../discovery.js";
import type * as discoveryKeep from "../discoveryKeep.js";
import type * as embeddingMap from "../embeddingMap.js";
import type * as embeddingMapActions from "../embeddingMapActions.js";
import type * as embeddings from "../embeddings.js";
import type * as imageImport from "../imageImport.js";
import type * as itemCollectionPositions from "../itemCollectionPositions.js";
import type * as items from "../items.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_colorNames from "../lib/colorNames.js";
import type * as lib_discoverySources from "../lib/discoverySources.js";
import type * as lib_embedder from "../lib/embedder.js";
import type * as lib_embeddingMap from "../lib/embeddingMap.js";
import type * as lib_fonts from "../lib/fonts.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_tagger from "../lib/tagger.js";
import type * as lib_urls from "../lib/urls.js";
import type * as r2 from "../r2.js";
import type * as screenshots from "../screenshots.js";
import type * as sessions from "../sessions.js";
import type * as tagging from "../tagging.js";
import type * as taggingActions from "../taggingActions.js";
import type * as users from "../users.js";
import type * as viewPreferences from "../viewPreferences.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  collections: typeof collections;
  crons: typeof crons;
  discovery: typeof discovery;
  discoveryKeep: typeof discoveryKeep;
  embeddingMap: typeof embeddingMap;
  embeddingMapActions: typeof embeddingMapActions;
  embeddings: typeof embeddings;
  imageImport: typeof imageImport;
  itemCollectionPositions: typeof itemCollectionPositions;
  items: typeof items;
  "lib/auth": typeof lib_auth;
  "lib/colorNames": typeof lib_colorNames;
  "lib/discoverySources": typeof lib_discoverySources;
  "lib/embedder": typeof lib_embedder;
  "lib/embeddingMap": typeof lib_embeddingMap;
  "lib/fonts": typeof lib_fonts;
  "lib/searchText": typeof lib_searchText;
  "lib/tagger": typeof lib_tagger;
  "lib/urls": typeof lib_urls;
  r2: typeof r2;
  screenshots: typeof screenshots;
  sessions: typeof sessions;
  tagging: typeof tagging;
  taggingActions: typeof taggingActions;
  users: typeof users;
  viewPreferences: typeof viewPreferences;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
  screenshotPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"screenshotPool">;
  taggingPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"taggingPool">;
};
