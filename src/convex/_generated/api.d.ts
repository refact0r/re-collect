/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as collections from "../collections.js";
import type * as itemCollectionPositions from "../itemCollectionPositions.js";
import type * as items from "../items.js";
import type * as migrations_001_add_positions from "../migrations/001_add_positions.js";
import type * as migrations_002_remove_collection_descriptions from "../migrations/002_remove_collection_descriptions.js";
import type * as migrations_003_add_search_text from "../migrations/003_add_search_text.js";
import type * as migrations_004_bulk_retag from "../migrations/004_bulk_retag.js";
import type * as migrations_005_remove_kind from "../migrations/005_remove_kind.js";
import type * as r2 from "../r2.js";
import type * as screenshots from "../screenshots.js";
import type * as searchText from "../searchText.js";
import type * as tagging from "../tagging.js";
import type * as taggingActions from "../taggingActions.js";
import type * as viewPreferences from "../viewPreferences.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  collections: typeof collections;
  itemCollectionPositions: typeof itemCollectionPositions;
  items: typeof items;
  "migrations/001_add_positions": typeof migrations_001_add_positions;
  "migrations/002_remove_collection_descriptions": typeof migrations_002_remove_collection_descriptions;
  "migrations/003_add_search_text": typeof migrations_003_add_search_text;
  "migrations/004_bulk_retag": typeof migrations_004_bulk_retag;
  "migrations/005_remove_kind": typeof migrations_005_remove_kind;
  r2: typeof r2;
  screenshots: typeof screenshots;
  searchText: typeof searchText;
  tagging: typeof tagging;
  taggingActions: typeof taggingActions;
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
};
